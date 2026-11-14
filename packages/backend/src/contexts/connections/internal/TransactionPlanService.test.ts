import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import type { UserId } from "@lineupkeep/backend/auth/User";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { ConfigProvider, DateTime, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";

import { decodeTeamId } from "#contexts/connections/FantasyTeam.ts";
import type { TeamId } from "#contexts/connections/FantasyTeam.ts";

import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./ConnectionsDatabaseTest.ts";
import { providerTeams } from "./ConnectionTables.ts";
import type {
  TransactionPlanConstraints,
  TransactionPlanPoolPlayer,
  TransactionPlanRosterPlayer,
  TransactionPlanSlot,
  TransactionPlanTeamFacts,
  TransactionPlanTiming,
} from "./TransactionPlanEvaluation.ts";
import type { TransactionMoveId } from "./TransactionPlanRecord.ts";
import { TransactionPlanRepository } from "./TransactionPlanRepository.ts";
import {
  TransactionPlanFacts,
  TransactionPlanFactsUnavailable,
  TransactionPlanService,
  TransactionPlanServiceLive,
  TransactionPlansDisabled,
} from "./TransactionPlanService.ts";
import type { TransactionPlanMoveDraft } from "./TransactionPlanService.ts";
import {
  transactionMoveClaims,
  transactionMoves,
  transactionPlans,
} from "./TransactionPlanTables.ts";

const owner = decodeUserId("owner");
const team = decodeTeamId("01ARZ3NDEKTSV4RRFFQ69G5FAV");
const at = DateTime.makeUnsafe("2026-11-14T12:00:00.000Z");
const today = "2026-11-14";
const proposer = { kind: "agent", reference: "mcp", surface: "mcp" } as const;

it.effect("proposes into an empty team and runs a move with no date now", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const result = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One")],
    });

    assert.deepStrictEqual(result.refused, []);
    assert.strictEqual(result.plan.team, team);
    assert.strictEqual(result.plan.today, today);
    assert.strictEqual(result.plan.moves.length, 1);
    const move = result.plan.moves[0];
    assert.strictEqual(move?.decision, "now");
    assert.strictEqual(move?.runDay, today);
    assert.strictEqual(move?.effectiveDate, "2026-11-15");
    assert.strictEqual(move?.validation.status, "current");
    assert.strictEqual(checkedAtOf(move), DateTime.toEpochMillis(at));
    assert.strictEqual(move?.placement?.toSlot, "BN");
    assert.deepStrictEqual(move?.claims, [{ kind: "player", key: "fa1" }]);
    assert.strictEqual(move?.runPosition, 0);
    assert.deepStrictEqual(move?.dependsOn, []);
    assert.deepStrictEqual(
      move?.projection.map((player) => player.key),
      ["fa1"],
    );

    const plans = yield* database.select().from(transactionPlans);
    assert.strictEqual(plans.length, 1);
    const stored = yield* database.select().from(transactionMoves);
    assert.strictEqual(stored.length, 1);
    assert.strictEqual(stored[0]?.decision, "now");
  }).pipe(Effect.provide(serviceLayer([league([], [freeAgent("fa1", "Free Agent One", ["RB"])])]))),
);

it.effect("proposes into an existing queue and keeps one plan", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One")],
    });
    const second = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa2", "Free Agent Two", { runDay: "2026-11-16" })],
    });

    assert.deepStrictEqual(second.refused, []);
    assert.deepStrictEqual(
      second.plan.moves.map((move) => [move.adds[0]?.key, move.decision]),
      [
        ["fa1", "now"],
        ["fa2", "saved"],
      ],
    );
    assert.deepStrictEqual(
      second.plan.moves.map((move) => move.runPosition),
      [0, 1],
    );
    assert.strictEqual((yield* database.select().from(transactionPlans)).length, 1);
    assert.strictEqual((yield* database.select().from(transactionMoves)).length, 2);
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [],
          [freeAgent("fa1", "Free Agent One", ["RB"]), freeAgent("fa2", "Free Agent Two", ["RB"])],
        ),
      ]),
    ),
  ),
);

