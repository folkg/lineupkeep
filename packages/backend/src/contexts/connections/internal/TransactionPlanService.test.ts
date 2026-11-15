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
import type { TransactionMoveList } from "./TransactionPlanRead.ts";
import type { TransactionMoveCursor, TransactionMoveId } from "./TransactionPlanRecord.ts";
import { TransactionPlanRepository } from "./TransactionPlanRepository.ts";
import type { TransactionMoveAppend } from "./TransactionPlanRepository.ts";
import {
  TransactionPlanFacts,
  TransactionPlanFactsUnavailable,
  TransactionPlanRunInProgress,
  TransactionPlanService,
  TransactionPlanServiceLive,
  TransactionPlansDisabled,
} from "./TransactionPlanService.ts";
import type {
  TransactionPlanFactsShape,
  TransactionPlanMoveDraft,
  TransactionPlanView,
} from "./TransactionPlanService.ts";
import {
  transactionMoveClaims,
  transactionMoveSteps,
  transactionMoves,
  transactionPlans,
} from "./TransactionPlanTables.ts";
import { TransactionPlanWrites } from "./TransactionPlanWrites.ts";
import type {
  TransactionPlanWriteRequest,
  TransactionPlanWriteResult,
  TransactionPlanWritesShape,
} from "./TransactionPlanWrites.ts";

const owner = decodeUserId("owner");
const team = decodeTeamId("01ARZ3NDEKTSV4RRFFQ69G5FAV");
const secondTeam = decodeTeamId("01ARZ3NDEKTSV4RRFFQ69G5FAW");
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
    const readError = yield* service.timeline(owner, {}).pipe(Effect.flip);
    assert.isTrue(Schema.is(TransactionPlansDisabled)(readError));
    const submitError = yield* service.submit(owner, { team }).pipe(Effect.flip);
    assert.isTrue(Schema.is(TransactionPlansDisabled)(submitError));
    const dueError = yield* service.runDue(10, at).pipe(Effect.flip);
    assert.isTrue(Schema.is(TransactionPlansDisabled)(dueError));
    assert.deepStrictEqual(yield* database.select().from(transactionPlans), []);
    assert.deepStrictEqual(yield* database.select().from(transactionMoves), []);
  }).pipe(
    Effect.provide(serviceLayer([league([], [freeAgent("fa1", "Free Agent One", ["RB"])])], false)),
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
      move?.validation.reasons.map((reason) => [reason.code, reason.playerKey]),
      [["slot_illegal", "h1"]],
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
        ["now", "2026-11-14"],
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
        ["now", "checked"],
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

    assert.deepStrictEqual(all.totals, { open: 3, today: 2, saved: 1, ended: 2 });
    assert.deepStrictEqual(all.teams, [
      { team, open: 2, today: 1, saved: 1, ended: 2 },
      { team: secondTeam, open: 1, today: 1, saved: 0, ended: 0 },
    ]);

    const one = yield* service.counts(owner, { team });

    assert.deepStrictEqual(one, {
      totals: { open: 2, today: 1, saved: 1, ended: 2 },
      teams: [{ team, open: 2, today: 1, saved: 1, ended: 2 }],
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
      ["now"],
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

it.effect("never returns a set id from a read", () =>
  Effect.gen(function* () {
    const service = yield* TransactionPlanService;
    const database = yield* ConnectionsDatabase;
    yield* TestClock.setTime(DateTime.toEpochMillis(at));
    yield* seedTeam(database, owner, team);

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [drop("a1", "Roster One"), { ...drop("a2", "Roster Two"), runDay: "2026-11-16" }],
    });

    const keys = new Set<string>();
    const reads = [
      yield* service.timeline(owner, {}),
      yield* service.plan(owner, { team }),
      yield* service.list(owner, { team, state: "today" }),
      yield* service.list(owner, { team, state: "saved" }),
      yield* service.list(owner, { team, state: "ended" }),
      yield* service.counts(owner, {}),
    ];
    for (const read of reads) {
      collectKeys(read, keys);
    }

    assert.deepStrictEqual(
      [...keys].filter((key) => /set/iu.test(key)),
      [],
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

    const result = yield* service.submit(owner, { team });

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
        true,
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

    const result = yield* service.submit(owner, { team });

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
        true,
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

    const result = yield* service.submit(owner, { team });

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
  }).pipe(Effect.provide(mutableFactsLayer(facts, true, writes.layer)));
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
    const result = yield* service.submit(owner, { team });

    assert.strictEqual(result.counts.failed, 1);
    assert.strictEqual(writes.requests.length, 0);
    const stored = yield* repository.readPlanMoves({ userId: owner, team });
    assert.strictEqual(stored[0]?.result, "failed");
    assert.include(stored[0]?.resultDetail ?? "", "not in the league's available player pool");

    const next = yield* service.runDue(10, at);
    assert.strictEqual(next.counts.moves, 0);
    assert.strictEqual(writes.requests.length, 0);
  }).pipe(Effect.provide(mutableFactsLayer(facts, true, writes.layer)));
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

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One", { runDay: today })],
    });

    const first = yield* service.runDue(10, at);
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
      serviceLayer([league([], [freeAgent("fa1", "Free Agent One", ["RB"])])], true, writes.layer),
    ),
  );
});

