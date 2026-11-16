import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import type { UserId } from "@lineupkeep/backend/auth/User";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { DateTime, Effect, Fiber, Layer, Option, Schema } from "effect";
import { TestClock } from "effect/testing";

import { decodeTeamId } from "#contexts/connections/FantasyTeam.ts";
import type { TeamId } from "#contexts/connections/FantasyTeam.ts";
import type { PlayerRef } from "#contexts/connections/QueryValues.ts";
import {
  TransactionPlanRunCounts,
  TransactionRunId,
  type TransactionMoveList,
  type TransactionPlanServiceShape,
} from "#contexts/connections/TransactionPlans.ts";
import type {
  TransactionPlanMoveDraft,
  TransactionPlanView,
} from "#contexts/connections/TransactionPlans.ts";

import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./ConnectionsDatabaseTest.ts";
import { providerTeams } from "./ConnectionTables.ts";
import { QueryTokens } from "./QueryTokens.ts";
import type {
  TransactionPlanConstraints,
  TransactionPlanPoolPlayer,
  TransactionPlanRosterPlayer,
  TransactionPlanSlot,
  TransactionPlanTeamFacts,
  TransactionPlanTiming,
} from "./TransactionPlanEvaluation.ts";
import { TransactionMoveId as TransactionMoveIdSchema } from "./TransactionPlanRecord.ts";
import type { TransactionMoveCursor, TransactionMoveId } from "./TransactionPlanRecord.ts";
import { TransactionPlanRepository } from "./TransactionPlanRepository.ts";
import type { TransactionMoveAppend } from "./TransactionPlanRepository.ts";
import {
  TransactionPlanFacts,
  TransactionPlanFactsUnavailable,
  TransactionPlanService,
  TransactionPlanServiceLive,
} from "./TransactionPlanService.ts";
import type { TransactionPlanFactsShape } from "./TransactionPlanService.ts";
import {
  transactionMoveClaims,
  transactionMoveSteps,
  transactionMoves,
  transactionPlans,
  transactionRuns,
} from "./TransactionPlanTables.ts";
import { TransactionPlanWrites } from "./TransactionPlanWrites.ts";
import type {
  TransactionPlanAction,
  TransactionPlanWriteRequest,
  TransactionPlanWritesShape,
} from "./TransactionPlanWrites.ts";

const owner = decodeUserId("owner");
const otherOwner = decodeUserId("other-owner");
const team = decodeTeamId("01ARZ3NDEKTSV4RRFFQ69G5FAV");
const secondTeam = decodeTeamId("01ARZ3NDEKTSV4RRFFQ69G5FAW");
const at = DateTime.makeUnsafe("2026-11-14T12:00:00.000Z");
const today = "2026-11-14";
const proposer = { kind: "agent", reference: "mcp", surface: "mcp" } as const;

it.effect("proposes into an empty team and leaves a move for today undecided", () =>
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
    assert.strictEqual(move?.decision, "undecided");
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
    assert.strictEqual(stored[0]?.decision, "undecided");
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
        ["fa1", "undecided"],
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

it.effect("orders a stash before the add that uses the place it frees", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const result = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One"), stash("a1", "Roster One")],
    });

    assert.deepStrictEqual(result.refused, []);
    assert.deepStrictEqual(
      result.plan.moves.map((move) => [move.kind, move.runPosition, move.validation.status]),
      [
        ["stash", 0, "current"],
        ["free_agent_add", 1, "current"],
      ],
    );
    assert.deepStrictEqual(result.plan.moves[1]?.dependsOn, [requireMoveId(result.plan.moves[0])]);
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["WR"])],
          [freeAgent("fa1", "Free Agent One", ["WR"])],
          { slots: [bench("BN", 2), reserve("IR", ["RB"])], constraints: constraints(2) },
        ),
      ]),
    ),
  ),
);

it.effect("refuses a second stash that claims the same reserve place", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const result = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [stash("a1", "Roster One"), stash("a2", "Roster Two")],
    });

    assert.deepStrictEqual(
      result.refused.map((refusal) => [refusal.code, refusal.moves]),
      [["place_claimed", [1]]],
    );
    assert.deepStrictEqual(
      result.plan.moves.map((move) => [move.intent?.player?.key, move.claims]),
      [["a1", [{ kind: "place", key: "IR" }]]],
    );
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["RB"])],
          [],
          { slots: [bench("BN", 2), reserve("IR", ["RB"])], constraints: constraints(3) },
        ),
      ]),
    ),
  ),
);

it.effect("refuses a proposed move for a player who has already played today", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const result = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a1", "Locked One")],
    });

    assert.deepStrictEqual(
      result.refused.map(({ code, team: refusedTeam, moves }) => [code, refusedTeam, moves]),
      [["player_locked", team, [0]]],
    );
    assert.include(result.refused[0]?.detail ?? "", "Locked One");
    assert.include(
      result.refused[0]?.detail ?? "",
      "Wait until the league unlocks Locked One, or choose another player.",
    );
    assert.deepStrictEqual(result.plan.moves, []);
    assert.deepStrictEqual(yield* database.select().from(transactionMoves), []);
  }).pipe(Effect.provide(serviceLayer([league([locked("a1", "Locked One", "BN", ["RB"])], [])]))),
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

it.effect("amends a saved move's reason and fallbacks in place and revalidates the queue", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    const tokens = yield* QueryTokens;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [{ ...add("fa1", "Free Agent One", { fallbacks: ["fa2"] }), runDay: "2026-11-16" }],
    });
    assert.deepStrictEqual(proposed.refused, []);
    const amended = proposed.plan.moves[0];
    assert.isDefined(amended);
    const storedBefore = yield* database.select().from(transactionMoves);
    const positionBefore = storedBefore[0]?.position;

    yield* TestClock.adjust(60_000);
    const refs = yield* tokens.sealPlayerRefs({
      userId: owner,
      leagueKey: `league-${team}`,
      playerKeys: ["fa1", "fa3"],
    });
    const result = yield* service.proposeRefs(owner, {
      team,
      proposedBy: proposer,
      moves: [
        {
          move: requireMoveId(amended),
          kind: "free_agent_add",
          adds: [requireRef(refs, 0)],
          fallbacks: [requireRef(refs, 1)],
          reason: "Prefer the third fallback.",
        },
      ],
    });

    assert.deepStrictEqual(result.refused, []);
    assert.strictEqual(result.plan.moves.length, 1);
    const changed = result.plan.moves[0];
    assert.strictEqual(changed?.move, requireMoveId(amended));
    assert.strictEqual(changed?.reason, "Prefer the third fallback.");
    assert.deepStrictEqual(
      changed?.fallbacks.map((player) => player.key),
      ["fa3"],
    );
    assert.strictEqual(changed?.runDay, "2026-11-16");
    assert.strictEqual(changed?.decision, "saved");
    assert.strictEqual(changed?.runPosition, 0);
    assert.strictEqual(changed?.validation.status, "current");
    assert.strictEqual(checkedAtOf(changed), DateTime.toEpochMillis(at) + 60_000);
    const storedAfter = yield* database.select().from(transactionMoves);
    assert.strictEqual(storedAfter.length, 1);
    assert.strictEqual(storedAfter[0]?.position, positionBefore);
    assert.deepStrictEqual(
      (yield* database.select().from(transactionMoveClaims)).map((claim) => claim.claimKey).sort(),
      ["fa1", "fa3"],
    );
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [],
          [
            freeAgent("fa1", "Free Agent One", ["RB"]),
            freeAgent("fa2", "Free Agent Two", ["RB"]),
            freeAgent("fa3", "Free Agent Three", ["RB"]),
          ],
        ),
      ]),
    ),
  ),
);

it.effect("changes a saved move's run day and reorders the plan", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    const tokens = yield* QueryTokens;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [
        { ...drop("a1", "Roster One"), runDay: "2026-11-16" },
        { ...drop("a2", "Roster Two"), runDay: "2026-11-17" },
      ],
    });
    assert.deepStrictEqual(proposed.refused, []);
    const before = yield* service.list(owner, { team, state: "saved" });
    assert.deepStrictEqual(
      before.days.map((day) => day.day),
      ["2026-11-16", "2026-11-17"],
    );
    const first = droppedMoveId(proposed.plan, "a1");
    const downstream = droppedMoveId(proposed.plan, "a2");
    const storedBefore = yield* database.select().from(transactionMoves);
    const positionBefore = (move: TransactionMoveId): number | undefined =>
      storedBefore.find((row) => row.id === move)?.position;

    yield* TestClock.adjust(60_000);
    const refs = yield* tokens.sealPlayerRefs({
      userId: owner,
      leagueKey: `league-${team}`,
      playerKeys: ["a1"],
    });
    const result = yield* service.proposeRefs(owner, {
      team,
      proposedBy: proposer,
      moves: [
        {
          move: first,
          kind: "drop",
          drops: [requireRef(refs, 0)],
          reason: "Drop Roster One later.",
          runDay: "2026-11-18",
        },
      ],
    });

    assert.deepStrictEqual(result.refused, []);
    assert.deepStrictEqual(
      result.plan.moves.map((move) => [move.move, move.validation.status]),
      [
        [first, "current"],
        [downstream, "current"],
      ],
    );
    const after = yield* service.list(owner, { team, state: "saved" });
    assert.deepStrictEqual(
      after.days.map((day) => [day.day, day.teams[0]?.moves.map((move) => move.move)]),
      [
        ["2026-11-17", [downstream]],
        ["2026-11-18", [first]],
      ],
    );
    assert.strictEqual(
      checkedAtOf(after.days[0]?.teams[0]?.moves[0]),
      DateTime.toEpochMillis(at) + 60_000,
    );
    const storedAfter = yield* database.select().from(transactionMoves);
    assert.strictEqual(
      storedAfter.find((row) => row.id === first)?.position,
      positionBefore(first),
    );
    assert.strictEqual(
      storedAfter.find((row) => row.id === downstream)?.position,
      positionBefore(downstream),
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

it.effect("refuses an amendment for a move in another owner's queue", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    const tokens = yield* QueryTokens;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    yield* seedTeam(database, otherOwner, secondTeam);

    const other = yield* service.propose(otherOwner, {
      team: secondTeam,
      proposedBy: proposer,
      moves: [drop("a1", "Roster One")],
    });
    const otherMove = requireMoveId(other.plan.moves[0]);
    const refs = yield* tokens.sealPlayerRefs({
      userId: owner,
      leagueKey: `league-${team}`,
      playerKeys: ["a1"],
    });

    const failure = yield* service
      .proposeRefs(owner, {
        team,
        proposedBy: proposer,
        moves: [
          {
            move: otherMove,
            kind: "drop",
            drops: [requireRef(refs, 0)],
            reason: "Amend a move from another account.",
          },
        ],
      })
      .pipe(Effect.flip);

    if (failure._tag !== "transaction_plan.move_not_found") {
      throw new Error(`Expected an amendment refusal, received ${failure._tag}`);
    }
    assert.strictEqual(failure.team, team);
    assert.strictEqual(failure.move, otherMove);
  }).pipe(
    Effect.provide(
      serviceLayer([
        league([rostered("a1", "Roster One", "BN", ["RB"])], []),
        leagueFor(secondTeam, [rostered("a1", "Roster One", "BN", ["RB"])], []),
      ]),
    ),
  ),
);