it.effect("orders the plan by what each move needs, not by proposal order", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const result = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One"), drop("a1", "Roster One")],
    });

    assert.deepStrictEqual(result.refused, []);
    assert.deepStrictEqual(
      result.plan.moves.map((move) => [move.kind, move.runPosition]),
      [
        ["drop", 0],
        ["free_agent_add", 1],
      ],
    );
    assert.deepStrictEqual(result.plan.moves[1]?.dependsOn.length, 1);
    assert.strictEqual(result.plan.moves[1]?.validation.status, "current");
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["RB"])],
          [freeAgent("fa1", "Free Agent One", ["RB"])],
          { constraints: constraints(2) },
        ),
      ]),
    ),
  ),
);

it.effect("refuses a group whole when one of its moves cannot run", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const result = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [
        { ...drop("a1", "Roster One"), group: "pair" },
        { ...add("w1", "Waiver One"), group: "pair" },
      ],
    });

    assert.deepStrictEqual(
      result.refused.map((refusal) => [refusal.code, refusal.team, refusal.group, refusal.moves]),
      [["player_unavailable", team, "pair", [0, 1]]],
    );
    assert.include(
      result.refused[0]?.detail ?? "",
      "Waiver One is on waivers, so a free-agent add cannot bring them in.",
    );
    assert.deepStrictEqual(result.plan.moves, []);
    assert.deepStrictEqual(yield* database.select().from(transactionMoves), []);
  }).pipe(
    Effect.provide(
      serviceLayer([
        league([rostered("a1", "Roster One", "BN", ["RB"])], [waived("w1", "Waiver One", ["RB"])]),
      ]),
    ),
  ),
);

it.effect("refuses a second drop of the same player in one plan", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const result = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a1", "Roster One"), drop("a1", "Roster One")],
    });

    assert.deepStrictEqual(
      result.refused.map((refusal) => [refusal.code, refusal.team, refusal.moves]),
      [["player_claimed", team, [1]]],
    );
    assert.include(result.refused[0]?.detail ?? "", "already claimed in this plan");
    assert.deepStrictEqual(
      result.plan.moves.map((move) => move.drops[0]?.key),
      ["a1"],
    );
    assert.strictEqual((yield* database.select().from(transactionMoves)).length, 1);
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["RB"])],
          [],
        ),
      ]),
    ),
  ),
);

it.effect("refuses a second move to the same place in one plan", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const result = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [slotMove("a1", "Roster One", "IR"), slotMove("a2", "Roster Two", "IR")],
    });

    assert.deepStrictEqual(
      result.refused.map((refusal) => [refusal.code, refusal.team, refusal.moves]),
      [["place_claimed", team, [1]]],
    );
    assert.include(result.refused[0]?.detail ?? "", "IR place");
    assert.deepStrictEqual(
      result.plan.moves.map((move) => move.slotMove?.playerKey),
      ["a1"],
    );
    assert.strictEqual((yield* database.select().from(transactionMoves)).length, 1);
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["RB"])],
          [],
          { slots: [bench("BN", 2), reserve("IR", ["RB"])] },
        ),
      ]),
    ),
  ),
);

it.effect("saves one move of a group for one day and revalidates the plan", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [
        { ...drop("a1", "Roster One"), group: "pair" },
        { ...drop("a2", "Roster Two"), group: "pair" },
      ],
    });
    const first = proposed.plan.moves.find((move) => move.drops[0]?.key === "a1");
    assert.isDefined(first);

    const saved = yield* service.save(owner, {
      team,
      move: requireMoveId(first),
      runDay: "2026-11-16",
    });

    assert.deepStrictEqual(saved.refused, []);
    assert.deepStrictEqual(
      saved.plan.moves.map((move) => [move.decision, move.runDay, move.effectiveDate]),
      [
        ["saved", "2026-11-16", "2026-11-17"],
        ["saved", "2026-11-16", "2026-11-17"],
      ],
    );
    assert.deepStrictEqual(
      (yield* database.select().from(transactionMoves)).map((move) => [move.runDay, move.decision]),
      [
        ["2026-11-16", "saved"],
        ["2026-11-16", "saved"],
      ],
    );
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["RB"])],
          [],
        ),
      ]),
    ),
  ),
);