it.effect("runs an overdue saved move on the next tick", () => {
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
    const run = yield* service.runDue(10, at);

    assert.strictEqual(run.counts.executed, 1);
    assert.strictEqual(writes.requests.length, 1);
    const stored = yield* repository.readPlanMoves({ userId: owner, team });
    assert.strictEqual(stored[0]?.result, "executed");
    assert.strictEqual(stored[0]?.runDay, "2026-11-16");
    assert.strictEqual(stored[0]?.effectiveDate, "2026-11-17");
  }).pipe(Effect.provide(mutableFactsLayer(facts, true, writes.layer)));
});

it.effect("skips a plan that another run holds", () => {
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
      moves: [add("fa1", "Free Agent One")],
    });
    yield* repository.claimRun({ userId: owner, team, runClaim: "held-run", at });

    const due = yield* service.runDue(10, at);
    assert.strictEqual(due.counts.busy, 1);
    assert.strictEqual(due.counts.executed, 0);
    assert.strictEqual(writes.requests.length, 0);

    const failure = yield* service.submit(owner, { team }).pipe(Effect.flip);
    assert.isTrue(Schema.is(TransactionPlanRunInProgress)(failure));

    const plans = yield* database.select().from(transactionPlans);
    assert.strictEqual(plans[0]?.runClaim, "held-run");
  }).pipe(
    Effect.provide(
      serviceLayer([league([], [freeAgent("fa1", "Free Agent One", ["RB"])])], true, writes.layer),
    ),
  );
});

it.effect("recovers a stale claim before running the due moves", () => {
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
      moves: [add("fa1", "Free Agent One")],
    });
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
  }).pipe(
    Effect.provide(
      serviceLayer([league([], [freeAgent("fa1", "Free Agent One", ["RB"])])], true, writes.layer),
    ),
  );
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

    const result = yield* service.submit(owner, { team });

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
        true,
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

    yield* service.propose(owner, {
      team,
      proposedBy: proposer,
      moves: [add("fa1", "Free Agent One", { runDay: today })],
    });

    const first = yield* service.runDue(10, at);
    assert.strictEqual(first.counts.unknown, 1);
    const stored = yield* repository.readPlanMoves({ userId: owner, team });
    assert.strictEqual(stored[0]?.result, "unknown");

    const second = yield* service.runDue(10, at);
    assert.strictEqual(second.counts.moves, 0);
    assert.strictEqual(writes.requests.length, 1);
  }).pipe(
    Effect.provide(
      serviceLayer([league([], [freeAgent("fa1", "Free Agent One", ["RB"])])], true, writes.layer),
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

    const result = yield* service.submit(owner, { team });

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
        true,
        writes.layer,
      ),
    ),
  );
});