it.effect("discards a saved move and leaves the plan open", () =>
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
        { ...drop("a2", "Roster Two"), runDay: "2026-11-16" },
      ],
    });
    const discarded = droppedMoveId(proposed.plan, "a1");

    const result = yield* service.discard(owner, { team, move: discarded });

    assert.deepStrictEqual(result.refused, []);
    assert.deepStrictEqual(
      result.plan.moves.map((move) => [move.drops[0]?.key, move.decision]),
      [
        ["a2", "saved"],
        ["a1", "discarded"],
      ],
    );
    const open = yield* service.list(owner, { team, state: "saved" });
    assert.deepStrictEqual(
      open.moves.map((move) => move.move),
      [droppedMoveId(result.plan, "a2")],
    );
    assert.strictEqual((yield* database.select().from(transactionPlans)).length, 1);
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

it.effect("rechecks the queue after discarding the move that funds an add", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One"), drop("a2", "Roster Two")],
    });
    assert.deepStrictEqual(proposed.refused, []);
    assert.deepStrictEqual(
      proposed.plan.moves.map((move) => [move.kind, move.runPosition]),
      [
        ["drop", 0],
        ["free_agent_add", 1],
      ],
    );
    const funder = proposed.plan.moves.find((move) => move.kind === "drop");
    const funded = proposed.plan.moves.find((move) => move.kind === "free_agent_add");

    const result = yield* service.discard(owner, {
      team,
      move: requireMoveId(funder),
    });

    const remaining = result.plan.moves.find((move) => move.move === requireMoveId(funded));
    assert.strictEqual(remaining?.validation.status, "stale");
    assert.deepStrictEqual(
      remaining?.validation.reasons.map((reason) => reason.code),
      ["roster_full"],
    );
    assert.strictEqual(remaining?.runPosition, undefined);
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

it.effect("refuses to discard a move that has already run", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [{ ...drop("a1", "Roster One"), runDay: "2026-11-16" }],
    });
    const move = requireMoveId(proposed.plan.moves[0]);
    yield* repository.recordResult({
      userId: owner,
      team,
      move,
      result: "executed",
      detail: undefined,
      externalRef: undefined,
      at,
    });

    const result = yield* service.discard(owner, { team, move });

    assert.deepStrictEqual(
      result.refused.map((refusal) => [refusal.code, refusal.team]),
      [["move_not_open", team]],
    );
    assert.include(result.refused[0]?.detail ?? "", "has ended");
    const stored = yield* database.select().from(transactionMoves);
    assert.strictEqual(stored[0]?.decision, "saved");
  }).pipe(Effect.provide(serviceLayer([league([rostered("a1", "Roster One", "BN", ["RB"])], [])]))),
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
        ["a2", "undecided"],
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

it.effect("discards a failed move and a stale move out of the open list", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(
      team,
      league(
        [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["RB"])],
        [],
        { slots: [bench("BN", 2)], constraints: constraints(2) },
      ).facts,
    );

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a1", "Roster One"), { ...drop("a2", "Roster Two"), runDay: "2026-11-16" }],
    });
    const failed = droppedMoveId(proposed.plan, "a1");
    const stale = droppedMoveId(proposed.plan, "a2");
    yield* repository.recordResult({
      userId: owner,
      team,
      move: failed,
      result: "failed",
      detail: "Your league rejected the drop.",
      externalRef: undefined,
      at,
    });

    facts.set(
      team,
      league([rostered("a1", "Roster One", "BN", ["RB"])], [], {
        slots: [bench("BN", 2)],
        constraints: constraints(2),
      }).facts,
    );
    const before = yield* service.plan(owner, { team });
    assert.strictEqual(before.moves.find(({ move }) => move === stale)?.validation.status, "stale");

    yield* service.discard(owner, { team, move: failed });
    yield* service.discard(owner, { team, move: stale });

    const after = yield* service.plan(owner, { team });
    assert.deepStrictEqual(
      after.moves
        .filter(({ move }) => move === failed || move === stale)
        .map(({ decision }) => decision),
      ["discarded", "discarded"],
    );
    const open = yield* service.list(owner, { team });
    assert.deepStrictEqual(open.moves, []);
    const counts = yield* service.counts(owner, { team });
    assert.strictEqual(counts.totals.open, 0);
    assert.strictEqual(counts.totals.ended, 2);
  }).pipe(Effect.provide(mutableFactsLayer(facts)));
});

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

it.effect("rechecks a saved drop when the league no longer rosters the player", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(
      team,
      league(
        [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["RB"])],
        [],
      ).facts,
    );

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [{ ...drop("a1", "Roster One"), runDay: "2026-11-16" }],
    });

    const readAt = DateTime.addDuration(at, 6 * 60 * 60 * 1000);
    yield* TestClock.setTime(DateTime.toEpochMillis(readAt));
    facts.set(team, league([rostered("a2", "Roster Two", "BN", ["RB"])], []).facts);

    const read = yield* service.plan(owner, { team });

    assert.strictEqual(read.moves.length, 1);
    const move = read.moves[0];
    assert.strictEqual(move?.decision, "saved");
    assert.strictEqual(move?.runDay, "2026-11-16");
    assert.strictEqual(move?.validation.status, "stale");
    assert.deepStrictEqual(
      move?.validation.reasons.map((reason) => reason.code),
      ["drop_not_rostered"],
    );
    assert.deepStrictEqual(move?.check, { status: "checked" });
    assert.strictEqual(move === undefined ? 0 : checkedAtOf(move), DateTime.toEpochMillis(readAt));
  }).pipe(Effect.provide(mutableFactsLayer(facts)));
});

it.effect("publishes places and each reserve list on the plan read", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(
      team,
      league(
        [
          rostered("a1", "Roster One", "BN", ["RB"]),
          rostered("a2", "Roster Two", "BN", ["RB"]),
          { ...rostered("a3", "Roster Three", "IR", ["RB"]), injured: true },
        ],
        [],
        {
          slots: [bench("BN", 2), reserve("IR", ["RB"]), reserve("IR+", ["RB"])],
          constraints: constraints(2),
        },
      ).facts,
    );

    const read = yield* service.plan(owner, { team });

    assert.deepStrictEqual(read.places, { used: 2, maximum: 2, free: 0 });
    assert.deepStrictEqual(read.reserve, [
      {
        name: "IR",
        eligibility: { kind: "published_positions", positions: ["RB"] },
        capacity: 1,
        occupied: 1,
        free: 0,
      },
      {
        name: "IR+",
        eligibility: { kind: "published_positions", positions: ["RB"] },
        capacity: 1,
        occupied: 0,
        free: 1,
      },
    ]);
  }).pipe(Effect.provide(mutableFactsLayer(facts)));
});

it.effect("counts a player in IR+ and accepts an add that fits", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(
      team,
      league(
        [
          rostered("a1", "Roster One", "BN", ["RB"]),
          { ...rostered("a2", "Roster Two", "IR+", ["RB"]), injured: true },
        ],
        [freeAgent("fa1", "Free Agent One", ["RB"])],
        {
          slots: [bench("BN", 2), { ...reserve("IR+", ["RB"]), count: 2 }],
          constraints: constraints(2),
        },
      ).facts,
    );

    const result = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One")],
    });
    assert.deepStrictEqual(result.refused, []);

    const read = yield* service.plan(owner, { team });
    assert.deepStrictEqual(read.snapshot, {
      status: "live",
      checkedAt: at,
      source: "week 1",
    });
    assert.deepStrictEqual(read.places, { used: 1, maximum: 2, free: 1 });
    assert.deepStrictEqual(read.reserve, [
      {
        name: "IR+",
        eligibility: { kind: "published_positions", positions: ["RB"] },
        capacity: 2,
        occupied: 1,
        free: 1,
      },
    ]);
    assert.deepStrictEqual(read.moves[0]?.validation, {
      status: "current",
      checkedAt: at,
      reasons: [],
    });
  }).pipe(Effect.provide(mutableFactsLayer(facts)));
});

it.effect("states the last recorded check when the live roster cannot be read", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(team, league([rostered("a1", "Roster One", "BN", ["RB"])], []).facts);

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a1", "Roster One")],
    });
    facts.delete(team);

    const read = yield* service.plan(owner, { team });
    assert.strictEqual(read.snapshot.status, "stored");
    assert.strictEqual(
      read.snapshot.status === "stored"
        ? DateTime.toEpochMillis(read.snapshot.checkedAt)
        : undefined,
      DateTime.toEpochMillis(at),
    );
    assert.include(
      read.snapshot.status === "stored" ? read.snapshot.note : "",
      "most recent recorded check",
    );
    assert.strictEqual(read.places, undefined);
    assert.strictEqual(read.moves[0]?.check.status, "last_checked");
  }).pipe(Effect.provide(mutableFactsLayer(facts)));
});

it.effect("flags a saved free-agent add when the league moves the player to waivers", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(team, league([], [freeAgent("fa1", "Free Agent One", ["RB"])]).facts);

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [{ ...add("fa1", "Free Agent One"), runDay: "2026-11-16" }],
    });

    const readAt = DateTime.addDuration(at, 6 * 60 * 60 * 1000);
    yield* TestClock.setTime(DateTime.toEpochMillis(readAt));
    facts.set(team, league([], [waived("fa1", "Free Agent One", ["RB"])]).facts);
    const waivedRead = yield* service.plan(owner, { team });
    assert.strictEqual(waivedRead.moves[0]?.validation.status, "stale");
    assert.deepStrictEqual(
      waivedRead.moves[0]?.validation.reasons.map(({ code, detail }) => [code, detail]),
      [
        [
          "player_unavailable",
          "Free Agent One is on waivers, so a free-agent add cannot bring them in.",
        ],
      ],
    );

    facts.set(team, league([], []).facts);
    const taken = yield* service.plan(owner, { team });
    assert.strictEqual(taken.moves[0]?.validation.status, "stale");
    assert.deepStrictEqual(
      taken.moves[0]?.validation.reasons.map(({ code, detail }) => [code, detail]),
      [["player_unavailable", "Free Agent One is not in the league's available player pool."]],
    );
  }).pipe(Effect.provide(mutableFactsLayer(facts)));
});

it.effect("flags an open move when its player becomes locked before the read", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(team, league([rostered("a1", "Roster One", "BN", ["RB"])], []).facts);

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a1", "Roster One")],
    });

    const readAt = DateTime.addDuration(at, 6 * 60 * 60 * 1000);
    yield* TestClock.setTime(DateTime.toEpochMillis(readAt));
    facts.set(team, league([locked("a1", "Roster One", "BN", ["RB"])], []).facts);

    const read = yield* service.plan(owner, { team });
    assert.strictEqual(read.moves[0]?.validation.status, "stale");
    assert.deepStrictEqual(
      read.moves[0]?.validation.reasons.map(({ code, detail }) => [code, detail]),
      [
        [
          "player_locked",
          "Roster One has already played or is locked in their place today, so this move cannot drop them. Wait until the league unlocks Roster One, or choose another player.",
        ],
      ],
    );
  }).pipe(Effect.provide(mutableFactsLayer(facts)));
});

