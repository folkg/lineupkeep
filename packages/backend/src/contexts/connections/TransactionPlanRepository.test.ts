import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import type { UserId } from "@lineupkeep/backend/auth/User";
import { eq } from "drizzle-orm";
import { Array, DateTime, Effect, Layer, Option, Schema } from "effect";

import layerTools from "#runtime/ProvideLayer.ts";

import { decodeTeamId } from "./FantasyTeam.ts";
import type { TeamId } from "./FantasyTeam.ts";
import { ConnectionsDatabase } from "./internal/ConnectionsDatabase.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { providerTeams } from "./internal/ConnectionTables.ts";
import { TransactionMoveId } from "./internal/TransactionPlanRecord.ts";
import type { TransactionMoveId as TransactionMoveIdType } from "./internal/TransactionPlanRecord.ts";
import type {
  TransactionMoveAppend,
  TransactionMoveContent,
} from "./internal/TransactionPlanRepository.ts";
import { TransactionPlanRepository } from "./internal/TransactionPlanRepository.ts";
import {
  transactionMoveClaims,
  transactionMoveSteps,
  transactionMoves,
  transactionPlans,
} from "./internal/TransactionPlanTables.ts";

const owner = decodeUserId("owner");
const other = decodeUserId("other");
const firstTeam = decodeTeamId("01ARZ3NDEKTSV4RRFFQ69G5FAV");
const secondTeam = decodeTeamId("01ARZ3NDEKTSV4RRFFQ69G5FAW");
const otherTeam = decodeTeamId("01ARZ3NDEKTSV4RRFFQ69G5FAX");
const at = DateTime.makeUnsafe("2026-11-14T10:00:00.000Z");

it.effect("creates one plan per owner and team when two creates race", () =>
  Effect.gen(function* () {
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* database
      .insert(providerTeams)
      .values([teamRow(firstTeam, owner), teamRow(secondTeam, owner)]);

    const [left, right] = yield* Effect.all(
      [
        repository.loadPlan({ userId: owner, team: firstTeam, at }),
        repository.loadPlan({ userId: owner, team: firstTeam, at }),
      ],
      { concurrency: "unbounded" },
    );

    assert.strictEqual(DateTime.formatIso(left.createdAt), DateTime.formatIso(right.createdAt));
    assert.strictEqual(left.runClaim, undefined);

    const loaded = yield* repository.loadPlan({ userId: owner, team: firstTeam, at });
    assert.strictEqual(DateTime.formatIso(loaded.createdAt), DateTime.formatIso(left.createdAt));

    const plans = yield* database.select().from(transactionPlans);
    assert.deepStrictEqual(
      plans.map((plan) => [plan.userId, plan.teamId]),
      [[owner, firstTeam]],
    );

    yield* repository.loadPlan({ userId: owner, team: secondTeam, at });
    const separate = yield* database.select().from(transactionPlans);
    assert.deepStrictEqual(
      separate.map((plan) => plan.teamId).sort(),
      [firstTeam, secondTeam].sort(),
    );
  }).pipe(layerTools.provide(RepositoryTest)),
);

it.effect("appends two interleaved batches without losing a move or its claims", () =>
  Effect.gen(function* () {
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* database.insert(providerTeams).values(teamRow(firstTeam, owner));

    const [first, second] = yield* Effect.all(
      [
        repository.appendMoves({
          userId: owner,
          team: firstTeam,
          at,
          moves: [appendMove("nhl.p.1"), appendMove("nhl.p.2")],
        }),
        repository.appendMoves({
          userId: owner,
          team: firstTeam,
          at,
          moves: [appendMove("nhl.p.3")],
        }),
      ],
      { concurrency: "unbounded" },
    );

    const moves = yield* repository.readPlanMoves({ userId: owner, team: firstTeam });
    assert.deepStrictEqual(
      moves.map((move) => move.position),
      [0, 1, 2],
    );
    assert.deepStrictEqual(
      moves.map((move) => move.id).sort(),
      [...first, ...second].map((move) => move.id).sort(),
    );
    assert.deepStrictEqual(
      moves.map((move) => move.claims),
      [
        [{ kind: "player", key: "nhl.p.1" }],
        [{ kind: "player", key: "nhl.p.2" }],
        [{ kind: "player", key: "nhl.p.3" }],
      ],
    );
    assert.strictEqual((yield* database.select().from(transactionMoves)).length, 3);
    assert.strictEqual((yield* database.select().from(transactionMoveClaims)).length, 3);
  }).pipe(layerTools.provide(RepositoryTest)),
);

