import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { Array, DateTime, Effect, Layer, Redacted } from "effect";

import { Connections } from "#contexts/connections/Connections.ts";
import { FantasyQueries } from "#contexts/connections/FantasyQueries.ts";
import { ProviderRegistry, providerRegistryOf } from "#contexts/connections/ProviderRegistry.ts";

import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { FantasyQueriesLive } from "./internal/FantasyQueriesLive.ts";
import { planAssignments } from "./internal/LineupPlanning.ts";
import { resolveTarget } from "./internal/LineupTarget.ts";
import { ObservedFactRepository } from "./internal/ObservedFactRepository.ts";
import { QueryRepository } from "./internal/QueryRepository.ts";
import { QueryTokens } from "./internal/QueryTokens.ts";
import {
  secondProvider,
  secondProviderCapabilities,
  secondProviderKey,
  secondProviderLeague,
  secondProviderRoster,
} from "./internal/SecondProviderFakeTest.ts";

const owner = decodeUserId("owner");

const ConnectionRepositoryTest = ConnectionRepository.layer.pipe(
  Layer.provideMerge(ConnectionsDatabaseTest),
);

const ObservedFactRepositoryTest = ObservedFactRepository.layer.pipe(
  Layer.provide(ConnectionsDatabaseTest),
);

const SecondProviderTestLayer = FantasyQueriesLive.pipe(
  Layer.provideMerge(ConnectionsLive),
  Layer.provideMerge(QueryRepository.layer.pipe(Layer.provide(ConnectionRepositoryTest))),
  Layer.provideMerge(ConnectionRepositoryTest),
  Layer.provideMerge(
    Layer.effect(ProviderRegistry)(
      Effect.succeed(ProviderRegistry.of(providerRegistryOf([secondProvider]))),
    ),
  ),
  Layer.provide(ObservedFactRepositoryTest),
  Layer.provide(
    ConnectionCredentialEncryption.forKey(
      ConnectionEncryptionKey.fromBytes({
        bytes: new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz012345"),
        keyVersion: 1,
      }),
    ).pipe(Layer.provide(NodeCrypto.layer)),
  ),
  Layer.provide(QueryTokens.fromSecret("test-query-token-secret-at-least-32-chars")),
  Layer.provide(NodeCrypto.layer),
  Layer.orDie,
);

it("plans a second provider's dated rotisserie league from its own declared slots", () => {
  const result = planAssignments({
    gamesPlayed: [],
    league: secondProviderLeague,
    roster: secondProviderRoster,
    values: secondProviderRoster.players.map((player) => ({
      providerPlayerKey: player.providerPlayerKey,
      score: player.providerPlayerKey === "atlas.p.3" ? 2400 : 1200,
      availability: "will-play" as const,
    })),
  });

  assert.strictEqual(result.kind, "planned");
  if (result.kind !== "planned") {
    return;
  }
  assert.deepStrictEqual(
    [...result.assignments].sort((left, right) =>
      left.providerPlayerKey.localeCompare(right.providerPlayerKey),
    ),
    [
      { providerPlayerKey: "atlas.p.3", slot: "UTIL" },
      { providerPlayerKey: "atlas.p.4", slot: "BENCH" },
    ],
  );
});

it("resolves a dated target for a second provider without a weekly assumption", () => {
  const now = DateTime.makeUnsafe("2026-11-02T12:00:00.000Z");

  const resolved = resolveTarget(
    { coverage: "current" },
    secondProviderLeague,
    secondProviderCapabilities.fantasyDay,
    now,
  );
  assert.strictEqual(resolved.status, "resolved");
  if (resolved.status === "resolved" && resolved.target.coverage === "date") {
    assert.strictEqual(resolved.target.date, "2026-11-02");
  }

  const weekly = resolveTarget(
    { coverage: "week", week: 3 },
    secondProviderLeague,
    secondProviderCapabilities.fantasyDay,
    now,
  );
  assert.strictEqual(weekly.status, "blocked");
  if (weekly.status === "blocked") {
    assert.strictEqual(weekly.reason, "unsupported_period");
  }
});

it.effect("reads a second provider's weekly search order and states its own schedule bound", () =>
  Effect.gen(function* () {
    const queries = yield* FantasyQueries;
    const connections = yield* Connections;
    const linked = Array.getUnsafe(
      yield* connections.link(owner, [
        { provider: secondProviderKey, session: Redacted.make("A1=second-session") },
      ]),
      0,
    );
    const discovered = yield* connections.discoverTeams(owner, [{ id: linked.id }]);
    const teamId = Array.getUnsafe(discovered, 0).id;

    const weekly = yield* queries.searchPlayers(owner, {
      team: teamId,
      sort: "name",
      statPeriod: "week",
    });
    assert.strictEqual(weekly.status, "ok");

    const summary = yield* queries.getTeamSummary(owner, {
      team: teamId,
      groups: ["league", "roster", "schedule"],
    });
    assert.strictEqual(summary.status, "ok");
    if (summary.status !== "ok") {
      return;
    }
    assert.strictEqual(summary.league?.status, "available");
    if (summary.league?.status === "available") {
      assert.strictEqual(summary.league.scoringType, "rotisserie");
    }
    assert.strictEqual(summary.schedule?.status, "available");
    if (summary.schedule?.status === "available") {
      assert.strictEqual(summary.schedule.coverage, "date");
      assert.include(summary.schedule.detail, "at most 10 dates");
    }
    assert.deepStrictEqual(
      (summary.roster ?? []).map((row) => row.slot),
      secondProviderRoster.players.map((player) => player.slot),
    );
  }).pipe(Effect.provide(SecondProviderTestLayer)),
);