it.effect("reads a healthy player in an injury reserve place as illegal", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(
      team,
      league(
        [
          rostered("a1", "Roster One", "RB", ["RB"]),
          rostered("h1", "Healthy Reserve", "IR", ["RB"]),
        ],
        [],
        {
          slots: [starting("RB", ["RB"]), bench("BN", 1), reserve("IR", ["RB"])],
          constraints: constraints(2, { reserveEligibility: { kind: "injury_status" } }),
        },
      ).facts,
    );

    yield* repository.appendMoves({
      userId: owner,
      team,
      at,
      moves: [storedDrop("a1", "Roster One")],
    });

    const read = yield* service.plan(owner, { team });
    const move = read.moves[0];

    assert.strictEqual(move?.validation.status, "illegal");
    assert.deepStrictEqual(
      move?.validation.reasons.map((reason) => reason.code),
      ["slot_illegal"],
    );
    assert.include(
      move?.validation.reasons[0]?.detail ?? "",
      "Healthy Reserve is no longer injured but sits in IR.",
    );
  }).pipe(Effect.provide(mutableFactsLayer(facts)));
});

it.effect("groups the timeline by run day and team with today first", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    yield* seedTeam(database, owner, secondTeam);
    facts.set(
      team,
      league(
        [
          rostered("a1", "Roster One", "BN", ["RB"]),
          rostered("a2", "Roster Two", "BN", ["RB"]),
          rostered("a3", "Roster Three", "BN", ["RB"]),
        ],
        [],
        { slots: [bench("BN", 3)], constraints: constraints(3) },
      ).facts,
    );
    facts.set(
      secondTeam,
      leagueFor(
        secondTeam,
        [rostered("b1", "Other One", "BN", ["RB"]), rostered("b2", "Other Two", "BN", ["RB"])],
        [],
        { slots: [bench("BN", 2)], constraints: constraints(2) },
      ).facts,
    );

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [
        drop("a1", "Roster One"),
        { ...drop("a2", "Roster Two"), runDay: "2026-11-16" },
        { ...drop("a3", "Roster Three"), runDay: "2026-11-15" },
      ],
    });
    yield* service.propose(owner, {
      team: secondTeam,
      proposedBy: proposer,
      moves: [{ ...drop("b1", "Other One"), runDay: "2026-11-15" }, drop("b2", "Other Two")],
    });

    const timeline = yield* service.timeline(owner, {});

    assert.deepStrictEqual(
      timeline.days.map((day) => [day.day, day.today, day.teams.map(({ team }) => team.id)]),
      [
        ["2026-11-14", true, [team, secondTeam]],
        ["2026-11-15", false, [team, secondTeam]],
        ["2026-11-16", false, [team]],
      ],
    );
    assert.deepStrictEqual(
      timeline.moves.map(({ team, position }) => [team.id, position]),
      [
        [team, 0],
        [secondTeam, 1],
        [team, 2],
        [secondTeam, 0],
        [team, 1],
      ],
    );
    assert.deepStrictEqual(
      timeline.days[0]?.teams
        .map(({ moves }) => moves.map(({ move }) => move))
        .map((ids) => ids.length),
      [1, 1],
    );

    const plan = yield* service.plan(owner, { team });

    assert.strictEqual(plan.today, "2026-11-14");
    assert.deepStrictEqual(
      plan.moves.map(({ decision, runDay }) => [decision, runDay]),
      [
        ["undecided", "2026-11-14"],
        ["saved", "2026-11-16"],
        ["saved", "2026-11-15"],
      ],
    );
    assert.deepStrictEqual(
      plan.days.map(({ day, today, moves }) => [day, today, moves.length]),
      [
        ["2026-11-14", true, 1],
        ["2026-11-16", false, 1],
        ["2026-11-15", false, 1],
      ],
    );
  }).pipe(Effect.provide(mutableFactsLayer(facts)));
});

it.effect("keeps a team's ended moves in its plan read", () =>
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
    yield* service.discard(owner, { team, move: droppedMoveId(proposed.plan, "a2") });

    const plan = yield* service.plan(owner, { team });

    assert.deepStrictEqual(
      plan.moves.map(({ decision, check }) => [decision, check.status]),
      [
        ["undecided", "checked"],
        ["discarded", "stored"],
      ],
    );
    assert.deepStrictEqual(
      plan.days.map(({ day, moves }) => [day, moves.length]),
      [
        [today, 1],
        [undefined, 1],
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

it.effect("counts open, today, saved, and ended moves, overall and per team", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    yield* seedTeam(database, owner, secondTeam);
    facts.set(
      team,
      league(
        [
          rostered("a1", "Roster One", "BN", ["RB"]),
          rostered("a2", "Roster Two", "BN", ["RB"]),
          rostered("a3", "Roster Three", "BN", ["RB"]),
          rostered("a4", "Roster Four", "BN", ["RB"]),
        ],
        [],
        { slots: [bench("BN", 4)], constraints: constraints(4) },
      ).facts,
    );
    facts.set(
      secondTeam,
      leagueFor(secondTeam, [rostered("b1", "Other One", "BN", ["RB"])], [], {
        slots: [bench("BN", 1)],
        constraints: constraints(1),
      }).facts,
    );

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a1", "Roster One"), { ...drop("a2", "Roster Two"), runDay: "2026-11-16" }],
    });
    const discarded = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a3", "Roster Three")],
    });
    yield* service.discard(owner, { team, move: droppedMoveId(discarded.plan, "a3") });
    const executed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a4", "Roster Four")],
    });
    yield* repository.recordResult({
      userId: owner,
      team,
      move: droppedMoveId(executed.plan, "a4"),
      result: "executed",
      detail: "The league accepted the drop.",
      externalRef: undefined,
      at,
    });
    yield* service.propose(owner, {
      team: secondTeam,
      proposedBy: proposer,
      moves: [drop("b1", "Other One")],
    });

    const all = yield* service.counts(owner, {});

    assert.strictEqual(all.teamCount, 2);
    assert.deepStrictEqual(all.totals, { open: 3, today: 2, saved: 1, ended: 2 });
    assert.deepStrictEqual(all.teams, [
      { team, open: 2, today: 1, saved: 1, ended: 2 },
      { team: secondTeam, open: 1, today: 1, saved: 0, ended: 0 },
    ]);

    const one = yield* service.counts(owner, { team });

    assert.deepStrictEqual(one, {
      totals: { open: 2, today: 1, saved: 1, ended: 2 },
      teams: [{ team, open: 2, today: 1, saved: 1, ended: 2 }],
      teamCount: 1,
    });
  }).pipe(Effect.provide(mutableFactsLayer(facts)));
});

it.effect("pages the timeline by run day, team, position, and move", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [
        drop("a1", "Roster One"),
        { ...drop("a2", "Roster Two"), runDay: "2026-11-15" },
        { ...drop("a3", "Roster Three"), runDay: "2026-11-16" },
        drop("a4", "Roster Four"),
        { ...drop("a5", "Roster Five"), runDay: "2026-11-15" },
      ],
    });

    const full = yield* service.timeline(owner, {});
    const pages = [];
    let after: TransactionMoveCursor | undefined = undefined;
    do {
      const page: TransactionMoveList = yield* service.timeline(owner, {
        ...(after === undefined ? {} : { after }),
        limit: 2,
      });
      pages.push(page);
      after = page.page.next;
    } while (after !== undefined);

    assert.deepStrictEqual(
      pages.map((page) => [page.page.returned, page.page.complete]),
      [
        [2, false],
        [2, false],
        [1, true],
      ],
    );
    assert.deepStrictEqual(
      pages.flatMap((page) => page.moves.map(({ move }) => move)),
      full.moves.map(({ move }) => move),
    );
    assert.deepStrictEqual(
      pages[0]?.days.map((day) => [day.day, day.today]),
      [["2026-11-14", true]],
    );
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [
            rostered("a1", "Roster One", "BN", ["RB"]),
            rostered("a2", "Roster Two", "BN", ["RB"]),
            rostered("a3", "Roster Three", "BN", ["RB"]),
            rostered("a4", "Roster Four", "BN", ["RB"]),
            rostered("a5", "Roster Five", "BN", ["RB"]),
          ],
          [],
          { slots: [bench("BN", 5)], constraints: constraints(5) },
        ),
      ]),
    ),
  ),
);

it.effect("returns the stored check and its time when the league cannot be read", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(
      team,
      league(
        [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["RB"])],
        [],
      ).facts,
    );

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [{ ...drop("a1", "Roster One"), runDay: "2026-11-16" }],
    });

    facts.clear();
    const readAt = DateTime.addDuration(at, 3 * 60 * 60 * 1000);
    yield* TestClock.setTime(DateTime.toEpochMillis(readAt));

    const timeline = yield* service.timeline(owner, {});
    const move = timeline.moves[0];

    assert.strictEqual(move?.validation.status, "current");
    assert.strictEqual(move === undefined ? 0 : checkedAtOf(move), DateTime.toEpochMillis(at));
    assert.deepStrictEqual(move?.check, {
      status: "last_checked",
      note: `Last checked ${DateTime.formatIso(at)}.`,
    });
    assert.isTrue(move?.check.status !== "checked");

    const plan = yield* service.plan(owner, { team });

    assert.strictEqual(plan.today, undefined);
    assert.deepStrictEqual(plan.moves[0]?.check, {
      status: "last_checked",
      note: `Last checked ${DateTime.formatIso(at)}.`,
    });
  }).pipe(Effect.provide(mutableFactsLayer(facts)));
});

it.effect("lists one team's moves by today, saved, and ended", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(
      team,
      league(
        [
          rostered("a1", "Roster One", "BN", ["RB"]),
          rostered("a2", "Roster Two", "BN", ["RB"]),
          rostered("a3", "Roster Three", "BN", ["RB"]),
          rostered("a4", "Roster Four", "BN", ["RB"]),
        ],
        [],
        { slots: [bench("BN", 4)], constraints: constraints(4) },
      ).facts,
    );

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a1", "Roster One"), { ...drop("a2", "Roster Two"), runDay: "2026-11-16" }],
    });
    const discarded = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a3", "Roster Three")],
    });
    yield* service.discard(owner, { team, move: droppedMoveId(discarded.plan, "a3") });
    const executed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a4", "Roster Four")],
    });
    yield* repository.recordResult({
      userId: owner,
      team,
      move: droppedMoveId(executed.plan, "a4"),
      result: "executed",
      detail: "The league accepted the drop.",
      externalRef: undefined,
      at,
    });

    const now = yield* service.list(owner, { team, state: "today" });
    assert.strictEqual(now.team?.id, team);
    assert.deepStrictEqual(
      now.moves.map(({ move }) => move),
      [droppedMoveId(proposed.plan, "a1")],
    );
    assert.deepStrictEqual(
      now.moves.map(({ decision }) => decision),
      ["undecided"],
    );

    const defaulted = yield* service.list(owner, { team });
    assert.deepStrictEqual(
      defaulted.moves.map(({ move }) => move),
      now.moves.map(({ move }) => move),
    );

    const saved = yield* service.list(owner, { team, state: "saved" });
    assert.deepStrictEqual(
      saved.moves.map(({ runDay }) => runDay),
      ["2026-11-16"],
    );
    assert.deepStrictEqual(
      saved.days.map((day) => [day.day, day.today]),
      [["2026-11-16", false]],
    );

    const ended = yield* service.list(owner, { team, state: "ended" });
    assert.deepStrictEqual(ended.moves.map(({ result, decision }) => result ?? decision).sort(), [
      "discarded",
      "executed",
    ]);
    assert.isTrue(ended.moves.every(({ check }) => check.status === "stored"));

    const everyTeam = yield* service.list(owner, { state: "today" });
    assert.strictEqual(everyTeam.team, undefined);
    assert.strictEqual(everyTeam.moves.length, 1);
  }).pipe(Effect.provide(mutableFactsLayer(facts)));
});

