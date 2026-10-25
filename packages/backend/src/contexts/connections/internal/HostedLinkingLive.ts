import { Array, Crypto, DateTime, Duration, Effect, Layer, Redacted, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { ConnectionError } from "#contexts/connections/Connection.ts";
import { StartLinkingInput as StartLinkingInputSchema } from "#contexts/connections/Connection.ts";
import {
  hostedLinkingStartWindowMillis,
  hostedLinkingStartsPerWindow,
} from "#contexts/connections/ConnectionLimits.ts";
import { Connections } from "#contexts/connections/Connections.ts";
import {
  HostedLinking,
  HostedLinkingExpired,
  HostedLinkingNotActive,
  HostedLinkingPersistenceFailed,
  HostedLinkingRateLimited,
  HostedLinkingTicketRejected,
} from "#contexts/connections/HostedLinking.ts";
import type {
  CompleteHostedLinkingInput,
  HostedLinkingFailureReason,
  HostedLinkingSession,
  HostedLinkingSessionInput,
  StartHostedLinkingInput,
} from "#contexts/connections/HostedLinking.ts";
import { HostedLinkingSessionId } from "#contexts/connections/HostedLinking.ts";

import { HostedLinkingRepository, hostedLinkingStatusOf } from "./HostedLinkingRepository.ts";
import type { HostedLinkingRecord } from "./HostedLinkingRepository.ts";

export const HostedLinkingLive = Layer.effect(
  HostedLinking,
  Effect.gen(function* () {
    const repository = yield* HostedLinkingRepository;
    const connections = yield* Connections;
    const crypto = yield* Crypto.Crypto;

    const start = Effect.fn("HostedLinking.start")(function* (
      userId: UserId,
      input: StartHostedLinkingInput,
    ) {
      const now = yield* DateTime.now;
      yield* repository.expireStale(userId, now);
      const since = DateTime.subtractDuration(now, Duration.millis(hostedLinkingStartWindowMillis));
      const recent = yield* repository.countStartsSince(userId, since);
      if (recent >= hostedLinkingStartsPerWindow) {
        return yield* HostedLinkingRateLimited.make({});
      }

      const idValue = yield* crypto
        .randomUUIDv7()
        .pipe(Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })));
      const id = yield* Schema.decodeEffect(HostedLinkingSessionId)(idValue).pipe(
        Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })),
      );
      const connectionInput = yield* Schema.decodeEffect(StartLinkingInputSchema)({
        requestId: idValue,
        provider: input.provider,
        pairingCode: `hosted-${idValue}`,
      }).pipe(Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })));
      const started = yield* connections.startLinking(userId, [connectionInput]);
      const connection = Array.getUnsafe(started, 0);

      const ticket = yield* issueTicket();
      const session = yield* repository
        .create(userId, {
          id,
          connectionId: connection.id,
          provider: input.provider,
          ticketHash: ticket.hash,
        })
        .pipe(
          Effect.catch((error) =>
            connections
              .cancelLinking(userId, [{ id: connection.id }])
              .pipe(Effect.ignore, Effect.andThen(Effect.fail(error))),
          ),
        );

      return { session: toSession(session), ticket: Redacted.make(ticket.value) };
    });

    const authorize = Effect.fn("HostedLinking.authorize")(function* (
      userId: UserId,
      input: { readonly id: HostedLinkingSessionId; readonly ticket: string },
    ) {
      const record = yield* repository.loadOwned(userId, input.id);
      if (record.ticketHash !== (yield* hashTicket(input.ticket))) {
        return yield* HostedLinkingTicketRejected.make({ id: input.id });
      }
      const now = yield* DateTime.now;
      if (record.state._tag === "Active" && isExpired(record.state.expiresAt, now)) {
        const expired = yield* repository.expire(userId, [record.id], now);
        yield* cancelConnections(userId, expired);
        return yield* HostedLinkingExpired.make({ id: record.id });
      }
      if (record.state._tag !== "Active") {
        return yield* HostedLinkingNotActive.make({
          id: record.id,
          status: hostedLinkingStatusOf(record.state),
        });
      }
      return toSession(record);
    });

    const complete = Effect.fn("HostedLinking.complete")(function* (
      userId: UserId,
      input: CompleteHostedLinkingInput,
    ) {
      const ticketHash = yield* hashTicket(input.ticket);
      const claimed = yield* repository.claimCompletion(userId, {
        id: input.id,
        ticketHash,
        at: yield* DateTime.now,
      });
      const completed = yield* connections
        .completeLinking(userId, [
          {
            id: claimed.state.connectionId,
            provider: input.provider,
            session: input.session,
          },
        ])
        .pipe(Effect.result);

      if (completed._tag === "Failure") {
        yield* repository
          .markFailed(userId, input.id, yield* DateTime.now, failureReason(completed.failure))
          .pipe(Effect.ignore);
        yield* connections
          .cancelLinking(userId, [{ id: claimed.state.connectionId }])
          .pipe(Effect.ignore);
        return yield* completed.failure;
      }

      const session = yield* repository.markCompleted(userId, input.id, yield* DateTime.now);
      const teams = yield* connections
        .discoverTeams(userId, [{ id: claimed.state.connectionId }])
        .pipe(Effect.result);
      return {
        session: toSession(session),
        connection: Array.getUnsafe(completed.success, 0),
        teamsDiscovered: teams._tag === "Success" ? teams.success.length : 0,
      };
    });

    const cancel = Effect.fn("HostedLinking.cancel")(function* (
      userId: UserId,
      inputs: ReadonlyArray<HostedLinkingSessionInput>,
    ) {
      const ids = [...new Set(inputs.map((input) => input.id))];
      const now = yield* DateTime.now;
      const records = yield* repository.cancel(userId, ids, now);
      yield* cancelConnections(userId, records);
      return records.map(toSession);
    });

    const expire = Effect.fn("HostedLinking.expire")(function* (
      userId: UserId,
      inputs: ReadonlyArray<HostedLinkingSessionInput>,
    ) {
      const ids = [...new Set(inputs.map((input) => input.id))];
      const now = yield* DateTime.now;
      const records = yield* repository.expire(userId, ids, now);
      yield* cancelConnections(userId, records);
      return records.map(toSession);
    });

    const fail = Effect.fn("HostedLinking.fail")(function* (
      userId: UserId,
      input: HostedLinkingSessionInput,
      reason: HostedLinkingFailureReason,
    ) {
      const record = yield* repository.markFailed(userId, input.id, yield* DateTime.now, reason);
      yield* cancelConnections(userId, [record]);
      return toSession(record);
    });

    const cancelConnections = (
      userId: UserId,
      records: ReadonlyArray<HostedLinkingRecord>,
    ): Effect.Effect<void> => {
      if (records.length === 0) {
        return Effect.void;
      }
      return connections
        .cancelLinking(
          userId,
          records.map((record) => ({ id: record.state.connectionId })),
        )
        .pipe(Effect.ignore);
    };

    function issueTicket(): Effect.Effect<
      { readonly value: string; readonly hash: string },
      HostedLinkingPersistenceFailed
    > {
      return Effect.gen(function* () {
        const bytes = yield* crypto
          .randomBytes(ticketBytes)
          .pipe(Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })));
        const value = yield* Schema.encodeEffect(Schema.Uint8ArrayFromBase64Url)(bytes).pipe(
          Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })),
        );
        return { value, hash: yield* hashTicket(value) };
      });
    }

    function hashTicket(value: string): Effect.Effect<string, HostedLinkingPersistenceFailed> {
      return Effect.gen(function* () {
        const digest = yield* crypto.digest("SHA-256", new TextEncoder().encode(value));
        return yield* Schema.encodeEffect(Schema.Uint8ArrayFromBase64Url)(digest);
      }).pipe(Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })));
    }

    return HostedLinking.of({ start, authorize, complete, cancel, expire, fail });
  }),
);