it.effect("refuses a run claim while another run holds the plan", () =>
  Effect.gen(function* () {
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* database.insert(providerTeams).values(teamRow(firstTeam, owner));

    const claimed = yield* repository.claimRun({
      userId: owner,
      team: firstTeam,
      runClaim: "run-one",
      at,
    });
    assert.strictEqual(claimed.status, "claimed");
    assert.strictEqual(claimed.plan.runClaim, "run-one");

    const held = yield* repository.claimRun({
      userId: owner,
      team: firstTeam,
      runClaim: "run-two",
      at,
    });
    assert.strictEqual(held.status, "held");
    assert.strictEqual(held.plan.runClaim, "run-one");

    const ignored = yield* repository.releaseRun({
      userId: owner,
      team: firstTeam,
      runClaim: "run-two",
      at,
    });
    assert.isTrue(Option.isNone(ignored));

    const released = yield* repository.releaseRun({
      userId: owner,
      team: firstTeam,
      runClaim: "run-one",
      at,
    });
    assert.strictEqual(Option.getOrThrow(released).runClaim, undefined);

    const reclaimed = yield* repository.claimRun({
      userId: owner,
      team: firstTeam,
      runClaim: "run-two",
      at,
    });
    assert.strictEqual(reclaimed.status, "claimed");
    assert.strictEqual(reclaimed.plan.runClaim, "run-two");
  }).pipe(layerTools.provide(RepositoryTest)),
);

it.effect("edits a move in place and replaces the claims it holds", () =>
  Effect.gen(function* () {
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* database.insert(providerTeams).values(teamRow(firstTeam, owner));
    const stored = Array.getUnsafe(
      yield* repository.appendMoves({
        userId: owner,
        team: firstTeam,
        at,
        moves: [appendMove("nhl.p.1")],
      }),
      0,
    );

    const edited = yield* repository.editMove({
      userId: owner,
      team: firstTeam,
      move: stored.id,
      at: DateTime.addDuration(at, 60_000),
      edit: {
        content: moveContent({
          decision: "saved",
          runDay: "2026-11-16",
          effectiveDate: "2026-11-17",
          drops: [{ key: "nhl.p.2", name: "Replacement Drop" }],
          reason: "The center is out again.",
        }),
        claims: [{ kind: "player", key: "nhl.p.2" }],
      },
      groupDays: [],
    });

    assert.isTrue(Option.isSome(edited));
    const moves = yield* repository.readPlanMoves({ userId: owner, team: firstTeam });
    assert.strictEqual(moves.length, 1);
    assert.strictEqual(moves[0]?.decision, "saved");
    assert.strictEqual(moves[0]?.runDay, "2026-11-16");
    assert.strictEqual(moves[0]?.effectiveDate, "2026-11-17");
    assert.strictEqual(moves[0]?.reason, "The center is out again.");
    assert.deepStrictEqual(moves[0]?.claims, [{ kind: "player", key: "nhl.p.2" }]);
    assert.deepStrictEqual(
      (yield* database.select().from(transactionMoveClaims)).map((claim) => claim.claimKey),
      ["nhl.p.2"],
    );
  }).pipe(layerTools.provide(RepositoryTest)),
);

it.effect("discards a move and releases the claims it held", () =>
  Effect.gen(function* () {
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* database.insert(providerTeams).values(teamRow(firstTeam, owner));
    const stored = Array.getUnsafe(
      yield* repository.appendMoves({
        userId: owner,
        team: firstTeam,
        at,
        moves: [appendMove("nhl.p.1")],
      }),
      0,
    );

    const discarded = yield* repository.discardMoves({
      userId: owner,
      team: firstTeam,
      moves: [stored.id],
      decision: { decidedBy: "owner", surface: "transactions.discard" },
      at,
    });

    assert.strictEqual(discarded.length, 1);
    const moves = yield* repository.readPlanMoves({ userId: owner, team: firstTeam });
    assert.strictEqual(moves[0]?.decision, "discarded");
    assert.strictEqual(
      DateTime.formatIso(Option.getOrThrow(Option.fromNullishOr(moves[0]?.decidedAt))),
      DateTime.formatIso(at),
    );
    assert.deepStrictEqual(moves[0]?.claims, []);
    assert.deepStrictEqual(yield* database.select().from(transactionMoveClaims), []);
  }).pipe(layerTools.provide(RepositoryTest)),
);