it.effect("submits today's chosen move and records its result, steps, and check time", () => {
  const writes = writeLayer(() => ({ status: "executed" }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One"), add("fa2", "Free Agent Two", { runDay: "2026-11-15" })],
    });

    const result = yield* confirmDue(service, team);

    assert.deepStrictEqual(result.counts, {
      plans: 1,
      claimed: 1,
      busy: 0,
      recovered: 0,
      unavailable: 0,
      moves: 1,
      executed: 1,
      pending: 0,
      failed: 0,
      skipped: 0,
      unknown: 0,
      retry: 0,
    });
    assert.deepStrictEqual(result.refusals, []);
    assert.strictEqual(writes.requests.length, 1);
    assert.strictEqual(writes.requests[0]?.kind, "free_agent_add");
    assert.deepStrictEqual(writes.requests[0]?.adds, ["fa1"]);

    const stored = yield* repository.readPlanMoves({ userId: owner, team });
    const submitted = stored.find((move) => move.adds[0]?.key === "fa1");
    assert.strictEqual(submitted?.result, "executed");
    assert.strictEqual(submitted?.decision, "now");
    assert.strictEqual(submitted?.runDay, today);
    assert.strictEqual(submitted?.effectiveDate, "2026-11-15");
    assert.strictEqual(checkedAtOf(submitted), DateTime.toEpochMillis(at));
    const resultAt = submitted?.resultAt;
    if (resultAt === undefined) {
      throw new Error("The submitted move did not record a result time");
    }
    assert.strictEqual(DateTime.formatIso(resultAt), DateTime.formatIso(at));
    assert.strictEqual(stored.find((move) => move.adds[0]?.key === "fa2")?.result, undefined);

    const steps = yield* database.select().from(transactionMoveSteps);
    assert.deepStrictEqual(
      steps.map((step) => [step.kind, step.playerKey, step.outcome]),
      [["add", "fa1", "executed"]],
    );

    const plans = yield* database.select().from(transactionPlans);
    assert.strictEqual(plans[0]?.runClaim, null);

    const read = yield* service.plan(owner, { team });
    assert.strictEqual(read.moves.find((move) => move.move === submitted?.id)?.result, "executed");
  }).pipe(
    Effect.provide(
      serviceLayer(
        [
          league(
            [],
            [
              freeAgent("fa1", "Free Agent One", ["RB"]),
              freeAgent("fa2", "Free Agent Two", ["RB"]),
            ],
          ),
        ],
        writes.layer,
      ),
    ),
  );
});

it.effect("confirms today's move, runs only it, and discards another", () => {
  const writes = writeLayer(() => ({ status: "executed" }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One"), add("fa2", "Free Agent Two")],
    });
    const first = proposed.plan.moves[0];
    const second = proposed.plan.moves[1];
    if (first === undefined || second === undefined) {
      throw new Error("Expected two proposed moves");
    }

    const result = yield* service.confirm(owner, {
      team,
      moves: [first.move],
      key: "confirm-one",
    });
    const discarded = yield* service.discard(owner, { team, move: second.move });

    assert.deepStrictEqual(discarded.refused, []);
    assert.strictEqual(result.counts.moves, 1);
    assert.strictEqual(result.counts.executed, 1);
    assert.deepStrictEqual(result.refusals, []);
    assert.strictEqual(writes.requests.length, 1);
    assert.deepStrictEqual(writes.requests[0]?.adds, ["fa1"]);

    const stored = yield* repository.readPlanMoves({ userId: owner, team });
    assert.strictEqual(stored.find((move) => move.id === first.move)?.result, "executed");
    assert.strictEqual(stored.find((move) => move.id === second.move)?.decision, "discarded");
  }).pipe(
    Effect.provide(
      serviceLayer(
        [
          league(
            [],
            [
              freeAgent("fa1", "Free Agent One", ["RB"]),
              freeAgent("fa2", "Free Agent Two", ["RB"]),
            ],
          ),
        ],
        writes.layer,
      ),
    ),
  );
});

it.effect("waits for a recorded run that is still in progress", () => {
  const writes = writeLayer(() => ({ status: "executed" }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    const runId = yield* Schema.decodeEffect(TransactionRunId)("01K00000000000000000000001");
    const started = {
      plans: 1,
      claimed: 1,
      busy: 0,
      recovered: 0,
      unavailable: 0,
      moves: 0,
      executed: 0,
      pending: 0,
      failed: 0,
      skipped: 0,
      unknown: 0,
      retry: 0,
    } as const;
    yield* repository.beginRun({
      userId: owner,
      team,
      run: runId,
      trigger: "submit",
      decision: { decidedBy: "owner", surface: "transactions.submit" },
      key: "in-progress-key",
      counts: started,
      refusals: [],
      at,
    });

    const fiber = yield* Effect.forkChild(service.submit(owner, { team, key: "in-progress-key" }));
    yield* Effect.yieldNow;
    yield* TestClock.adjust(300);
    yield* repository.finishRun({
      run: runId,
      counts: { ...started, recovered: 1 },
      refusals: [],
      at,
    });
    yield* TestClock.adjust(300);
    const result = yield* Fiber.join(fiber);

    assert.strictEqual(result.counts.recovered, 1);
    assert.strictEqual(writes.requests.length, 0);
  }).pipe(
    Effect.provide(
      serviceLayer([league([], [freeAgent("fa1", "Free Agent One", ["RB"])])], writes.layer),
    ),
  );
});

it.effect("runs a confirmed future move on the check after its day, recording both times", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  const writes = writeLayer(() => ({ status: "executed" }));
  const later = DateTime.makeUnsafe("2026-11-15T12:00:00.000Z");
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(team, league([rostered("a1", "Roster One", "BN", ["RB"])], []).facts);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [{ ...drop("a1", "Roster One"), runDay: "2026-11-15" }],
    });
    const confirmed = yield* service.confirm(owner, {
      team,
      moves: [requireMoveId(proposed.plan.moves[0])],
      key: "confirm-future",
    });

    assert.strictEqual(confirmed.counts.moves, 0);
    assert.strictEqual(writes.requests.length, 0);
    const confirmedMove = confirmed.plan.moves[0];
    assert.strictEqual(confirmedMove?.decision, "confirmed");
    assert.strictEqual(
      DateTime.formatIso(Option.getOrThrow(Option.fromNullishOr(confirmedMove?.confirmation?.at))),
      DateTime.formatIso(at),
    );
    assert.strictEqual(confirmedMove?.confirmation?.by, owner);
    assert.strictEqual(confirmedMove?.runAt, undefined);
    assert.strictEqual(confirmedMove?.decidedBy, "owner");
    assert.strictEqual(confirmedMove?.surface, "transactions.confirm");

    const early = yield* service.runDue(10, at);
    assert.strictEqual(early.counts.moves, 0);
    assert.strictEqual(writes.requests.length, 0);

    const current = facts.get(team);
    if (current === undefined) {
      throw new Error("The league facts were not seeded");
    }
    facts.set(team, { ...current, today: "2026-11-15" });
    const run = yield* service.runDue(10, later);

    assert.strictEqual(run.counts.executed, 1);
    assert.strictEqual(writes.requests.length, 1);
    const stored = yield* repository.readPlanMoves({ userId: owner, team });
    assert.strictEqual(stored[0]?.result, "executed");
    assert.strictEqual(stored[0]?.decision, "confirmed");
    assert.strictEqual(stored[0]?.runDay, "2026-11-15");
    assert.strictEqual(
      DateTime.formatIso(Option.getOrThrow(Option.fromNullishOr(stored[0]?.confirmedAt))),
      DateTime.formatIso(at),
    );
    assert.strictEqual(
      DateTime.formatIso(Option.getOrThrow(Option.fromNullishOr(stored[0]?.runAt))),
      DateTime.formatIso(later),
    );

    const read = yield* service.plan(owner, { team });
    assert.strictEqual(
      DateTime.formatIso(Option.getOrThrow(Option.fromNullishOr(read.moves[0]?.runAt))),
      DateTime.formatIso(later),
    );
    assert.strictEqual(read.moves[0]?.decidedBy, "owner");
    assert.strictEqual(read.moves[0]?.surface, "transactions.confirm");
    assert.strictEqual(read.moves[0]?.runDecidedBy, "system");
    assert.strictEqual(read.moves[0]?.runSurface, "automation.run");

    const runs = yield* database.select().from(transactionRuns);
    assert.strictEqual(runs.length, 1);
    const tickRun = runs[0];
    if (tickRun === undefined) {
      throw new Error("The tick did not record a run");
    }
    assert.strictEqual(tickRun.trigger, "tick");
    assert.strictEqual(tickRun.decidedBy, "system");
    assert.strictEqual(tickRun.decidedSurface, "automation.run");
    assert.strictEqual(tickRun.key, null);
    const tickCounts = yield* Schema.decodeUnknownEffect(TransactionPlanRunCounts)(tickRun.counts);
    assert.strictEqual(tickCounts.moves, 1);
    assert.strictEqual(
      Option.getOrThrow(Option.fromNullishOr(tickRun.finishedAt)).toISOString(),
      DateTime.formatIso(later),
    );
  }).pipe(Effect.provide(mutableFactsLayer(facts, writes.layer)));
});

it.effect("records an agent's discard over MCP", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(team, league([rostered("a1", "Roster One", "BN", ["RB"])], []).facts);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a1", "Roster One")],
    });
    yield* service.discard(owner, {
      team,
      move: requireMoveId(proposed.plan.moves[0]),
      decision: { decidedBy: "agent", surface: "discard_transaction_move" },
    });

    const read = yield* service.plan(owner, { team });
    assert.strictEqual(read.moves[0]?.decision, "discarded");
    assert.strictEqual(read.moves[0]?.decidedBy, "agent");
    assert.strictEqual(read.moves[0]?.surface, "discard_transaction_move");
  }).pipe(Effect.provide(mutableFactsLayer(facts)));
});

it.effect("names the bidless shape and accepts a claim with no bid", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(team, league([], [waived("w1", "Waiver One", ["RB"])]).facts);

    const refused = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [{ kind: "waiver_claim", adds: ["w1"], bid: 0, reason: "Claim a running back." }],
    });
    assert.deepStrictEqual(
      refused.refused.map((entry) => [entry.code, entry.detail]),
      [["bid_not_available", "This league takes no FAAB bid: name the claim without a bid."]],
    );

    const accepted = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [{ kind: "waiver_claim", adds: ["w1"], reason: "Claim a running back." }],
    });
    assert.deepStrictEqual(accepted.refused, []);
    const read = yield* service.plan(owner, { team });
    assert.deepStrictEqual(read.waiverBid, { kind: "bidless" });
    assert.deepStrictEqual(read.moves[0]?.validation.reasons, []);
    assert.strictEqual(read.moves[0]?.validation.status, "current");
  }).pipe(Effect.provide(mutableFactsLayer(facts)));
});