it.effect("edits a saved move in place and revalidates the moves after it", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [
        { ...drop("a1", "Roster One"), runDay: "2026-11-16" },
        { ...add("fa1", "Free Agent One"), runDay: "2026-11-16" },
      ],
    });
    assert.deepStrictEqual(proposed.refused, []);
    const edited = proposed.plan.moves.find((move) => move.kind === "free_agent_add");
    const downstream = proposed.plan.moves.find((move) => move.kind === "drop");
    assert.isDefined(edited);
    assert.isDefined(downstream);

    const result = yield* service.edit(owner, {
      team,
      move: requireMoveId(edited),
      change: {
        ...add("fa2", "Free Agent Two"),
        reason: "Add the other free agent instead.",
        runDay: "2026-11-16",
      },
    });

    assert.deepStrictEqual(result.refused, []);
    assert.deepStrictEqual(
      result.plan.moves.map((move) => [move.move, move.kind, move.adds[0]?.key]),
      [
        [requireMoveId(downstream), "drop", undefined],
        [requireMoveId(edited), "free_agent_add", "fa2"],
      ],
    );
    assert.deepStrictEqual(
      result.plan.moves.map((move) => move.validation.status),
      ["current", "current"],
    );
    assert.deepStrictEqual(
      result.plan.moves.map((move) => move.runPosition),
      [0, 1],
    );
    assert.strictEqual(result.plan.moves[1]?.reason, "Add the other free agent instead.");
    assert.strictEqual((yield* database.select().from(transactionMoves)).length, 2);
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["RB"])],
          [freeAgent("fa1", "Free Agent One", ["RB"]), freeAgent("fa2", "Free Agent Two", ["RB"])],
          { constraints: constraints(2) },
        ),
      ]),
    ),
  ),
);

it.effect("refuses an edit that would make a later move impossible", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [
        { ...drop("a1", "Roster One"), runDay: "2026-11-16" },
        { ...add("fa1", "Free Agent One"), runDay: "2026-11-16" },
      ],
    });
    const edited = proposed.plan.moves.find((move) => move.kind === "drop");
    assert.isDefined(edited);

    const result = yield* service.edit(owner, {
      team,
      move: requireMoveId(edited),
      change: {
        ...addWithDrop("fa2", "Free Agent Two", "a1", "Roster One"),
        runDay: "2026-11-16",
      },
    });

    assert.deepStrictEqual(
      result.refused.map((refusal) => [refusal.code, refusal.team]),
      [["roster_full", team]],
    );
    assert.include(result.refused[0]?.detail ?? "", "Add Free Agent One");
    const stored = yield* database.select().from(transactionMoves);
    assert.deepStrictEqual(
      stored.map((move) => move.reason),
      ["Drop Roster One.", "Add Free Agent One."],
    );
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["RB"])],
          [freeAgent("fa1", "Free Agent One", ["RB"]), freeAgent("fa2", "Free Agent Two", ["RB"])],
          { constraints: constraints(2) },
        ),
      ]),
    ),
  ),
);

