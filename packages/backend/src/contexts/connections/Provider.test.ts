import { assert, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Redacted } from "effect";

import { FakeProviderWorld, ProviderFakeTest } from "./internal/ProviderFakeTest.ts";
import { ProviderResponseInvalid, ProviderSessionRejected } from "./Provider.ts";
import type { ProviderTeam } from "./Provider.ts";
import { decodeProviderKey } from "./ProviderKey.ts";
import { ProviderRegistry } from "./ProviderRegistry.ts";

it.effect("rejects a session without returning provider data", () =>
  Effect.gen(function* () {
    const world = yield* FakeProviderWorld;
    const provider = yield* testProvider;
    yield* world.rejectSession(true);

    const error = yield* Effect.flip(provider.validateSession(sessionInput));
    const discoveryError = yield* Effect.flip(provider.discoverTeams(sessionInput));

    assert.instanceOf(error, ProviderSessionRejected);
    assert.instanceOf(discoveryError, ProviderSessionRejected);
  }).pipe(Effect.provide(ProviderTestLayer)),
);

it.effect("returns the current deterministic team set", () =>
  Effect.gen(function* () {
    const world = yield* FakeProviderWorld;
    const provider = yield* testProvider;
    const teams: ReadonlyArray<ProviderTeam> = [
      {
        provider: decodeProviderKey("yahoo"),
        providerTeamKey: "nfl.l.1000.t.1",
        providerLeagueKey: "nfl.l.1000",
        league: "nfl",
        sport: "football",
        season: 2026,
        name: "First Team",
      },
      {
        provider: decodeProviderKey("yahoo"),
        providerTeamKey: "nfl.l.1000.t.2",
        providerLeagueKey: "nfl.l.1000",
        league: "nfl",
        sport: "football",
        season: 2026,
        name: "Second Team",
      },
    ];
    yield* world.setTeams(teams);

    assert.deepStrictEqual(yield* provider.discoverTeams(sessionInput), teams);
  }).pipe(Effect.provide(ProviderTestLayer)),
);

it.effect("maps provider failures to stable safe errors", () =>
  Effect.gen(function* () {
    const world = yield* FakeProviderWorld;
    const provider = yield* testProvider;
    yield* world.failRequests("invalid_response");

    const error = yield* Effect.flip(provider.discoverTeams(sessionInput));

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.strictEqual(error.operation, "discover_teams");
  }).pipe(Effect.provide(ProviderTestLayer)),
);

it.effect("blocks discovery until the test releases the gate", () =>
  Effect.gen(function* () {
    const world = yield* FakeProviderWorld;
    const provider = yield* testProvider;
    yield* world.setTeams([
      {
        provider: decodeProviderKey("yahoo"),
        providerTeamKey: "nhl.l.2000.t.3",
        providerLeagueKey: "nhl.l.2000",
        league: "nhl",
        sport: "hockey",
        season: 2026,
        name: "Gated Team",
      },
    ]);
    const gate = yield* world.blockDiscovery;
    const discovery = yield* provider.discoverTeams(sessionInput).pipe(Effect.forkChild);
    yield* Deferred.await(gate.started);

    assert.isUndefined(discovery.pollUnsafe());
    yield* Deferred.succeed(gate.release, undefined);
    const teams = yield* Fiber.join(discovery);

    assert.strictEqual(teams.length, 1);
    assert.strictEqual(teams[0]?.name, "Gated Team");
  }).pipe(Effect.provide(ProviderTestLayer)),
);

it.effect("declares its capabilities without a per-test call", () =>
  Effect.gen(function* () {
    const provider = yield* testProvider;

    assert.strictEqual(provider.capabilities.publishesProjections, false);
    assert.strictEqual(provider.capabilities.publishesCommunityStartRate, true);
    assert.isAbove(provider.capabilities.limitations.length, 0);
  }).pipe(Effect.provide(ProviderTestLayer)),
);

const testProvider = Effect.gen(function* () {
  const registry = yield* ProviderRegistry;
  return yield* registry.requireProvider(decodeProviderKey("yahoo"));
});

const sessionInput = {
  provider: decodeProviderKey("yahoo"),
  session: Redacted.make("fake-session-cookie"),
};

const ProviderTestLayer = ProviderFakeTest;
