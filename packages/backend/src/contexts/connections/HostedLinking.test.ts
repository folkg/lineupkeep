import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { Duration, Effect, Layer, Redacted, Schema } from "effect";
import { TestClock } from "effect/testing";

import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";

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
    const started = yield* hosted.start(owner, startInput);

    assert.strictEqual(started.session.status, "active");
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
    assert.strictEqual(completed.connection.status, "ready");
    assert.strictEqual(completed.teamsDiscovered, 1);
    assert.instanceOf(replay, HostedLinkingNotActive);
    assert.instanceOf(replayedStream, HostedLinkingNotActive);
    assert.deepStrictEqual(yield* connections.list(owner), [completed.connection]);
  }).pipe(Effect.provide(HostedLinkingTestLayer)),
);

it.effect("expires a session after its window and refuses completion", () =>
  Effect.gen(function* () {
    const hosted = yield* HostedLinking;
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
  }).pipe(Effect.provide(HostedLinkingTestLayer)),
);

it.effect("cancels idempotently and rejects completion after cancellation", () =>
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
    const connection = (yield* connections.list(owner))[0];

    assert.strictEqual(cancelled[0]?.status, "cancelled");
    assert.deepStrictEqual(retried, cancelled);
    assert.instanceOf(completion, HostedLinkingNotActive);
    assert.strictEqual(connection?.status, "disconnected");
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