it.effect("records a result and releases claims only when the result ends the move", () =>
  Effect.gen(function* () {
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* database.insert(providerTeams).values(teamRow(firstTeam, owner));
    const appended = yield* repository.appendMoves({
      userId: owner,
      team: firstTeam,
      at,
      moves: [appendMove("nhl.p.1"), appendMove("nhl.p.2")],
    });
    const pendingMove = Array.getUnsafe(appended, 0);
    const executedMove = Array.getUnsafe(appended, 1);

    const pending = yield* repository.recordResult({
      userId: owner,
      team: firstTeam,
      move: pendingMove.id,
      result: "pending",
      detail: "The league has not processed the waiver.",
      externalRef: "waiver-1",
      at,
    });
    assert.isTrue(Option.isSome(pending));
    const stillOpen = yield* repository.readPlanMoves({ userId: owner, team: firstTeam });
    assert.strictEqual(stillOpen.find((move) => move.id === pendingMove.id)?.result, "pending");
    assert.deepStrictEqual(stillOpen.find((move) => move.id === pendingMove.id)?.claims, [
      { kind: "player", key: "nhl.p.1" },
    ]);
    assert.strictEqual(
      stillOpen.find((move) => move.id === pendingMove.id)?.externalRef,
      "waiver-1",
    );

    const executed = yield* repository.recordResult({
      userId: owner,
      team: firstTeam,
      move: executedMove.id,
      result: "executed",
      detail: "The league accepted the drop.",
      externalRef: undefined,
      at,
    });
    assert.isTrue(Option.isSome(executed));
    const settled = yield* repository.readPlanMoves({ userId: owner, team: firstTeam });
    assert.strictEqual(settled.find((move) => move.id === executedMove.id)?.result, "executed");
    assert.deepStrictEqual(settled.find((move) => move.id === executedMove.id)?.claims, []);
    assert.deepStrictEqual(
      (yield* database.select().from(transactionMoveClaims)).map((claim) => claim.claimKey),
      ["nhl.p.1"],
    );
  }).pipe(layerTools.provide(RepositoryTest)),
);

it.effect("reads the submitted legs of a plan for one effective date", () =>
  Effect.gen(function* () {
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* database
      .insert(providerTeams)
      .values([teamRow(firstTeam, owner), teamRow(secondTeam, owner)]);
    const submitted = yield* repository.appendMoves({
      userId: owner,
      team: firstTeam,
      at,
      moves: [
        appendMove("nhl.p.1"),
        appendMove("nhl.p.2", { effectiveDate: "2026-11-16" }),
        appendMove("nhl.p.3"),
      ],
    });
    const otherTeamMove = Array.getUnsafe(
      yield* repository.appendMoves({
        userId: owner,
        team: secondTeam,
        at,
        moves: [appendMove("nhl.p.4")],
      }),
      0,
    );
    for (const move of [...submitted, otherTeamMove]) {
      yield* repository.recordResult({
        userId: owner,
        team: move.team,
        move: move.id,
        result: "executed",
        detail: undefined,
        externalRef: undefined,
        at,
      });
    }

    const read = yield* repository.readSubmittedMoves({
      userId: owner,
      teams: [firstTeam],
      dates: ["2026-11-15"],
    });

    assert.deepStrictEqual(
      read.map((move) => move.id),
      [Array.getUnsafe(submitted, 0).id, Array.getUnsafe(submitted, 2).id],
    );
    assert.deepStrictEqual(
      (yield* repository.readSubmittedMoves({
        userId: other,
        teams: [firstTeam],
        dates: ["2026-11-15"],
      })).map((move) => move.id),
      [],
    );
  }).pipe(layerTools.provide(RepositoryTest)),
);

