import { Array, Crypto, DateTime, Duration, Effect, Layer, Redacted, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import { ConnectionLinkRejected, ConnectionNotFound } from "#contexts/connections/Connection.ts";
import type { ConnectionError, ConnectionId } from "#contexts/connections/Connection.ts";
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
      if (input.connectionId !== undefined) {
        const owned = yield* connections.list(userId);
        const target = owned.find((connection) => connection.id === input.connectionId);
        if (target === undefined) {
          return yield* ConnectionNotFound.make({ id: input.connectionId });
        }
        if (target.provider !== input.provider || target.status !== "reconnect-required") {
          return yield* ConnectionLinkRejected.make({ id: target.id, status: target.status });
        }
      }

      const now = yield* DateTime.now;
      yield* repository.expireStale(userId, now);
      const since = DateTime.subtractDuration(now, Duration.millis(hostedLinkingStartWindowMillis));
      const recent = yield* repository.countStartsSince(userId, since);
      if (recent >= hostedLinkingStartsPerWindow) {
        return yield* HostedLinkingRateLimited.make({});
      }

      const idValue = yield* crypto.randomULID.pipe(
        Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })),
      );
      const id = yield* Schema.decodeEffect(HostedLinkingSessionId)(idValue).pipe(
        Effect.mapError((cause) => HostedLinkingPersistenceFailed.make({ cause })),
      );
      const ticket = yield* issueTicket();
      const session = yield* repository.create(userId, {
        id,
        provider: input.provider,
        ...(input.connectionId === undefined ? {} : { connectionId: input.connectionId }),
        ticketHash: ticket.hash,
      });

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
        yield* repository.expire(userId, [record.id], now);
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
      const reconnectTarget =
        claimed.state._tag === "Completing" ? claimed.state.connectionId : undefined;
      const linked = yield* (
        reconnectTarget === undefined
          ? connections.link(userId, [{ provider: input.provider, session: input.session }])
          : connections.completeReconnect(userId, [
              { id: reconnectTarget, provider: input.provider, session: input.session },
            ])
      ).pipe(Effect.result);

      if (linked._tag === "Failure") {
        yield* repository
          .markFailed(userId, input.id, yield* DateTime.now, failureReason(linked.failure))
          .pipe(Effect.ignore);
        return yield* linked.failure;
      }

      const connection = Array.getUnsafe(linked.success, 0);
      const session = yield* repository.markCompleted(
        userId,
        claimed.id,
        connection.id,
        yield* DateTime.now,
      );
      const teams = yield* connections
        .discoverTeams(userId, [{ id: connection.id }])
        .pipe(Effect.result);
      return {
        session: toSession(session),
        connection,
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
      return records.map(toSession);
    });

    const expire = Effect.fn("HostedLinking.expire")(function* (
      userId: UserId,
      inputs: ReadonlyArray<HostedLinkingSessionInput>,
    ) {
      const ids = [...new Set(inputs.map((input) => input.id))];
      const now = yield* DateTime.now;
      const records = yield* repository.expire(userId, ids, now);
      return records.map(toSession);
    });

    const fail = Effect.fn("HostedLinking.fail")(function* (
      userId: UserId,
      input: HostedLinkingSessionInput,
      reason: HostedLinkingFailureReason,
    ) {
      const record = yield* repository.markFailed(userId, input.id, yield* DateTime.now, reason);
      return toSession(record);
    });

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
  const connectionId = connectionIdOf(state);
  return {
    id: record.id,
    userId: record.userId,
    ...(connectionId === undefined ? {} : { connectionId }),
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

function connectionIdOf(state: HostedLinkingRecord["state"]): ConnectionId | undefined {
  switch (state._tag) {
    case "Active":
    case "Completing":
    case "Completed":
      return state.connectionId;
    case "Cancelled":
    case "Expired":
    case "Failed":
      return undefined;
  }
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