it.effect("names the published bid shape and accepts a zero bid", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(team, league([], [waived("w1", "Waiver One", ["RB"])], { budget: 100 }).facts);

    const accepted = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [{ kind: "waiver_claim", adds: ["w1"], bid: 0, reason: "Claim a running back." }],
    });
    assert.deepStrictEqual(accepted.refused, []);
    const read = yield* service.plan(owner, { team });
    assert.deepStrictEqual(read.waiverBid, { kind: "published", balance: 100 });
    assert.deepStrictEqual(read.moves[0]?.validation.reasons, []);

    yield* service.discard(owner, { team, move: requireMoveId(accepted.plan.moves[0]) });
    const omitted = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [{ kind: "waiver_claim", adds: ["w1"], reason: "Claim a second back." }],
    });
    assert.strictEqual(omitted.refused[0]?.code, "bid_required");
    assert.include(omitted.refused[0]?.detail ?? "", "takes a FAAB bid and publishes the balance");
  }).pipe(Effect.provide(mutableFactsLayer(facts)));
});

it.effect("returns the recorded run when one submit key is used twice", () => {
  const writes = writeLayer(() => ({ status: "executed" }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One")],
    });
    const first = yield* service.confirm(owner, {
      team,
      moves: [requireMoveId(proposed.plan.moves[0])],
      key: "same-submit-key",
    });
    assert.strictEqual(first.counts.executed, 1);
    assert.strictEqual(writes.requests.length, 1);

    const second = yield* service.submit(owner, { team, key: "same-submit-key" });
    const third = yield* service.submit(owner, { team, key: "same-submit-key" });

    assert.deepStrictEqual(second.counts, first.counts);
    assert.deepStrictEqual(third.counts, first.counts);
    assert.strictEqual(writes.requests.length, 1);
    const runs = yield* database.select().from(transactionRuns);
    assert.strictEqual(runs.length, 1);
    const recordedRun = runs[0];
    if (recordedRun === undefined) {
      throw new Error("The submit did not record a run");
    }
    assert.strictEqual(recordedRun.key, "same-submit-key");
    const recordedCounts = yield* Schema.decodeUnknownEffect(TransactionPlanRunCounts)(
      recordedRun.counts,
    );
    assert.strictEqual(recordedCounts.executed, 1);
  }).pipe(
    Effect.provide(
      serviceLayer([league([], [freeAgent("fa1", "Free Agent One", ["RB"])])], writes.layer),
    ),
  );
});

it.effect("confirms a whole group from one member", () => {
  const writes = writeLayer(() => ({ status: "executed" }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [
        { ...add("fa1", "Free Agent One"), group: "pair" },
        { ...add("fa2", "Free Agent Two"), group: "pair" },
      ],
    });
    const first = proposed.plan.moves[0];
    if (first === undefined) {
      throw new Error("The plan carried no group member to confirm");
    }
    const result = yield* service.confirm(owner, {
      team,
      moves: [first.move],
      key: "confirm-group",
    });

    assert.strictEqual(result.counts.moves, 2);
    assert.strictEqual(result.counts.executed, 2);
    assert.strictEqual(writes.requests.length, 2);
    const decisions = result.plan.moves.map((move) => move.decision);
    assert.deepStrictEqual(decisions.sort(), ["now", "now"]);
  }).pipe(
    Effect.provide(
      serviceLayer(
        [
          league(
            [],
            [
              freeAgent("fa1", "Free Agent One", ["RB"]),
              freeAgent("fa2", "Free Agent Two", ["RB"]),
            ],
          ),
        ],
        writes.layer,
      ),
    ),
  );
});

it.effect("submits a two move group in the evaluated order", () => {
  const writes = writeLayer(() => ({ status: "executed" }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [
        { ...add("fa1", "Free Agent One"), group: "pair" },
        { ...add("fa2", "Free Agent Two"), group: "pair" },
      ],
    });

    const result = yield* confirmDue(service, team);

    assert.strictEqual(result.counts.moves, 2);
    assert.strictEqual(result.counts.executed, 2);
    assert.deepStrictEqual(
      writes.requests.map((request) => request.adds[0]),
      ["fa1", "fa2"],
    );
    const steps = yield* database.select().from(transactionMoveSteps);
    assert.deepStrictEqual(
      steps
        .map((step) => [step.playerKey, step.outcome])
        .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
      [
        ["fa1", "executed"],
        ["fa2", "executed"],
      ],
    );
  }).pipe(
    Effect.provide(
      serviceLayer(
        [
          league(
            [],
            [
              freeAgent("fa1", "Free Agent One", ["RB"]),
              freeAgent("fa2", "Free Agent Two", ["RB"]),
            ],
          ),
        ],
        writes.layer,
      ),
    ),
  );
});

it.effect("refuses a group whole when one of its moves fails, and runs an independent move", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  const writes = writeLayer(() => ({ status: "executed" }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(
      team,
      league(
        [rostered("a1", "Roster One", "BN", ["RB"])],
        [freeAgent("fa1", "Free Agent One", ["RB"]), freeAgent("fa2", "Free Agent Two", ["RB"])],
      ).facts,
    );

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [
        { ...add("fa1", "Free Agent One"), group: "pair" },
        { ...add("fa2", "Free Agent Two"), group: "pair" },
        drop("a1", "Roster One"),
      ],
    });

    facts.set(
      team,
      league(
        [rostered("a1", "Roster One", "BN", ["RB"])],
        [freeAgent("fa1", "Free Agent One", ["RB"])],
      ).facts,
    );

    const result = yield* confirmDue(service, team);

    assert.strictEqual(result.counts.failed, 1);
    assert.strictEqual(result.counts.skipped, 1);
    assert.strictEqual(result.counts.executed, 1);
    assert.deepStrictEqual(
      writes.requests.map((request) => request.kind),
      ["drop"],
    );

    const stored = yield* repository.readPlanMoves({ userId: owner, team });
    const unavailable = stored.find((move) => move.adds[0]?.key === "fa2");
    const peer = stored.find((move) => move.adds[0]?.key === "fa1");
    assert.strictEqual(unavailable?.result, "failed");
    assert.include(unavailable?.resultDetail ?? "", "not in the league's available player pool");
    assert.strictEqual(peer?.result, "skipped");
    assert.include(peer?.resultDetail ?? "", "The group did not run");
    assert.strictEqual(stored.find((move) => move.drops[0]?.key === "a1")?.result, "executed");
  }).pipe(Effect.provide(mutableFactsLayer(facts, writes.layer)));
});

it.effect("settles a refusal that cannot change with its reason", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  const writes = writeLayer(() => ({ status: "executed" }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(team, league([], [freeAgent("fa1", "Free Agent One", ["RB"])]).facts);

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One")],
    });

    facts.set(team, league([], []).facts);
    const result = yield* confirmDue(service, team);

    assert.strictEqual(result.counts.failed, 1);
    assert.strictEqual(writes.requests.length, 0);
    const stored = yield* repository.readPlanMoves({ userId: owner, team });
    assert.strictEqual(stored[0]?.result, "failed");
    assert.include(stored[0]?.resultDetail ?? "", "not in the league's available player pool");

    const next = yield* service.runDue(10, at);
    assert.strictEqual(next.counts.moves, 0);
    assert.strictEqual(writes.requests.length, 0);
  }).pipe(Effect.provide(mutableFactsLayer(facts, writes.layer)));
});

it.effect("leaves a transient provider failure for the next hourly tick", () => {
  const writes = writeLayer((_request, attempt) =>
    attempt === 1
      ? { status: "retry", detail: "The league could not be reached." }
      : { status: "executed" },
  );
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One")],
    });

    const first = yield* service.confirm(owner, {
      team,
      moves: [requireMoveId(proposed.plan.moves[0])],
      key: "confirm-retry",
    });
    assert.strictEqual(first.counts.retry, 1);
    assert.strictEqual(first.counts.executed, 0);
    assert.strictEqual(writes.requests.length, 1);
    const pending = yield* repository.readPlanMoves({ userId: owner, team });
    assert.strictEqual(pending[0]?.result, undefined);

    const second = yield* service.runDue(10, at);
    assert.strictEqual(second.counts.executed, 1);
    assert.strictEqual(writes.requests.length, 2);
    const stored = yield* repository.readPlanMoves({ userId: owner, team });
    assert.strictEqual(stored[0]?.result, "executed");
  }).pipe(
    Effect.provide(
      serviceLayer([league([], [freeAgent("fa1", "Free Agent One", ["RB"])])], writes.layer),
    ),
  );
});

it.effect("never runs an undecided move on the tick", () => {
  const writes = writeLayer(() => ({ status: "executed" }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One")],
    });
    assert.strictEqual(proposed.plan.moves[0]?.decision, "undecided");

    const run = yield* service.runDue(10, at);

    assert.strictEqual(run.counts.moves, 0);
    assert.strictEqual(writes.requests.length, 0);
    const stored = yield* repository.readPlanMoves({ userId: owner, team });
    assert.strictEqual(stored[0]?.result, undefined);
    assert.strictEqual(stored[0]?.decision, "undecided");
  }).pipe(
    Effect.provide(
      serviceLayer([league([], [freeAgent("fa1", "Free Agent One", ["RB"])])], writes.layer),
    ),
  );
});

it.effect("waits undecided on its day and runs only after the owner confirms", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  const writes = writeLayer(() => ({ status: "executed" }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(team, league([rostered("a1", "Roster One", "BN", ["RB"])], []).facts);

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [{ ...drop("a1", "Roster One"), runDay: "2026-11-15" }],
    });

    const skipped = yield* service.runDue(10, at);
    assert.strictEqual(skipped.counts.moves, 0);
    assert.strictEqual(writes.requests.length, 0);

    facts.set(team, {
      ...league([rostered("a1", "Roster One", "BN", ["RB"])], []).facts,
      today: "2026-11-16",
    });
    const arrived = yield* service.runDue(10, at);
    assert.strictEqual(arrived.counts.moves, 0);
    assert.strictEqual(writes.requests.length, 0);
    const waiting = yield* service.plan(owner, { team });
    assert.strictEqual(waiting.moves[0]?.decision, "undecided");
    assert.strictEqual(waiting.moves[0]?.runDay, "2026-11-16");

    const result = yield* service.confirm(owner, {
      team,
      moves: [requireMoveId(waiting.moves[0])],
      key: "confirm-waiting",
    });
    assert.strictEqual(result.counts.executed, 1);
    assert.strictEqual(writes.requests.length, 1);
    const stored = yield* repository.readPlanMoves({ userId: owner, team });
    assert.strictEqual(stored[0]?.result, "executed");
    assert.strictEqual(stored[0]?.runDay, "2026-11-16");
    assert.strictEqual(stored[0]?.effectiveDate, "2026-11-17");
    assert.strictEqual(
      DateTime.formatIso(Option.getOrThrow(Option.fromNullishOr(stored[0]?.confirmedAt))),
      DateTime.formatIso(at),
    );
    assert.strictEqual(
      DateTime.formatIso(Option.getOrThrow(Option.fromNullishOr(stored[0]?.runAt))),
      DateTime.formatIso(at),
    );
  }).pipe(Effect.provide(mutableFactsLayer(facts, writes.layer)));
});