it.effect("pages one owner's moves by state and orders them by run day, team, and position", () =>
  Effect.gen(function* () {
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* database
      .insert(providerTeams)
      .values([teamRow(firstTeam, owner), teamRow(otherTeam, other)]);

    yield* repository.appendMoves({
      userId: owner,
      team: firstTeam,
      at,
      moves: [
        appendMove("nhl.p.1"),
        appendMove("nhl.p.2", { decision: "saved", runDay: "2026-11-16" }),
        appendMove("nhl.p.3", { decision: "saved", runDay: "2026-11-15" }),
        appendMove("nhl.p.4", { runDay: undefined }),
      ],
    });
    const settled = yield* repository.appendMoves({
      userId: owner,
      team: firstTeam,
      at,
      moves: [appendMove("nhl.p.5"), appendMove("nhl.p.6")],
    });
    const executed = Array.getUnsafe(settled, 0);
    const discarded = Array.getUnsafe(settled, 1);
    yield* repository.recordResult({
      userId: owner,
      team: firstTeam,
      move: executed.id,
      result: "executed",
      detail: "The league accepted the drop.",
      externalRef: undefined,
      at,
    });
    yield* repository.discardMoves({
      userId: owner,
      team: firstTeam,
      moves: [discarded.id],
      decision: { decidedBy: "owner", surface: "transactions.discard" },
      at,
    });
    yield* repository.appendMoves({
      userId: other,
      team: otherTeam,
      at,
      moves: [appendMove("nhl.p.7", { decision: "saved" })],
    });

    const all = yield* repository.readOwnerMoves({
      userId: owner,
      team: undefined,
      state: "open",
      after: undefined,
      limit: 50,
    });
    assert.deepStrictEqual(
      all.map(({ move }) => move.claims[0]?.key),
      ["nhl.p.4", "nhl.p.1", "nhl.p.3", "nhl.p.2"],
    );
    assert.isTrue(all.every(({ move, team }) => move.team === firstTeam && team.id === firstTeam));
    assert.deepStrictEqual(
      all.map(({ team }) => team.name),
      all.map(() => `Team ${firstTeam}`),
    );

    const saved = yield* repository.readOwnerMoves({
      userId: owner,
      team: undefined,
      state: "saved",
      after: undefined,
      limit: 50,
    });
    assert.deepStrictEqual(
      saved.map(({ move }) => move.claims[0]?.key),
      ["nhl.p.3", "nhl.p.2"],
    );

    const today = yield* repository.readOwnerMoves({
      userId: owner,
      team: undefined,
      state: "today",
      after: undefined,
      limit: 50,
    });
    assert.deepStrictEqual(
      today.map(({ move }) => move.claims[0]?.key),
      ["nhl.p.4", "nhl.p.1"],
    );

    const ended = yield* repository.readOwnerMoves({
      userId: owner,
      team: undefined,
      state: "ended",
      after: undefined,
      limit: 50,
    });
    assert.deepStrictEqual(
      ended.map(({ move }) => move.result ?? move.decision),
      ["executed"],
    );

    const firstPage = yield* repository.readOwnerMoves({
      userId: owner,
      team: undefined,
      state: "open",
      after: undefined,
      limit: 2,
    });
    const last = Array.getUnsafe(firstPage, firstPage.length - 1);
    const secondPage = yield* repository.readOwnerMoves({
      userId: owner,
      team: undefined,
      state: "open",
      after: {
        runDay: last.move.runDay ?? null,
        team: last.move.team,
        position: last.move.position,
        move: last.move.id,
      },
      limit: 50,
    });
    assert.deepStrictEqual(
      [...firstPage, ...secondPage].map(({ move }) => move.claims[0]?.key),
      ["nhl.p.4", "nhl.p.1", "nhl.p.3", "nhl.p.2"],
    );

    const firstToday = yield* repository.readOwnerMoves({
      userId: owner,
      team: undefined,
      state: "open",
      after: undefined,
      limit: 1,
    });
    const undated = Array.getUnsafe(firstToday, 0);
    const afterUndated = yield* repository.readOwnerMoves({
      userId: owner,
      team: undefined,
      state: "open",
      after: {
        runDay: undated.move.runDay ?? null,
        team: undated.move.team,
        position: undated.move.position,
        move: undated.move.id,
      },
      limit: 50,
    });
    assert.deepStrictEqual(
      [...firstToday, ...afterUndated].map(({ move }) => move.claims[0]?.key),
      ["nhl.p.4", "nhl.p.1", "nhl.p.3", "nhl.p.2"],
    );
  }).pipe(layerTools.provide(RepositoryTest)),
);