it.effect("discards one move and leaves the plan's other moves", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a1", "Roster One"), drop("a2", "Roster Two")],
    });
    const discarded = proposed.plan.moves.find((move) => move.drops[0]?.key === "a1");
    assert.isDefined(discarded);

    const result = yield* service.discard(owner, {
      team,
      move: requireMoveId(discarded),
    });

    assert.deepStrictEqual(result.refused, []);
    assert.deepStrictEqual(
      result.plan.moves.map((move) => [move.drops[0]?.key, move.decision]),
      [
        ["a2", "now"],
        ["a1", "discarded"],
      ],
    );
    assert.deepStrictEqual(result.plan.moves[1]?.claims, []);
    assert.deepStrictEqual((yield* database.select().from(transactionPlans)).length, 1);
    assert.strictEqual((yield* database.select().from(transactionMoves)).length, 2);
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["RB"])],
          [],
        ),
      ]),
    ),
  ),
);

it.effect("resolves concurrent proposals to one plan without losing a move", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const results = yield* Effect.all(
      [
        service.propose(owner, {
          team,
          proposedBy: proposer,
          moves: [add("fa1", "Free Agent One")],
        }),
        service.propose(owner, {
          team,
          proposedBy: proposer,
          moves: [add("fa2", "Free Agent Two")],
        }),
      ],
      { concurrency: "unbounded" },
    );

    assert.deepStrictEqual(
      results.flatMap((result) => result.refused),
      [],
    );
    assert.strictEqual((yield* database.select().from(transactionPlans)).length, 1);
    assert.deepStrictEqual(
      (yield* database.select().from(transactionMoveClaims)).map((claim) => claim.claimKey).sort(),
      ["fa1", "fa2"],
    );
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [],
          [freeAgent("fa1", "Free Agent One", ["RB"]), freeAgent("fa2", "Free Agent Two", ["RB"])],
        ),
      ]),
    ),
  ),
);

it.effect("refuses every operation while the switch is off", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const error = yield* service
      .propose(owner, { team, proposedBy: proposer, moves: [add("fa1", "Free Agent One")] })
      .pipe(Effect.flip);

    assert.isTrue(Schema.is(TransactionPlansDisabled)(error));
    assert.include(
      Schema.is(TransactionPlansDisabled)(error) ? error.detail : "",
      "The transaction plan service is off",
    );
    assert.deepStrictEqual(yield* database.select().from(transactionPlans), []);
    assert.deepStrictEqual(yield* database.select().from(transactionMoves), []);
  }).pipe(
    Effect.provide(serviceLayer([league([], [freeAgent("fa1", "Free Agent One", ["RB"])])], false)),
  ),
);

function serviceLayer(
  leagues: ReadonlyArray<League>,
  enabled = true,
): Layer.Layer<TransactionPlanService | ConnectionsDatabase> {
  const byTeam = new Map(leagues.map((entry) => [entry.team, entry.facts] as const));
  const Facts = Layer.succeed(TransactionPlanFacts)({
    read: (input) => {
      const facts = byTeam.get(input.team);
      return facts === undefined
        ? Effect.fail(
            TransactionPlanFactsUnavailable.make({
              team: input.team,
              detail: `No league facts for ${input.team}.`,
            }),
          )
        : Effect.succeed(facts);
    },
  });
  return TransactionPlanServiceLive.pipe(
    Layer.provide(TransactionPlanRepository.layer),
    Layer.provide(Facts),
    Layer.provide(NodeCrypto.layer),
    Layer.provide(
      ConfigProvider.layer(
        ConfigProvider.fromUnknown(enabled ? { TRANSACTION_PLAN_SERVICE: "true" } : {}),
      ),
    ),
    Layer.provideMerge(ConnectionsDatabaseTest),
    Layer.orDie,
  );
}

function seedTeam(
  database: ConnectionsDatabase["Service"],
  userId: UserId,
  teamId: TeamId,
): Effect.Effect<unknown, EffectDrizzleQueryError> {
  return database.insert(providerTeams).values({
    id: teamId,
    connectionId: "connection",
    userId,
    provider: "yahoo",
    providerTeamKey: `team-${teamId}`,
    providerLeagueKey: `league-${teamId}`,
    league: "nhl" as const,
    sport: "hockey" as const,
    season: 2026,
    name: `Team ${teamId}`,
    automationState: {},
    automationStatus: "disabled" as const,
    lastSeenAt: DateTime.toDateUtc(at),
    createdAt: DateTime.toDateUtc(at),
    updatedAt: DateTime.toDateUtc(at),
  });
}