it.effect("skips a plan that another run holds", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  const writes = writeLayer(() => ({ status: "executed" }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(team, league([], [freeAgent("fa1", "Free Agent One", ["RB"])]).facts);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One", { runDay: "2026-11-15" })],
    });
    yield* service.confirm(owner, {
      team,
      moves: [requireMoveId(proposed.plan.moves[0])],
      key: "confirm-held",
    });
    yield* repository.claimRun({ userId: owner, team, runClaim: "held-run", at });
    const current = facts.get(team);
    if (current === undefined) {
      throw new Error("The league facts were not seeded");
    }
    facts.set(team, { ...current, today: "2026-11-15" });

    const due = yield* service.runDue(10, at);
    assert.strictEqual(due.counts.busy, 1);
    assert.strictEqual(due.counts.executed, 0);
    assert.strictEqual(writes.requests.length, 0);

    const plans = yield* database.select().from(transactionPlans);
    assert.strictEqual(plans[0]?.runClaim, "held-run");
  }).pipe(Effect.provide(mutableFactsLayer(facts, writes.layer)));
});

it.effect("recovers a stale claim before running the due moves", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  const writes = writeLayer(() => ({ status: "executed" }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(team, league([], [freeAgent("fa1", "Free Agent One", ["RB"])]).facts);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One", { runDay: "2026-11-15" })],
    });
    yield* service.confirm(owner, {
      team,
      moves: [requireMoveId(proposed.plan.moves[0])],
      key: "confirm-stale",
    });
    const current = facts.get(team);
    if (current === undefined) {
      throw new Error("The league facts were not seeded");
    }
    facts.set(team, { ...current, today: "2026-11-15" });
    yield* repository.claimRun({
      userId: owner,
      team,
      runClaim: "crashed-run",
      at: DateTime.subtractDuration(at, 11 * 60 * 1000),
    });

    const run = yield* service.runDue(10, at);

    assert.strictEqual(run.counts.recovered, 1);
    assert.strictEqual(run.counts.claimed, 1);
    assert.strictEqual(run.counts.executed, 1);
    assert.strictEqual(writes.requests.length, 1);
    const plans = yield* database.select().from(transactionPlans);
    assert.strictEqual(plans[0]?.runClaim, null);
  }).pipe(Effect.provide(mutableFactsLayer(facts, writes.layer)));
});

it.effect("blocks a dependent when its move fails and runs an independent move", () => {
  const writes = writeLayer((request) =>
    request.drops[0] === "a1"
      ? { status: "failed", detail: "Your league rejected the transaction." }
      : { status: "executed" },
  );
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a1", "Roster One"), add("fa1", "Free Agent One"), drop("a2", "Roster Two")],
    });

    const result = yield* confirmDue(service, team);

    assert.strictEqual(result.counts.failed, 1);
    assert.strictEqual(result.counts.skipped, 1);
    assert.strictEqual(result.counts.executed, 1);
    assert.deepStrictEqual(
      writes.requests.map((request) => [request.kind, request.drops[0] ?? request.adds[0]]),
      [
        ["drop", "a1"],
        ["drop", "a2"],
      ],
    );

    const stored = yield* repository.readPlanMoves({ userId: owner, team });
    assert.strictEqual(stored.find((move) => move.drops[0]?.key === "a1")?.result, "failed");
    assert.strictEqual(stored.find((move) => move.adds[0]?.key === "fa1")?.result, "skipped");
    assert.include(
      stored.find((move) => move.adds[0]?.key === "fa1")?.resultDetail ?? "",
      "Drop Roster One did not pass its check",
    );
    assert.strictEqual(stored.find((move) => move.drops[0]?.key === "a2")?.result, "executed");
  }).pipe(
    Effect.provide(
      serviceLayer(
        [
          league(
            [
              rostered("a1", "Roster One", "BN", ["RB"]),
              rostered("a2", "Roster Two", "BN", ["RB"]),
              rostered("a3", "Roster Three", "BN", ["RB"]),
              rostered("a4", "Roster Four", "BN", ["RB"]),
            ],
            [freeAgent("fa1", "Free Agent One", ["RB"])],
            { slots: [bench("BN", 4)], constraints: constraints(4) },
          ),
        ],
        writes.layer,
      ),
    ),
  );
});

it.effect("records an unknown provider outcome and never retries it", () => {
  const writes = writeLayer(() => ({
    status: "unknown",
    detail: "Your league did not confirm the transaction.",
  }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One")],
    });

    const first = yield* service.confirm(owner, {
      team,
      moves: [requireMoveId(proposed.plan.moves[0])],
      key: "confirm-unknown",
    });
    assert.strictEqual(first.counts.unknown, 1);
    const stored = yield* repository.readPlanMoves({ userId: owner, team });
    assert.strictEqual(stored[0]?.result, "unknown");

    const second = yield* service.runDue(10, at);
    assert.strictEqual(second.counts.moves, 0);
    assert.strictEqual(writes.requests.length, 1);
  }).pipe(
    Effect.provide(
      serviceLayer([league([], [freeAgent("fa1", "Free Agent One", ["RB"])])], writes.layer),
    ),
  );
});

it.effect("records a pending waiver claim and does not retry it", () => {
  const writes = writeLayer(() => ({
    status: "pending",
    detail: "Your league has not processed this waiver claim yet.",
  }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [
        {
          kind: "waiver_claim",
          adds: ["w1"],
          bid: 5,
          reason: "Claim a running back.",
        },
      ],
    });

    const result = yield* confirmDue(service, team);

    assert.strictEqual(result.counts.pending, 1);
    const stored = yield* repository.readPlanMoves({ userId: owner, team });
    assert.strictEqual(stored[0]?.result, "pending");
    assert.include(stored[0]?.resultDetail ?? "", "not processed this waiver claim");

    const next = yield* service.runDue(10, at);
    assert.strictEqual(next.counts.moves, 0);
    assert.strictEqual(writes.requests.length, 1);
  }).pipe(
    Effect.provide(
      serviceLayer(
        [league([], [waived("w1", "Waiver One", ["RB"])], { budget: 100 })],
        writes.layer,
      ),
    ),
  );
});

for (const timing of [
  {
    rule: "same_day" as const,
    currentDate: "2026-11-14",
    periodStart: undefined,
    effectiveDate: "2026-11-15",
  },
  {
    rule: "next_day" as const,
    currentDate: "2026-11-14",
    periodStart: undefined,
    effectiveDate: "2026-11-16",
  },
  {
    rule: "weekly_lock" as const,
    currentDate: "2026-11-15",
    periodStart: "2026-11-09",
    effectiveDate: "2026-11-09",
  },
]) {
  it.effect(`runs a saved move on the league's own day under ${timing.rule}`, () => {
    const facts = new Map<TeamId, TransactionPlanTeamFacts>();
    const writes = writeLayer(() => ({ status: "executed" }));
    const leagueAt = DateTime.makeUnsafe("2026-11-15T03:00:00.000Z");
    return Effect.gen(function* () {
      const service = yield* TransactionPlanService;
      const repository = yield* TransactionPlanRepository;
      const database = yield* ConnectionsDatabase;
      yield* TestClock.setTime(DateTime.toEpochMillis(leagueAt));
      yield* seedTeam(database, owner, team);
      facts.set(
        team,
        league(
          [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["RB"])],
          [],
          {
            slots: [bench("BN", 2)],
            constraints: constraints(2),
            timing: {
              rule: timing.rule,
              currentDate: timing.currentDate,
              periodStart: timing.periodStart,
            },
          },
        ).facts,
      );

      const proposed = yield* service.propose(owner, {
        team,
        proposedBy: proposer,
        moves: [
          { ...drop("a1", "Roster One"), runDay: "2026-11-15" },
          { ...drop("a2", "Roster Two"), runDay: "2026-11-16" },
        ],
      });
      yield* service.confirm(owner, {
        team,
        moves: proposed.plan.moves.map((move) => move.move),
        key: `confirm-timing-${timing.rule}`,
      });

      const early = yield* service.runDue(10, leagueAt);
      assert.strictEqual(early.counts.moves, 0);
      assert.strictEqual(writes.requests.length, 0);

      const factsForDay = facts.get(team);
      if (factsForDay === undefined) {
        throw new Error("The league facts were not seeded");
      }
      facts.set(team, { ...factsForDay, today: "2026-11-15" });
      const arrived = yield* service.runDue(10, leagueAt);

      assert.strictEqual(arrived.counts.executed, 1);
      assert.strictEqual(writes.requests.length, 1);
      const stored = yield* repository.readPlanMoves({ userId: owner, team });
      const run = stored.find((move) => move.drops[0]?.key === "a1");
      assert.strictEqual(run?.result, "executed");
      assert.strictEqual(run?.runDay, "2026-11-15");
      assert.strictEqual(run?.effectiveDate, timing.effectiveDate);
      assert.strictEqual(stored.find((move) => move.drops[0]?.key === "a2")?.result, undefined);
    }).pipe(Effect.provide(mutableFactsLayer(facts, writes.layer)));
  });
}

it.effect("stores the locked week's start as a weekly-lock move's effective date", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a1", "Roster One"), { ...drop("a2", "Roster Two"), runDay: "2026-11-21" }],
    });

    assert.deepStrictEqual(
      proposed.plan.moves.map(({ runDay, effectiveDate }) => [runDay, effectiveDate]),
      [
        ["2026-11-14", "2026-11-09"],
        ["2026-11-21", "2026-11-16"],
      ],
    );
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["RB"])],
          [],
          {
            slots: [bench("BN", 2)],
            constraints: constraints(2),
            timing: {
              rule: "weekly_lock",
              currentDate: today,
              periodStart: "2026-11-09",
            },
          },
        ),
      ]),
    ),
  ),
);

it.effect("runs a drop, a stash, and an add group in the order its effects need", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  const writes = writeLayer((request) => {
    appliedWrite(facts, request);
    return { status: "executed" };
  });
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    const seeded = league(
      [
        rostered("a1", "Roster One", "BN", ["RB"]),
        { ...rostered("a2", "Roster Two", "BN", ["RB"]), injured: true },
      ],
      [freeAgent("fa1", "Free Agent One", ["WR"])],
      { slots: [bench("BN", 2), reserve("IR", ["RB"])], constraints: constraints(2) },
    );
    facts.set(team, seeded.facts);

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [
        { ...add("fa1", "Free Agent One"), group: "three" },
        { ...stash("a2", "Roster Two"), group: "three" },
        { ...drop("a1", "Roster One"), group: "three" },
      ],
    });

    const result = yield* confirmDue(service, team);

    assert.strictEqual(result.counts.executed, 3);
    assert.deepStrictEqual(
      writes.requests.map((request) => [request.kind, request.drops[0] ?? request.adds[0]]),
      [
        ["stash", undefined],
        ["drop", "a1"],
        ["free_agent_add", "fa1"],
      ],
    );

    const read = yield* service.plan(owner, { team });
    assert.deepStrictEqual(
      read.groups.map((group) => [group.status, group.actions.length]),
      [["done", 3]],
    );
    assert.include(read.groups[0]?.detail ?? "", "This group ran whole.");
  }).pipe(Effect.provide(mutableFactsLayer(facts, writes.layer)));
});