it.effect("removes a plan's moves and claims when the plan is removed", () =>
  Effect.gen(function* () {
    const repository = yield* TransactionPlanRepository;
    const database = yield* ConnectionsDatabase;
    yield* database.insert(providerTeams).values(teamRow(firstTeam, owner));
    const appended = yield* repository.appendMoves({
      userId: owner,
      team: firstTeam,
      at,
      moves: [appendMove("nhl.p.1"), appendMove("nhl.p.2")],
    });
    yield* database.insert(transactionMoveSteps).values({
      id: "018f79ea-7d86-7c18-9b4a-8b4d0c916001",
      moveId: Array.getUnsafe(appended, 0).id,
      position: 0,
      kind: "drop",
      playerKey: "nhl.p.1",
      outcome: "executed",
      decidedAt: DateTime.toDateUtc(at),
    });

    yield* database.delete(transactionPlans).where(eq(transactionPlans.teamId, firstTeam));

    assert.deepStrictEqual(yield* database.select().from(transactionMoves), []);
    assert.deepStrictEqual(yield* database.select().from(transactionMoveClaims), []);
    assert.deepStrictEqual(yield* database.select().from(transactionMoveSteps), []);
  }).pipe(layerTools.provide(RepositoryTest)),
);

function teamRow(id: TeamId, userId: UserId): typeof providerTeams.$inferInsert {
  return {
    id,
    connectionId: "connection",
    userId,
    provider: "yahoo",
    providerTeamKey: `team-${id}`,
    providerLeagueKey: `league-${id}`,
    league: "nhl" as const,
    sport: "hockey" as const,
    season: 2026,
    name: `Team ${id}`,
    automationState: {},
    automationStatus: "disabled" as const,
    lastSeenAt: DateTime.toDateUtc(at),
    createdAt: DateTime.toDateUtc(at),
    updatedAt: DateTime.toDateUtc(at),
  };
}

let moveSequence = 0;

function nextMoveId(): TransactionMoveIdType {
  moveSequence += 1;
  return Effect.runSync(
    Schema.decodeEffect(TransactionMoveId)(`01J${String(moveSequence).padStart(23, "0")}`),
  );
}

function appendMove(
  playerKey: string,
  content: Partial<TransactionMoveContent> = {},
): TransactionMoveAppend {
  return {
    id: nextMoveId(),
    proposedBy: { kind: "agent", reference: "mcp", surface: "mcp" },
    content: moveContent({
      drops: [{ key: playerKey, name: `Player ${playerKey}` }],
      ...content,
    }),
    claims: [{ kind: "player", key: playerKey }],
  };
}

function moveContent(content: Partial<TransactionMoveContent> = {}): TransactionMoveContent {
  return {
    group: undefined,
    kind: "drop",
    adds: [],
    fallbacks: [],
    drops: [],
    picks: [],
    slotMove: undefined,
    intent: undefined,
    placement: undefined,
    counterpartyKey: undefined,
    bid: undefined,
    reason: "Cover the light night at center.",
    runDay: "2026-11-14",
    effectiveDate: "2026-11-15",
    phase: undefined,
    attempts: [],
    decision: "undecided",
    decidedAt: undefined,
    decidedBy: "agent",
    surface: "propose_transactions",
    confirmedAt: undefined,
    confirmedBy: undefined,
    validation: { status: "current", checkedAt: at, reasons: [] },
    ...content,
  };
}

const RepositoryTest = TransactionPlanRepository.layer.pipe(
  Layer.provideMerge(ConnectionsDatabaseTest),
  Layer.provide(NodeCrypto.layer),
);