for (const timing of [
  { rule: "same_day" as const, currentDate: "2026-11-14", effectiveDate: "2026-11-15" },
  { rule: "next_day" as const, currentDate: "2026-11-14", effectiveDate: "2026-11-16" },
  { rule: "weekly_lock" as const, currentDate: "2026-11-19", effectiveDate: "2026-11-19" },
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
            timing: { rule: timing.rule, currentDate: timing.currentDate },
          },
        ).facts,
      );

      yield* service.propose(owner, {
        team,
        proposedBy: proposer,
        moves: [
          { ...drop("a1", "Roster One"), runDay: "2026-11-15" },
          { ...drop("a2", "Roster Two"), runDay: "2026-11-16" },
        ],
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
    }).pipe(Effect.provide(mutableFactsLayer(facts, true, writes.layer)));
  });
}

function serviceLayer(
  leagues: ReadonlyArray<League>,
  enabled = true,
  writes: Layer.Layer<TransactionPlanWrites> = executedWrites(),
): Layer.Layer<TransactionPlanService | TransactionPlanRepository | ConnectionsDatabase> {
  const byTeam = new Map(leagues.map((entry) => [entry.team, entry.facts] as const));
  return layerWith(
    (input) => {
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
    enabled,
    writes,
  );
}

function mutableFactsLayer(
  facts: Map<TeamId, TransactionPlanTeamFacts>,
  enabled = true,
  writes: Layer.Layer<TransactionPlanWrites> = executedWrites(),
): Layer.Layer<TransactionPlanService | TransactionPlanRepository | ConnectionsDatabase> {
  return layerWith(
    (input) => {
      const found = facts.get(input.team);
      return found === undefined
        ? Effect.fail(
            TransactionPlanFactsUnavailable.make({
              team: input.team,
              detail: "The league could not be read.",
            }),
          )
        : Effect.succeed(found);
    },
    enabled,
    writes,
  );
}

function executedWrites(): Layer.Layer<TransactionPlanWrites> {
  return writeLayer(() => ({ status: "executed" })).layer;
}

function writeLayer(
  outcome: (request: TransactionPlanWriteRequest, attempt: number) => TransactionPlanWriteResult,
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
      return outcome(request, attempt);
    });
  return { layer: Layer.succeed(TransactionPlanWrites)({ apply }), requests };
}

function layerWith(
  read: TransactionPlanFactsShape["read"],
  enabled = true,
  writes: Layer.Layer<TransactionPlanWrites> = executedWrites(),
): Layer.Layer<TransactionPlanService | TransactionPlanRepository | ConnectionsDatabase> {
  const Facts = Layer.succeed(TransactionPlanFacts)({ read });
  return TransactionPlanServiceLive.pipe(
    Layer.provideMerge(TransactionPlanRepository.layer),
    Layer.provide(Facts),
    Layer.provide(writes),
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

function droppedMoveId(plan: TransactionPlanView, key: string): TransactionMoveId {
  const move = plan.moves.find((entry) => entry.drops[0]?.key === key);
  if (move === undefined) {
    throw new Error(`The plan did not carry a drop of ${key}`);
  }
  return move.move;
}

function storedDrop(key: string, name: string): TransactionMoveAppend {
  return {
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
      decision: "now",
      decidedAt: undefined,
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

function collectKeys(value: unknown, keys: Set<string>): Set<string> {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectKeys(entry, keys);
    }
    return keys;
  }
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, entry] of Object.entries(value)) {
      keys.add(key);
      collectKeys(entry, keys);
    }
  }
  return keys;
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
      timing: overrides.timing ?? { rule: "next_day", currentDate: today },
      budget: overrides.budget,
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