function requireMoveId(move: { readonly move: TransactionMoveId } | undefined): TransactionMoveId {
  if (move === undefined) {
    throw new Error("A test read a move the plan did not carry");
  }
  return move.move;
}

function checkedAtOf(
  move: { readonly validation: { readonly checkedAt?: DateTime.Utc } } | undefined,
): number {
  const checkedAt = move?.validation.checkedAt;
  if (checkedAt === undefined) {
    throw new Error("A test read a check time the plan did not carry");
  }
  return DateTime.toEpochMillis(checkedAt);
}

function league(
  roster: ReadonlyArray<TransactionPlanRosterPlayer>,
  pool: ReadonlyArray<TransactionPlanPoolPlayer>,
  overrides: {
    readonly slots?: ReadonlyArray<TransactionPlanSlot>;
    readonly constraints?: TransactionPlanConstraints;
    readonly timing?: TransactionPlanTiming;
    readonly budget?: number;
  } = {},
): League {
  return {
    team,
    facts: {
      roster,
      pool: new Map(pool.map((player) => [player.key, player] as const)),
      slots: overrides.slots ?? [bench("BN", 4)],
      constraints: overrides.constraints ?? constraints(4),
      today,
      timing: overrides.timing ?? { rule: "next_day", currentDate: today },
      budget: overrides.budget,
    },
  };
}

function constraints(rosterMaximum: number): TransactionPlanConstraints {
  return {
    rosterMaximum,
    benchCapacity: "generic",
    startingSlotsMayStandEmpty: true,
    reserveEligibility: { kind: "published_positions" },
  };
}

function bench(position: string, count: number): TransactionPlanSlot {
  return { position, kind: "bench", count, eligibility: [] };
}

function reserve(position: string, eligibility: ReadonlyArray<string> = []): TransactionPlanSlot {
  return { position, kind: "reserve", count: 1, eligibility };
}

function rostered(
  key: string,
  name: string,
  slot: string,
  positions: ReadonlyArray<string> = [],
): TransactionPlanRosterPlayer {
  return { key, name, positions, slot, injured: false, editable: true };
}

function freeAgent(
  key: string,
  name: string,
  positions: ReadonlyArray<string>,
): TransactionPlanPoolPlayer {
  return { key, name, positions, availability: "free_agent" };
}

function waived(
  key: string,
  name: string,
  positions: ReadonlyArray<string>,
): TransactionPlanPoolPlayer {
  return { key, name, positions, availability: "waiver" };
}

function add(
  key: string,
  name: string,
  extra: Partial<TransactionPlanMoveDraft> = {},
): TransactionPlanMoveDraft {
  return {
    kind: "free_agent_add",
    adds: [key],
    reason: `Add ${name}.`,
    ...extra,
  };
}

function addWithDrop(
  addKey: string,
  addName: string,
  dropKey: string,
  dropName: string,
): TransactionPlanMoveDraft {
  return {
    kind: "free_agent_add",
    adds: [addKey],
    drops: [dropKey],
    reason: `Add ${addName} and drop ${dropName}.`,
  };
}

function drop(key: string, name: string): TransactionPlanMoveDraft {
  return {
    kind: "drop",
    drops: [key],
    reason: `Drop ${name}.`,
  };
}

function slotMove(playerKey: string, playerName: string, toSlot: string): TransactionPlanMoveDraft {
  return {
    kind: "slot_move",
    slotMove: { player: playerKey, toSlot },
    reason: `Move ${playerName} to ${toSlot}.`,
  };
}

type League = {
  readonly team: TeamId;
  readonly facts: TransactionPlanTeamFacts;
};