function toSession(record: HostedLinkingRecord): HostedLinkingSession {
  const state = record.state;
  return {
    id: record.id,
    userId: record.userId,
    connectionId: state.connectionId,
    provider: state.provider,
    status: hostedLinkingStatusOf(state),
    startedAt: state.startedAt,
    expiresAt: state.expiresAt,
    ...(state._tag === "Completed" ? { completedAt: state.completedAt } : {}),
    ...(state._tag === "Cancelled" ? { cancelledAt: state.cancelledAt } : {}),
    ...(state._tag === "Expired" ? { expiredAt: state.expiredAt } : {}),
    ...(state._tag === "Failed" ? { failedAt: state.failedAt, failureReason: state.reason } : {}),
    createdAt: record.createdAt,
    updatedAt: state.updatedAt,
  };
}

function isExpired(expiresAt: DateTime.Utc, now: DateTime.Utc): boolean {
  return DateTime.toEpochMillis(expiresAt) <= DateTime.toEpochMillis(now);
}

function failureReason(error: ConnectionError): HostedLinkingFailureReason {
  switch (error._tag) {
    case "connection.provider_rejected":
      return "session_rejected";
    case "connection.provider_unavailable":
      return "provider_unavailable";
    case "connection.link_expired":
      return "link_expired";
    case "connection.create_failed":
    case "connection.persistence_failed":
      return "persistence_failed";
    case "connection.credential_generation_stale":
    case "connection.link_rejected":
    case "connection.not_found":
      return "connection_unavailable";
  }
}

const ticketBytes = 32;
