import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { Duration, Effect, Layer, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";

import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";

import { ConnectionProviderRejected } from "./Connection.ts";
import { Connections } from "./Connections.ts";
import {
  HostedLinkingExpired,
  HostedLinkingNotFound,
  HostedLinkingNotActive,
  HostedLinkingRateLimited,
  HostedLinkingSessionActive,
  HostedLinkingTicketRejected,
  StartHostedLinkingInput,
} from "./HostedLinking.ts";
import { HostedLinking } from "./HostedLinking.ts";
import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { HostedLinkingLive } from "./internal/HostedLinkingLive.ts";
import { HostedLinkingRepository } from "./internal/HostedLinkingRepository.ts";
import { FakeProviderWorld, ProviderFakeTest } from "./internal/ProviderFakeTest.ts";

it.effect("starts an owner-bound session, authorizes its ticket, and hides it from others", () =>
  Effect.gen(function* () {
    const hosted = yield* HostedLinking;
    const connections = yield* Connections;
    const started = yield* hosted.start(owner, startInput);

    assert.strictEqual(started.session.status, "active");
    assert.isUndefined(started.session.connectionId);
    assert.deepStrictEqual(yield* connections.list(owner), []);
    assert.isAbove(
      started.session.expiresAt.epochMilliseconds,
      started.session.startedAt.epochMilliseconds,
    );
    assert.strictEqual(Redacted.isRedacted(started.ticket), true);

    const authorized = yield* hosted.authorize(owner, {
      id: started.session.id,
      ticket: Redacted.value(started.ticket),
    });
    const wrongTicket = yield* Effect.flip(
      hosted.authorize(owner, { id: started.session.id, ticket: "x".repeat(43) }),
    );
    const otherOwner = yield* Effect.flip(
      hosted.authorize(other, {
        id: started.session.id,
        ticket: Redacted.value(started.ticket),
      }),
    );

    assert.deepStrictEqual(authorized, started.session);
    assert.instanceOf(wrongTicket, HostedLinkingTicketRejected);
    assert.instanceOf(otherOwner, HostedLinkingNotFound);
  }).pipe(Effect.provide(HostedLinkingTestLayer)),
);

it.effect("completes once, stores the validated connection, and discovers teams", () =>
  Effect.gen(function* () {
    const hosted = yield* HostedLinking;
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;
    yield* fake.setTeams([
      {
        provider: decodeProviderKey("yahoo"),
        providerTeamKey: "nfl.l.1000.t.1",
        providerLeagueKey: "nfl.l.1000",
        league: "nfl",
        sport: "football",
        season: 2026,
        name: "Hosted Team",
      },
    ]);
    const started = yield* hosted.start(owner, startInput);

    const completed = yield* hosted.complete(owner, {
      id: started.session.id,
      ticket: Redacted.value(started.ticket),
      provider: decodeProviderKey("yahoo"),
      session,
    });
    const replay = yield* Effect.flip(
      hosted.complete(owner, {
        id: started.session.id,
        ticket: Redacted.value(started.ticket),
        provider: decodeProviderKey("yahoo"),
        session,
      }),
    );
    const replayedStream = yield* Effect.flip(
      hosted.authorize(owner, {
        id: started.session.id,
        ticket: Redacted.value(started.ticket),
      }),
    );

    assert.strictEqual(completed.session.status, "completed");
    assert.strictEqual(completed.session.connectionId, completed.connection.id);
    assert.strictEqual(completed.connection.status, "ready");
    assert.strictEqual(completed.teamsDiscovered, 1);
    assert.instanceOf(replay, HostedLinkingNotActive);
    assert.instanceOf(replayedStream, HostedLinkingNotActive);
    assert.deepStrictEqual(yield* connections.list(owner), [completed.connection]);
    assert.deepStrictEqual(
      (yield* connections.listTeams(owner)).map((team) => team.name),
      ["Hosted Team"],
    );
  }).pipe(Effect.provide(HostedLinkingTestLayer)),
);

it.effect("reconnects an expired connection in place instead of creating another", () =>
  Effect.gen(function* () {
    const hosted = yield* HostedLinking;
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;
    const linked = yield* hosted.start(owner, startInput);
    const first = yield* hosted.complete(owner, {
      id: linked.session.id,
      ticket: Redacted.value(linked.ticket),
      provider: decodeProviderKey("yahoo"),
      session,
    });

    yield* fake.rejectSession(true);
    yield* Effect.flip(connections.discoverTeams(owner, [{ id: first.connection.id }]));
    yield* fake.rejectSession(false);
    const [reconnectRequired] = yield* connections.list(owner);
    assert.strictEqual(reconnectRequired?.status, "reconnect-required");

    const reconnect = yield* hosted.start(owner, {
      provider: decodeProviderKey("yahoo"),
      connectionId: first.connection.id,
    });
    const completed = yield* hosted.complete(owner, {
      id: reconnect.session.id,
      ticket: Redacted.value(reconnect.ticket),
      provider: decodeProviderKey("yahoo"),
      session,
    });

    assert.strictEqual(reconnect.session.connectionId, first.connection.id);
    assert.strictEqual(completed.session.connectionId, first.connection.id);
    assert.strictEqual(completed.connection.id, first.connection.id);
    assert.strictEqual(completed.connection.status, "ready");
    assert.deepStrictEqual(
      (yield* connections.list(owner)).map((connection) => connection.id),
      [first.connection.id],
    );
  }).pipe(Effect.provide(HostedLinkingTestLayer)),
);

it.effect("refuses a reconnect target owned by someone else", () =>
  Effect.gen(function* () {
    const hosted = yield* HostedLinking;
    const links = yield* Connections;
    const linked = yield* hosted.start(other, startInput);
    const foreign = yield* hosted.complete(other, {
      id: linked.session.id,
      ticket: Redacted.value(linked.ticket),
      provider: decodeProviderKey("yahoo"),
      session,
    });

    const error = yield* Effect.flip(
      hosted.start(owner, {
        provider: decodeProviderKey("yahoo"),
        connectionId: foreign.connection.id,
      }),
    );

    assert.strictEqual(error._tag, "connection.not_found");
    assert.deepStrictEqual(yield* links.list(owner), []);
  }).pipe(Effect.provide(HostedLinkingTestLayer)),
);

it.effect("expires a session after its window and refuses completion", () =>
  Effect.gen(function* () {
    const hosted = yield* HostedLinking;
    const connections = yield* Connections;
    const started = yield* hosted.start(owner, startInput);

    yield* TestClock.adjust(Duration.minutes(11));
    const error = yield* Effect.flip(
      hosted.complete(owner, {
        id: started.session.id,
        ticket: Redacted.value(started.ticket),
        provider: decodeProviderKey("yahoo"),
        session,
      }),
    );
    const expired = yield* hosted.expire(owner, [{ id: started.session.id }]);

    assert.instanceOf(error, HostedLinkingExpired);
    assert.strictEqual(expired[0]?.status, "expired");
    assert.deepStrictEqual(yield* connections.list(owner), []);
  }).pipe(Effect.provide(HostedLinkingTestLayer)),
);

it.effect("expires a session explicitly without leaving a connection", () =>
  Effect.gen(function* () {
    const hosted = yield* HostedLinking;
    const connections = yield* Connections;
    const started = yield* hosted.start(owner, startInput);

    const expired = yield* hosted.expire(owner, [{ id: started.session.id }]);

    assert.strictEqual(expired[0]?.status, "expired");
    assert.isUndefined(expired[0]?.connectionId);
    assert.deepStrictEqual(yield* connections.list(owner), []);
  }).pipe(Effect.provide(HostedLinkingTestLayer)),
);

it.effect(
  "cancels idempotently, rejects completion after cancellation, and leaves no connection",
  () =>
    Effect.gen(function* () {
      const hosted = yield* HostedLinking;
      const connections = yield* Connections;
      const started = yield* hosted.start(owner, startInput);

      const cancelled = yield* hosted.cancel(owner, [{ id: started.session.id }]);
      const retried = yield* hosted.cancel(owner, [{ id: started.session.id }]);
      const completion = yield* Effect.flip(
        hosted.complete(owner, {
          id: started.session.id,
          ticket: Redacted.value(started.ticket),
          provider: decodeProviderKey("yahoo"),
          session,
        }),
      );

      assert.strictEqual(cancelled[0]?.status, "cancelled");
      assert.isUndefined(cancelled[0]?.connectionId);
      assert.deepStrictEqual(retried, cancelled);
      assert.instanceOf(completion, HostedLinkingNotActive);
      assert.deepStrictEqual(yield* connections.list(owner), []);
    }).pipe(Effect.provide(HostedLinkingTestLayer)),
);

it.effect("fails a session without leaving a connection behind", () =>
  Effect.gen(function* () {
    const hosted = yield* HostedLinking;
    const connections = yield* Connections;
    const started = yield* hosted.start(owner, startInput);

    const failed = yield* hosted.fail(owner, { id: started.session.id }, "provider_unavailable");

    assert.strictEqual(failed.status, "failed");
    assert.strictEqual(failed.failureReason, "provider_unavailable");
    assert.deepStrictEqual(yield* connections.list(owner), []);
  }).pipe(Effect.provide(HostedLinkingTestLayer)),
);

it.effect("leaves no connection behind when the provider rejects the captured session", () =>
  Effect.gen(function* () {
    const hosted = yield* HostedLinking;
    const connections = yield* Connections;
    const fake = yield* FakeProviderWorld;
    const started = yield* hosted.start(owner, startInput);
    yield* fake.rejectSession(true);

    const error = yield* Effect.flip(
      hosted.complete(owner, {
        id: started.session.id,
        ticket: Redacted.value(started.ticket),
        provider: decodeProviderKey("yahoo"),
        session,
      }),
    );

    assert.instanceOf(error, ConnectionProviderRejected);
    assert.deepStrictEqual(yield* connections.list(owner), []);
  }).pipe(Effect.provide(HostedLinkingTestLayer)),
);

it.effect("refuses a second concurrent session for one owner", () =>
  Effect.gen(function* () {
    const hosted = yield* HostedLinking;
    yield* hosted.start(owner, startInput);

    const error = yield* Effect.flip(hosted.start(owner, startInput));

    assert.instanceOf(error, HostedLinkingSessionActive);
  }).pipe(Effect.provide(HostedLinkingTestLayer)),
);

it.effect("rate-limits repeated session creation", () =>
  Effect.gen(function* () {
    const hosted = yield* HostedLinking;

    for (let index = 0; index < 5; index++) {
      const started = yield* hosted.start(owner, startInput);
      yield* hosted.cancel(owner, [{ id: started.session.id }]);
    }
    const error = yield* Effect.flip(hosted.start(owner, startInput));

    assert.instanceOf(error, HostedLinkingRateLimited);
  }).pipe(Effect.provide(HostedLinkingTestLayer)),
);

const EncryptionTestLayer = ConnectionCredentialEncryption.forKey(
  ConnectionEncryptionKey.fromBytes({
    bytes: new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz012345"),
    keyVersion: 1,
  }),
);

const DataLayer = Layer.merge(ConnectionRepository.layer, HostedLinkingRepository.layer).pipe(
  Layer.provideMerge(ConnectionsDatabaseTest),
);

const ConnectionsTestLayer = ConnectionsLive.pipe(
  Layer.provideMerge(DataLayer),
  Layer.provideMerge(ProviderFakeTest),
  Layer.provide(EncryptionTestLayer),
  Layer.provide(NodeCrypto.layer),
);

const HostedLinkingTestLayer = HostedLinkingLive.pipe(
  Layer.provideMerge(ConnectionsTestLayer),
  Layer.provide(NodeCrypto.layer),
);

const startInput = Schema.decodeSync(StartHostedLinkingInput)({
  provider: decodeProviderKey("yahoo"),
});

const owner = decodeUserId("owner");
const other = decodeUserId("other");
const session = Redacted.make("T=hosted-test-token; Y=hosted-test-user");