it.effect("stops a whole group when one member is stale and sends nothing", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  const writes = writeLayer(() => ({ status: "executed" }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(
      team,
      league(
        [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["RB"])],
        [freeAgent("fa1", "Free Agent One", ["RB"])],
        { slots: [bench("BN", 2)], constraints: constraints(2) },
      ).facts,
    );

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [
        { ...drop("a1", "Roster One"), group: "pair" },
        { ...drop("a2", "Roster Two"), group: "pair" },
      ],
    });

    facts.set(
      team,
      league(
        [rostered("a2", "Roster Two", "BN", ["RB"])],
        [freeAgent("fa1", "Free Agent One", ["RB"])],
        { slots: [bench("BN", 2)], constraints: constraints(2) },
      ).facts,
    );

    const result = yield* confirmDue(service, team);

    assert.strictEqual(writes.requests.length, 0);
    assert.strictEqual(result.counts.failed, 1);
    assert.strictEqual(result.counts.skipped, 1);
    const read = yield* service.plan(owner, { team });
    assert.deepStrictEqual(
      read.moves.map((move) => [move.kind, move.result]),
      [
        ["drop", "failed"],
        ["drop", "skipped"],
      ],
    );
    assert.strictEqual(read.groups[0]?.status, "blocked");
    assert.deepStrictEqual(read.groups[0]?.actions, []);
    assert.match(
      read.groups[0]?.detail ?? "",
      /^This group does not run\. The drop of Roster One cannot run: /u,
    );
  }).pipe(Effect.provide(mutableFactsLayer(facts, writes.layer)));
});

it.effect("leaves a group unwhole when one of its members is discarded", () => {
  const facts = new Map<TeamId, TransactionPlanTeamFacts>();
  const writes = writeLayer(() => ({ status: "executed" }));
  return Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);
    facts.set(
      team,
      league(
        [rostered("a1", "Roster One", "BN", ["RB"]), rostered("a2", "Roster Two", "BN", ["RB"])],
        [],
        { slots: [bench("BN", 2)], constraints: constraints(2) },
      ).facts,
    );

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [
        { ...drop("a1", "Roster One"), group: "pair" },
        { ...drop("a2", "Roster Two"), group: "pair" },
      ],
    });
    const discarded = proposed.plan.moves[0]?.move;
    if (discarded === undefined) {
      throw new Error("The proposed group had no first move");
    }

    yield* service.discard(owner, { team, move: discarded });

    const read = yield* service.plan(owner, { team });
    assert.strictEqual(writes.requests.length, 0);
    assert.strictEqual(read.groups.length, 1);
    assert.strictEqual(read.groups[0]?.status, "blocked");
    assert.strictEqual(
      read.groups[0]?.detail,
      "This group is not whole. The drop of Roster One was discarded, so the rest cannot run until you discard the group or form it again.",
    );
  }).pipe(Effect.provide(mutableFactsLayer(facts, writes.layer)));
});

it.effect(
  "records the drop that landed, the stash the league refused, and the add that did not run",
  () => {
    const facts = new Map<TeamId, TransactionPlanTeamFacts>();
    let reads = 0;
    const writes = writeLayer((request) => {
      if (request.kind === "stash") {
        return { status: "failed", detail: "The player was already there." };
      }
      appliedWrite(facts, request);
      return { status: "executed" };
    });
    const layer = layerWith((input) => {
      reads += 1;
      const found = facts.get(input.team);
      return found === undefined
        ? Effect.fail(
            TransactionPlanFactsUnavailable.make({
              team: input.team,
              detail: "The league could not be read.",
            }),
          )
        : Effect.succeed(found);
    }, writes.layer);
    return Effect.gen(function* () {
      const service = yield* TransactionPlanService;
      const database = yield* ConnectionsDatabase;
      yield* TestClock.setTime(DateTime.toEpochMillis(at));
      yield* seedTeam(database, owner, team);
      facts.set(
        team,
        league(
          [
            rostered("a1", "Roster One", "BN", ["RB"]),
            { ...rostered("a2", "Roster Two", "BN", ["RB"]), injured: true },
          ],
          [freeAgent("fa1", "Free Agent One", ["WR"])],
          { slots: [bench("BN", 2), reserve("IR", ["RB"])], constraints: constraints(2) },
        ).facts,
      );

      yield* service.propose(owner, {
        team,
        proposedBy: proposer,
        moves: [
          { ...drop("a1", "Roster One"), group: "three" },
          { ...stash("a2", "Roster Two"), group: "three" },
          { ...add("fa1", "Free Agent One"), group: "three" },
        ],
      });
      const before = reads;

      const result = yield* confirmDue(service, team);

      assert.strictEqual(writes.requests.length, 2);
      assert.isAbove(reads, before + 1);
      assert.strictEqual(result.counts.executed, 1);
      assert.strictEqual(result.counts.failed, 1);
      assert.strictEqual(result.counts.skipped, 1);

      const read = yield* service.plan(owner, { team });
      const group = read.groups[0];
      assert.strictEqual(group?.status, "partly_done");
      assert.deepStrictEqual(
        group?.actions.map((action) => [action.action, action.player, action.outcome]),
        [
          ["drop", "Roster One", "executed"],
          ["reserve_move", "Roster Two", "failed"],
        ],
      );
      assert.strictEqual(group?.failed?.detail, "The player was already there.");
      assert.deepStrictEqual(
        group?.notRun.map((move) => read.moves.find((entry) => entry.move === move)?.kind),
        ["free_agent_add"],
      );
      assert.strictEqual(
        group?.cure,
        "Check your roster, then choose the move again or discard it.",
      );
      assert.strictEqual(
        group?.detail,
        "This group ran in part. The drop of Roster One reached your league. The move of Roster Two to IR failed: The player was already there. The add did not run. Check your roster, then choose the move again or discard it.",
      );
    }).pipe(Effect.provide(layer));
  },
);

it.effect("adds a visible Roster fixes group before the add it funds", () => {
  const writes = writeLayer(() => ({ status: "executed" }));
  return Effect.gen(function* () {
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
    assert.deepStrictEqual(
      result.plan.moves.map((move) => [move.kind, move.runPosition]),
      [
        ["stash", 0],
        ["free_agent_add", 1],
      ],
    );

    const read = yield* service.plan(owner, { team });
    const group = read.groups[0];
    assert.strictEqual(group?.label, "Roster fixes");
    assert.strictEqual(group?.status, "ready");
    assert.strictEqual(group?.moves.length, 1);
    assert.strictEqual(read.moves.find((move) => move.move === group?.moves[0])?.kind, "stash");
    assert.include(read.moves[0]?.reason ?? "", "to free a place");

    yield* confirmDue(service, team);
    assert.deepStrictEqual(
      writes.requests.map((request) => request.kind),
      ["stash", "free_agent_add"],
    );
  }).pipe(
    Effect.provide(
      serviceLayer(
        [
          league(
            [{ ...rostered("a1", "Roster One", "BN", ["RB"]), injured: true }],
            [freeAgent("fa1", "Free Agent One", ["WR"])],
            { slots: [bench("BN", 1), reserve("IR", ["RB"])], constraints: constraints(1) },
          ),
        ],
        writes.layer,
      ),
    ),
  );
});

it.effect("adds no Roster fixes group when the add already fits", () =>
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
    const read = yield* service.plan(owner, { team });
    assert.deepStrictEqual(read.groups, []);
    assert.deepStrictEqual(
      read.moves.map((move) => move.kind),
      ["free_agent_add"],
    );
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [{ ...rostered("a1", "Roster One", "BN", ["RB"]), injured: true }],
          [freeAgent("fa1", "Free Agent One", ["WR"])],
          { slots: [bench("BN", 2), reserve("IR", ["RB"])], constraints: constraints(2) },
        ),
      ]),
    ),
  ),
);

it.effect("activates a healthy player off a reserve list so an add can run", () =>
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
    const read = yield* service.plan(owner, { team });
    assert.deepStrictEqual(
      read.moves.map((move) => [move.kind, move.validation.status]),
      [
        ["activate", "current"],
        ["free_agent_add", "current"],
      ],
    );
    assert.strictEqual(read.groups[0]?.label, "Roster fixes");
    assert.deepStrictEqual(
      read.groups[0]?.moves.map((move) => read.moves.find((entry) => entry.move === move)?.kind),
      ["activate"],
    );
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [
            rostered("a1", "Roster One", "BN", ["RB"]),
            rostered("a2", "Roster Two", "IR", ["RB"]),
            { ...rostered("a3", "Roster Three", "IR+", ["RB"]), injured: true },
          ],
          [freeAgent("fa1", "Free Agent One", ["WR"])],
          {
            slots: [bench("BN", 2), reserve("IR", ["RB"]), reserve("IR+", ["RB"])],
            constraints: constraints(3, { reserveEligibility: { kind: "injury_status" } }),
          },
        ),
      ]),
    ),
  ),
);

it.effect("names the cure when no roster fix can make an add fit", () =>
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

    assert.strictEqual(result.refused.length, 1);
    assert.include(
      result.refused[0]?.detail ?? "",
      "no injured player on the roster can move to a reserve list to free one",
    );
    assert.deepStrictEqual(result.plan.moves, []);
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [rostered("a1", "Roster One", "BN", ["WR"])],
          [freeAgent("fa1", "Free Agent One", ["WR"])],
          { slots: [bench("BN", 1)], constraints: constraints(1) },
        ),
      ]),
    ),
  ),
);

it.effect("regenerates a move's Roster fixes when it is edited", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One")],
    });
    const funded = proposed.plan.moves.find((move) => move.kind === "free_agent_add");
    assert.isDefined(funded);

    const edited = yield* service.edit(owner, {
      team,
      move: requireMoveId(funded),
      change: add("fa1", "Free Agent One", { reason: "Add a receiver for Sunday." }),
    });
    assert.deepStrictEqual(edited.refused, []);

    const stored = yield* database.select().from(transactionMoves);
    const fixes = stored.filter((move) => move.groupId?.startsWith("roster-fixes:") === true);
    assert.strictEqual(fixes.filter((move) => move.decision !== "discarded").length, 1);
    assert.strictEqual(fixes.filter((move) => move.decision === "discarded").length, 1);

    const read = yield* service.plan(owner, { team });
    assert.deepStrictEqual(
      read.moves.filter((move) => move.decision !== "discarded").map((move) => move.kind),
      ["free_agent_add", "stash"],
    );
    assert.deepStrictEqual(
      read.groups[0]?.moves.map((move) => read.moves.find((entry) => entry.move === move)?.kind),
      ["stash"],
    );
    assert.strictEqual(read.groups[0]?.status, "ready");
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [{ ...rostered("a1", "Roster One", "BN", ["RB"]), injured: true }],
          [freeAgent("fa1", "Free Agent One", ["WR"])],
          { slots: [bench("BN", 1), reserve("IR", ["RB"])], constraints: constraints(1) },
        ),
      ]),
    ),
  ),
);

it.effect("discards a move's Roster fixes with it", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    const proposed = yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One")],
    });
    const funded = proposed.plan.moves.find((move) => move.kind === "free_agent_add");
    assert.isDefined(funded);

    const discarded = yield* service.discard(owner, {
      team,
      move: requireMoveId(funded),
    });
    assert.deepStrictEqual(discarded.refused, []);

    const read = yield* service.plan(owner, { team });
    assert.deepStrictEqual(
      read.moves.map((move) => [move.kind, move.decision]),
      [
        ["stash", "discarded"],
        ["free_agent_add", "discarded"],
      ],
    );
    assert.deepStrictEqual(read.groups, []);
  }).pipe(
    Effect.provide(
      serviceLayer([
        league(
          [{ ...rostered("a1", "Roster One", "BN", ["RB"]), injured: true }],
          [freeAgent("fa1", "Free Agent One", ["WR"])],
          { slots: [bench("BN", 1), reserve("IR", ["RB"])], constraints: constraints(1) },
        ),
      ]),
    ),
  ),
);

function confirmDue(
  service: Pick<TransactionPlanServiceShape, "plan" | "confirm">,
  teamId: TeamId,
): ReturnType<TransactionPlanServiceShape["confirm"]> {
  return Effect.gen(function* () {
    const plan = yield* service.plan(owner, { team: teamId });
    const moves = plan.moves.flatMap((move) =>
      move.result === undefined &&
      move.runDay === plan.today &&
      (move.decision === "undecided" || move.decision === "now" || move.decision === "confirmed")
        ? [move.move]
        : [],
    );
    return yield* service.confirm(owner, {
      team: teamId,
      moves,
      key: `confirm-${String(++confirmSequence)}`,
    });
  });
}

let confirmSequence = 0;

function serviceLayer(
  leagues: ReadonlyArray<League>,
  writes: Layer.Layer<TransactionPlanWrites> = executedWrites(),
): Layer.Layer<
  TransactionPlanService | TransactionPlanRepository | ConnectionsDatabase | QueryTokens
> {
  const byTeam = new Map(leagues.map((entry) => [entry.team, entry.facts] as const));
  return layerWith((input) => {
    const facts = byTeam.get(input.team);
    return facts === undefined
      ? Effect.fail(
          TransactionPlanFactsUnavailable.make({
            team: input.team,
            detail: `No league facts for ${input.team}.`,
          }),
        )
      : Effect.succeed(facts);
  }, writes);
}

function mutableFactsLayer(
  facts: Map<TeamId, TransactionPlanTeamFacts>,
  writes: Layer.Layer<TransactionPlanWrites> = executedWrites(),
): Layer.Layer<
  TransactionPlanService | TransactionPlanRepository | ConnectionsDatabase | QueryTokens
> {
  return layerWith((input) => {
    const found = facts.get(input.team);
    return found === undefined
      ? Effect.fail(
          TransactionPlanFactsUnavailable.make({
            team: input.team,
            detail: "The league could not be read.",
          }),
        )
      : Effect.succeed(found);
  }, writes);
}

function executedWrites(): Layer.Layer<TransactionPlanWrites> {
  return writeLayer(() => ({ status: "executed" })).layer;
}

function appliedWrite(
  facts: Map<TeamId, TransactionPlanTeamFacts>,
  request: TransactionPlanWriteRequest,
): void {
  const current = facts.get(team);
  if (current === undefined) {
    return;
  }
  const roster = current.roster.filter((player) => !request.drops.includes(player.key));
  const moving = request.intent?.player?.key ?? request.slotMove?.playerKey;
  const destination = request.slotMove?.toSlot ?? request.placement?.toSlot;
  const moved = roster.map((player) =>
    player.key === moving && destination !== undefined ? { ...player, slot: destination } : player,
  );
  const added = request.adds.map((key) => ({
    key,
    name: key,
    positions: [],
    slot: request.placement?.toSlot,
    injured: false,
    editable: true,
  }));
  facts.set(team, { ...current, roster: [...moved, ...added] });
}

function writeLayer(
  outcome: (request: TransactionPlanWriteRequest, attempt: number) => WriteDecision,
): {
  readonly layer: Layer.Layer<TransactionPlanWrites>;
  readonly requests: Array<TransactionPlanWriteRequest>;
} {
  const requests: Array<TransactionPlanWriteRequest> = [];
  const attempts = new Map<TransactionMoveId, number>();
  const apply: TransactionPlanWritesShape["apply"] = (request) =>
    Effect.sync(() => {
      requests.push(request);
      const attempt = (attempts.get(request.move) ?? 0) + 1;
      attempts.set(request.move, attempt);
      const decided = outcome(request, attempt);
      return decided.status === "retry"
        ? decided
        : {
            ...decided,
            actions: plannedActions(request, decided.status).map((action) => ({
              ...action,
              ...(decided.status === "executed" ? {} : { detail: decided.detail }),
            })),
          };
    });
  return { layer: Layer.succeed(TransactionPlanWrites)({ apply }), requests };
}

function plannedActions(
  request: TransactionPlanWriteRequest,
  outcome: TransactionPlanAction["outcome"],
): ReadonlyArray<TransactionPlanAction> {
  return planActions(request).map((action) => ({ ...action, outcome }));
}

function planActions(request: TransactionPlanWriteRequest): ReadonlyArray<TransactionPlanAction> {
  if (request.kind === "trade") {
    return [];
  }
  if (request.kind === "activate" || request.kind === "stash" || request.kind === "slot_move") {
    const playerKey = request.slotMove?.playerKey ?? request.placement?.playerKey;
    const toSlot = request.slotMove?.toSlot ?? request.placement?.toSlot;
    return playerKey === undefined
      ? []
      : [
          {
            kind: "reserve_move",
            playerKey,
            ...(toSlot === undefined ? {} : { toSlot }),
            outcome: "skipped",
          },
        ];
  }
  const actions: Array<TransactionPlanAction> = [
    ...request.adds.map((playerKey): TransactionPlanAction => ({
      kind: "add",
      playerKey,
      outcome: "skipped",
    })),
    ...request.drops.map((playerKey): TransactionPlanAction => ({
      kind: "drop",
      playerKey,
      outcome: "skipped",
    })),
  ];
  if (request.intent?.to === "reserve" && request.placement !== undefined) {
    actions.push({
      kind: "reserve_move",
      playerKey: request.placement.playerKey,
      toSlot: request.placement.toSlot,
      outcome: "skipped",
    });
  }
  return actions;
}

function layerWith(
  read: TransactionPlanFactsShape["read"],
  writes: Layer.Layer<TransactionPlanWrites> = executedWrites(),
): Layer.Layer<
  TransactionPlanService | TransactionPlanRepository | ConnectionsDatabase | QueryTokens
> {
  const Facts = Layer.succeed(TransactionPlanFacts)({ read });
  return TransactionPlanServiceLive.pipe(
    Layer.provideMerge(TransactionPlanRepository.layer),
    Layer.provide(Facts),
    Layer.provide(writes),
    Layer.provide(NodeCrypto.layer),
    Layer.provideMerge(QueryTokens.fromSecret("test-query-token-secret-at-least-32-chars")),
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

function requireRef(refs: ReadonlyArray<PlayerRef>, index: number): PlayerRef {
  const ref = refs[index];
  if (ref === undefined) {
    throw new Error("A test read a player reference it did not seal");
  }
  return ref;
}

function droppedMoveId(plan: TransactionPlanView, key: string): TransactionMoveId {
  const move = plan.moves.find((entry) => entry.drops[0]?.key === key);
  if (move === undefined) {
    throw new Error(`The plan did not carry a drop of ${key}`);
  }
  return move.move;
}

let storedMoveSequence = 0;

function nextStoredMoveId(): TransactionMoveId {
  storedMoveSequence += 1;
  return Schema.decodeSync(TransactionMoveIdSchema)(
    `01K${String(storedMoveSequence).padStart(23, "0")}`,
  );
}

function storedDrop(key: string, name: string): TransactionMoveAppend {
  return {
    id: nextStoredMoveId(),
    proposedBy: proposer,
    content: {
      group: undefined,
      kind: "drop",
      adds: [],
      fallbacks: [],
      drops: [{ key, name }],
      picks: [],
      slotMove: undefined,
      intent: undefined,
      placement: undefined,
      counterpartyKey: undefined,
      bid: undefined,
      reason: `Drop ${name}.`,
      runDay: today,
      effectiveDate: "2026-11-15",
      decision: "undecided",
      decidedAt: undefined,
      decidedBy: "agent",
      surface: "propose_transactions",
      confirmedAt: undefined,
      confirmedBy: undefined,
      validation: { status: "current", checkedAt: at, reasons: [] },
    },
    claims: [{ kind: "player", key }],
  };
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
  return leagueFor(team, roster, pool, overrides);
}

function leagueFor(
  teamId: TeamId,
  roster: ReadonlyArray<TransactionPlanRosterPlayer>,
  pool: ReadonlyArray<TransactionPlanPoolPlayer>,
  overrides: {
    readonly slots?: ReadonlyArray<TransactionPlanSlot>;
    readonly constraints?: TransactionPlanConstraints;
    readonly timing?: TransactionPlanTiming;
    readonly budget?: number;
    readonly waiverBid?: TransactionPlanTeamFacts["waiverBid"];
  } = {},
): League {
  return {
    team: teamId,
    facts: {
      roster,
      pool: new Map(pool.map((player) => [player.key, player] as const)),
      slots: overrides.slots ?? [bench("BN", 4)],
      constraints: overrides.constraints ?? constraints(4),
      today,
      timing: overrides.timing ?? {
        rule: "next_day",
        currentDate: today,
        periodStart: undefined,
      },
      budget: overrides.budget,
      waiverBid:
        overrides.waiverBid ??
        (overrides.budget === undefined
          ? { kind: "bidless" }
          : { kind: "published", balance: overrides.budget }),
      rosterSource: "week 1",
    },
  };
}

function constraints(
  rosterMaximum: number,
  overrides: Partial<TransactionPlanConstraints> = {},
): TransactionPlanConstraints {
  return {
    rosterMaximum,
    benchCapacity: "generic",
    startingSlotsMayStandEmpty: true,
    reserveEligibility: { kind: "published_positions" },
    ...overrides,
  };
}

function starting(position: string, eligibility: ReadonlyArray<string> = []): TransactionPlanSlot {
  return { position, kind: "starting", count: 1, eligibility };
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

function locked(
  key: string,
  name: string,
  slot: string,
  positions: ReadonlyArray<string> = [],
): TransactionPlanRosterPlayer {
  return { key, name, positions, slot, injured: false, editable: false };
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

function stash(playerKey: string, playerName: string): TransactionPlanMoveDraft {
  return {
    kind: "stash",
    player: playerKey,
    reason: `Stash ${playerName}.`,
  };
}

function slotMove(playerKey: string, playerName: string, toSlot: string): TransactionPlanMoveDraft {
  return {
    kind: "slot_move",
    slotMove: { player: playerKey, toSlot },
    reason: `Move ${playerName} to ${toSlot}.`,
  };
}

type WriteDecision =
  | { readonly status: "executed" }
  | { readonly status: "pending"; readonly detail: string }
  | { readonly status: "failed"; readonly detail: string }
  | { readonly status: "unknown"; readonly detail: string }
  | { readonly status: "retry"; readonly detail: string };

type League = {
  readonly team: TeamId;
  readonly facts: TransactionPlanTeamFacts;
};
