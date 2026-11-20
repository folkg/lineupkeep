import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  gt,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  min,
  ne,
  not,
  or,
} from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Array, Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SecureRandom } from "effect/crypto";

import { UserId } from "#contexts/auth/User.ts";
import { TeamId } from "#contexts/connections/FantasyTeam.ts";
import { anyOf } from "#database/dbUtilities.ts";

import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import { providerTeams } from "./ConnectionTables.ts";
import {
  StoredMoveClaim,
  StoredMoveDate,
  StoredMoveIntent,
  StoredMovePick,
  StoredMovePlacement,
  StoredMovePlayer,
  StoredMoveSlot,
  StoredMoveAttempt,
  StoredMoveValidation,
  TransactionDecision,
  TransactionDecisionActor,
  TransactionMoveCursor,
  TransactionMoveDecision,
  TransactionMoveId,
  TransactionMoveKind,
  TransactionMovePageLimit,
  TransactionMovePhase,
  TransactionMoveProvenance,
  TransactionMoveReadState,
  TransactionMoveRecord,
  TransactionMoveResult,
  TransactionMoveTeam,
  TransactionMoveValidationStatus,
  TransactionPlanPersistenceFailed,
  TransactionPlanRecord,
  TransactionPlanRunCounts,
  TransactionPlanRunRefusal,
  TransactionRunId,
  TransactionRunRecord,
  TransactionRunTrigger,
  isOpenMove,
} from "./TransactionPlanRecord.ts";
import type { StoredMoveStep, TransactionMoveRowRecord } from "./TransactionPlanRecord.ts";
import {
  StoredMoveStepRow,
  TransactionMoveRow,
  TransactionPlanRow,
  TransactionRunRow,
  openMovePredicate,
  transactionMoveClaims,
  transactionMoves,
  transactionMoveSteps,
  transactionPlans,
  transactionRuns,
} from "./TransactionPlanTables.ts";

export type TransactionMoveContent = {
  readonly group: string | undefined;
  readonly kind: TransactionMoveKind;
  readonly adds: ReadonlyArray<StoredMovePlayer>;
  readonly fallbacks: ReadonlyArray<StoredMovePlayer>;
  readonly drops: ReadonlyArray<StoredMovePlayer>;
  readonly picks: ReadonlyArray<StoredMovePick>;
  readonly slotMove: StoredMoveSlot | undefined;
  readonly intent: StoredMoveIntent | undefined;
  readonly placement: StoredMovePlacement | undefined;
  readonly counterpartyKey: string | undefined;
  readonly bid: number | undefined;
  readonly reason: string;
  readonly runDay: StoredMoveDate | undefined;
  readonly effectiveDate: StoredMoveDate | undefined;
  readonly phase: TransactionMovePhase | undefined;
  readonly attempts: ReadonlyArray<StoredMoveAttempt>;
  readonly decision: TransactionMoveDecision;
  readonly decidedAt: DateTime.Utc | undefined;
  readonly decidedBy: TransactionDecisionActor | undefined;
  readonly surface: string | undefined;
  readonly confirmedAt: DateTime.Utc | undefined;
  readonly confirmedBy: UserId | undefined;
  readonly validation: StoredMoveValidation;
};

export type TransactionMoveAppend = {
  readonly id: TransactionMoveId;
  readonly proposedBy: TransactionMoveProvenance;
  readonly content: TransactionMoveContent;
  readonly claims: ReadonlyArray<StoredMoveClaim>;
};

export type TransactionMoveSettlement = {
  readonly move: TransactionMoveId;
  readonly result: TransactionMoveResult;
  readonly detail: string | undefined;
  readonly validation: StoredMoveValidation;
  readonly runDay: StoredMoveDate;
  readonly effectiveDate: StoredMoveDate | undefined;
  readonly runPosition: number | undefined;
  readonly phase: TransactionMovePhase | undefined;
  readonly attempts: ReadonlyArray<StoredMoveAttempt>;
  readonly content: TransactionMoveSettlementContent | undefined;
  readonly run:
    | {
        readonly id: TransactionRunId;
        readonly at: DateTime.Utc;
        readonly decidedBy: TransactionDecisionActor | undefined;
        readonly surface: string | undefined;
      }
    | undefined;
  readonly steps: ReadonlyArray<StoredMoveStep>;
};

type TransactionMoveSettlementContent = {
  readonly kind: TransactionMoveKind;
  readonly adds: ReadonlyArray<StoredMovePlayer>;
  readonly fallbacks: ReadonlyArray<StoredMovePlayer>;
  readonly bid: number | undefined;
};

export type TransactionPlanRef = {
  readonly userId: UserId;
  readonly team: TeamId;
};

type TransactionMoveWithTeam = {
  readonly move: TransactionMoveRecord;
  readonly team: TransactionMoveTeam;
};

type TransactionMoveEdit = {
  readonly content: TransactionMoveContent;
  readonly claims: ReadonlyArray<StoredMoveClaim>;
};

type TransactionMoveDay = {
  readonly move: TransactionMoveId;
  readonly runDay: StoredMoveDate | undefined;
  readonly effectiveDate: StoredMoveDate | undefined;
  readonly decision: TransactionMoveDecision;
  readonly decidedBy: TransactionDecisionActor;
  readonly surface: string;
};

type TransactionRunClaim =
  | { readonly status: "claimed"; readonly plan: TransactionPlanRecord }
  | { readonly status: "held"; readonly plan: TransactionPlanRecord };

export class TransactionPlanRepository extends Context.Service<TransactionPlanRepository>()(
  "@lineupkeep/backend/contexts/connections/internal/TransactionPlanRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;
      const random = yield* SecureRandom.SecureRandom;

      const newStepId = random.ulid;

      const loadPlan = Effect.fn("TransactionPlanRepository.loadPlan")(function* (input: {
        readonly userId: UserId;
        readonly team: TeamId;
        readonly at: DateTime.Utc;
      }) {
        return yield* database
          .transaction((tx) => ensurePlan(tx, input))
          .pipe(Effect.mapError(persistenceFailure));
      });

      const appendMoves = Effect.fn("TransactionPlanRepository.appendMoves")(function* (input: {
        readonly userId: UserId;
        readonly team: TeamId;
        readonly moves: Array.NonEmptyReadonlyArray<TransactionMoveAppend>;
        readonly at: DateTime.Utc;
      }) {
        const ids = input.moves.map((move) => ({ move, id: move.id }));
        const at = DateTime.toDateUtc(input.at);
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* ensurePlan(tx, input);
              const positions = yield* tx
                .select({ position: max(transactionMoves.position) })
                .from(transactionMoves)
                .where(
                  and(
                    eq(transactionMoves.userId, input.userId),
                    eq(transactionMoves.teamId, input.team),
                  ),
                );
              const first = (positions[0]?.position ?? -1) + 1;
              const inserted = yield* tx
                .insert(transactionMoves)
                .values(
                  ids.map(({ move, id }, index) => ({
                    id,
                    userId: input.userId,
                    teamId: input.team,
                    position: first + index,
                    createdAt: at,
                    ...moveValues(move.content, input.at),
                    externalRef: null,
                    runPosition: null,
                    proposedBy: move.proposedBy,
                  })),
                )
                .returning();
              const claims = ids.flatMap(({ move, id }) =>
                move.claims.map((claim) => ({
                  userId: input.userId,
                  teamId: input.team,
                  claimKind: claim.kind,
                  claimKey: claim.key,
                  moveId: id,
                  createdAt: at,
                })),
              );
              if (claims.length > 0) {
                yield* tx.insert(transactionMoveClaims).values(claims);
              }
              yield* tx
                .update(transactionPlans)
                .set({ updatedAt: at })
                .where(
                  and(
                    eq(transactionPlans.userId, input.userId),
                    eq(transactionPlans.teamId, input.team),
                  ),
                );
              const byId = new Map(
                (yield* Effect.forEach(inserted, decodeMove)).map((move) => [move.id, move]),
              );
              return ids.map(({ move, id }) => {
                const stored = byId.get(id);
                if (stored === undefined) {
                  throw new Error("An appended move was not returned");
                }
                return { ...stored, claims: [...move.claims] };
              });
            }),
          )
          .pipe(Effect.mapError(persistenceFailure));
      });

      const editMove = Effect.fn("TransactionPlanRepository.editMove")(function* (input: {
        readonly userId: UserId;
        readonly team: TeamId;
        readonly move: TransactionMoveId;
        readonly edit: TransactionMoveEdit;
        readonly groupDays: ReadonlyArray<TransactionMoveDay>;
        readonly at: DateTime.Utc;
      }) {
        const at = DateTime.toDateUtc(input.at);
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              if (!(yield* lockPlan(tx, input))) {
                return Option.none<TransactionMoveRecord>();
              }
              const updated = yield* tx
                .update(transactionMoves)
                .set(moveValues(input.edit.content, input.at))
                .where(
                  and(
                    eq(transactionMoves.userId, input.userId),
                    eq(transactionMoves.teamId, input.team),
                    eq(transactionMoves.id, input.move),
                  ),
                )
                .returning();
              const row = updated[0];
              if (row === undefined) {
                return Option.none<TransactionMoveRecord>();
              }
              yield* tx
                .delete(transactionMoveClaims)
                .where(eq(transactionMoveClaims.moveId, input.move));
              if (input.edit.claims.length > 0) {
                yield* tx.insert(transactionMoveClaims).values(
                  input.edit.claims.map((claim) => ({
                    userId: input.userId,
                    teamId: input.team,
                    claimKind: claim.kind,
                    claimKey: claim.key,
                    moveId: input.move,
                    createdAt: at,
                  })),
                );
              }
              for (const day of input.groupDays) {
                yield* tx
                  .update(transactionMoves)
                  .set({
                    runDay: day.runDay ?? null,
                    effectiveDate: day.effectiveDate ?? null,
                    decision: day.decision,
                    decidedAt: at,
                    decidedBy: day.decidedBy,
                    decidedSurface: day.surface,
                    confirmedAt: null,
                    confirmedBy: null,
                    updatedAt: at,
                  })
                  .where(
                    and(
                      eq(transactionMoves.userId, input.userId),
                      eq(transactionMoves.teamId, input.team),
                      eq(transactionMoves.id, day.move),
                    ),
                  );
              }
              yield* tx
                .update(transactionPlans)
                .set({ updatedAt: at })
                .where(
                  and(
                    eq(transactionPlans.userId, input.userId),
                    eq(transactionPlans.teamId, input.team),
                  ),
                );
              return Option.some({
                ...(yield* decodeMove(row)),
                claims: [...input.edit.claims],
              });
            }),
          )
          .pipe(Effect.mapError(persistenceFailure));
      });

      const discardMoves = Effect.fn("TransactionPlanRepository.discardMoves")(function* (input: {
        readonly userId: UserId;
        readonly team: TeamId;
        readonly moves: Array.NonEmptyReadonlyArray<TransactionMoveId>;
        readonly decision: TransactionDecision;
        readonly at: DateTime.Utc;
      }) {
        const at = DateTime.toDateUtc(input.at);
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              if (!(yield* lockPlan(tx, input))) {
                return [];
              }
              const updated = yield* tx
                .update(transactionMoves)
                .set({
                  decision: "discarded",
                  decidedAt: at,
                  decidedBy: input.decision.decidedBy,
                  decidedSurface: input.decision.surface,
                  updatedAt: at,
                })
                .where(
                  and(
                    eq(transactionMoves.userId, input.userId),
                    eq(transactionMoves.teamId, input.team),
                    anyOf(transactionMoves.id, input.moves),
                  ),
                )
                .returning();
              yield* tx
                .delete(transactionMoveClaims)
                .where(anyOf(transactionMoveClaims.moveId, input.moves));
              yield* tx
                .update(transactionPlans)
                .set({ updatedAt: at })
                .where(
                  and(
                    eq(transactionPlans.userId, input.userId),
                    eq(transactionPlans.teamId, input.team),
                  ),
                );
              return yield* Effect.forEach(updated, decodeMove);
            }),
          )
          .pipe(Effect.mapError(persistenceFailure));
      });

      const confirmMoves = Effect.fn("TransactionPlanRepository.confirmMoves")(function* (input: {
        readonly userId: UserId;
        readonly team: TeamId;
        readonly confirmedBy: UserId;
        readonly decision: TransactionDecision;
        readonly moves: Array.NonEmptyReadonlyArray<{
          readonly move: TransactionMoveId;
          readonly decision: TransactionMoveDecision;
        }>;
        readonly at: DateTime.Utc;
      }) {
        const at = DateTime.toDateUtc(input.at);
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              if (!(yield* lockPlan(tx, input))) {
                return false;
              }
              for (const move of input.moves) {
                yield* tx
                  .update(transactionMoves)
                  .set({
                    decision: move.decision,
                    decidedAt: at,
                    decidedBy: input.decision.decidedBy,
                    decidedSurface: input.decision.surface,
                    confirmedAt: at,
                    confirmedBy: input.confirmedBy,
                    updatedAt: at,
                  })
                  .where(
                    and(
                      eq(transactionMoves.userId, input.userId),
                      eq(transactionMoves.teamId, input.team),
                      eq(transactionMoves.id, move.move),
                    ),
                  );
              }
              yield* tx
                .update(transactionPlans)
                .set({ updatedAt: at })
                .where(
                  and(
                    eq(transactionPlans.userId, input.userId),
                    eq(transactionPlans.teamId, input.team),
                  ),
                );
              return true;
            }),
          )
          .pipe(Effect.mapError(persistenceFailure));
      });

      const beginRun = Effect.fn("TransactionPlanRepository.beginRun")(function* (input: {
        readonly userId: UserId;
        readonly team: TeamId;
        readonly run: TransactionRunId;
        readonly trigger: TransactionRunTrigger;
        readonly decision: TransactionDecision;
        readonly key: string | undefined;
        readonly counts: TransactionPlanRunCounts;
        readonly refusals: ReadonlyArray<TransactionPlanRunRefusal>;
        readonly at: DateTime.Utc;
      }) {
        const at = DateTime.toDateUtc(input.at);
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              yield* ensurePlan(tx, input);
              const inserted = yield* tx
                .insert(transactionRuns)
                .values({
                  id: input.run,
                  userId: input.userId,
                  teamId: input.team,
                  trigger: input.trigger,
                  decidedBy: input.decision.decidedBy,
                  decidedSurface: input.decision.surface,
                  key: input.key ?? null,
                  at,
                  counts: input.counts,
                  refusals: input.refusals,
                  createdAt: at,
                })
                .onConflictDoNothing()
                .returning();
              const created = inserted[0];
              if (created !== undefined) {
                return { status: "started", run: yield* decodeRun(created) } as const;
              }
              if (input.key === undefined) {
                return yield* Effect.die(
                  new Error("A tick run without an idempotency key was not recorded"),
                );
              }
              const existing = yield* tx
                .select()
                .from(transactionRuns)
                .where(
                  and(
                    eq(transactionRuns.userId, input.userId),
                    eq(transactionRuns.teamId, input.team),
                    eq(transactionRuns.key, input.key),
                  ),
                )
                .limit(1);
              const row = existing[0];
              if (row === undefined) {
                return yield* Effect.die(
                  new Error("A recorded run was not found after its key conflicted"),
                );
              }
              return { status: "recorded", run: yield* decodeRun(row) } as const;
            }),
          )
          .pipe(Effect.mapError(persistenceFailure));
      });

      const finishRun = Effect.fn("TransactionPlanRepository.finishRun")(function* (input: {
        readonly run: TransactionRunId;
        readonly counts: TransactionPlanRunCounts;
        readonly refusals: ReadonlyArray<TransactionPlanRunRefusal>;
        readonly at: DateTime.Utc;
      }) {
        const at = DateTime.toDateUtc(input.at);
        const updated = yield* database
          .update(transactionRuns)
          .set({
            finishedAt: at,
            counts: input.counts,
            refusals: input.refusals,
          })
          .where(eq(transactionRuns.id, input.run))
          .returning()
          .pipe(Effect.mapError(persistenceFailure));
        const row = updated[0];
        if (row === undefined) {
          return yield* Effect.die(new Error("A finished run was not found"));
        }
        return yield* decodeRun(row).pipe(Effect.mapError(persistenceFailure));
      });

      const readRun = Effect.fn("TransactionPlanRepository.readRun")(function* (input: {
        readonly userId: UserId;
        readonly team: TeamId;
        readonly run: TransactionRunId;
      }) {
        const rows = yield* database
          .select()
          .from(transactionRuns)
          .where(
            and(
              eq(transactionRuns.userId, input.userId),
              eq(transactionRuns.teamId, input.team),
              eq(transactionRuns.id, input.run),
            ),
          )
          .limit(1);
        const row = rows[0];
        return row === undefined
          ? Option.none<TransactionRunRecord>()
          : Option.some(yield* decodeRun(row));
      }, Effect.mapError(persistenceFailure));

      const readRunByKey = Effect.fn("TransactionPlanRepository.readRunByKey")(function* (input: {
        readonly userId: UserId;
        readonly team: TeamId;
        readonly key: string;
      }) {
        const rows = yield* database
          .select()
          .from(transactionRuns)
          .where(
            and(
              eq(transactionRuns.userId, input.userId),
              eq(transactionRuns.teamId, input.team),
              eq(transactionRuns.key, input.key),
            ),
          )
          .limit(1);
        const row = rows[0];
        return row === undefined
          ? Option.none<TransactionRunRecord>()
          : Option.some(yield* decodeRun(row));
      }, Effect.mapError(persistenceFailure));

      const claimRun = Effect.fn("TransactionPlanRepository.claimRun")(function* (input: {
        readonly userId: UserId;
        readonly team: TeamId;
        readonly runClaim: string;
        readonly at: DateTime.Utc;
      }) {
        const at = DateTime.toDateUtc(input.at);
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const plan = yield* ensurePlan(tx, input);
              const claimed = yield* tx
                .update(transactionPlans)
                .set({ runClaim: input.runClaim, runClaimedAt: at, updatedAt: at })
                .where(
                  and(
                    eq(transactionPlans.userId, input.userId),
                    eq(transactionPlans.teamId, input.team),
                    isNull(transactionPlans.runClaim),
                  ),
                )
                .returning();
              const row = claimed[0];
              return row === undefined
                ? ({ status: "held", plan } satisfies TransactionRunClaim)
                : ({
                    status: "claimed",
                    plan: yield* decodePlan(row),
                  } satisfies TransactionRunClaim);
            }),
          )
          .pipe(Effect.mapError(persistenceFailure));
      });

      const releaseRun = Effect.fn("TransactionPlanRepository.releaseRun")(function* (input: {
        readonly userId: UserId;
        readonly team: TeamId;
        readonly runClaim: string;
        readonly at: DateTime.Utc;
      }) {
        const at = DateTime.toDateUtc(input.at);
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const released = yield* tx
                .update(transactionPlans)
                .set({ runClaim: null, runClaimedAt: null, updatedAt: at })
                .where(
                  and(
                    eq(transactionPlans.userId, input.userId),
                    eq(transactionPlans.teamId, input.team),
                    eq(transactionPlans.runClaim, input.runClaim),
                  ),
                )
                .returning();
              const row = released[0];
              if (row === undefined) {
                return Option.none<TransactionPlanRecord>();
              }
              return Option.some(yield* decodePlan(row));
            }),
          )
          .pipe(Effect.mapError(persistenceFailure));
      });

      const recordResult = Effect.fn("TransactionPlanRepository.recordResult")(function* (input: {
        readonly userId: UserId;
        readonly team: TeamId;
        readonly move: TransactionMoveId;
        readonly result: TransactionMoveResult;
        readonly detail: string | undefined;
        readonly externalRef: string | undefined;
        readonly at: DateTime.Utc;
      }) {
        const at = DateTime.toDateUtc(input.at);
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              if (!(yield* lockPlan(tx, input))) {
                return Option.none<TransactionMoveRecord>();
              }
              const updated = yield* tx
                .update(transactionMoves)
                .set({
                  result: input.result,
                  resultDetail: input.detail ?? null,
                  resultAt: at,
                  updatedAt: at,
                  ...(input.externalRef === undefined ? {} : { externalRef: input.externalRef }),
                })
                .where(
                  and(
                    eq(transactionMoves.userId, input.userId),
                    eq(transactionMoves.teamId, input.team),
                    eq(transactionMoves.id, input.move),
                  ),
                )
                .returning();
              const row = updated[0];
              if (row === undefined) {
                return Option.none<TransactionMoveRecord>();
              }
              if (endsMove(input.result)) {
                yield* tx
                  .delete(transactionMoveClaims)
                  .where(eq(transactionMoveClaims.moveId, input.move));
              }
              yield* tx
                .update(transactionPlans)
                .set({ updatedAt: at })
                .where(
                  and(
                    eq(transactionPlans.userId, input.userId),
                    eq(transactionPlans.teamId, input.team),
                  ),
                );
              const move = yield* decodeMove(row);
              return Option.some({
                ...move,
                claims: endsMove(input.result) ? [] : yield* readMoveClaims(tx, move.id),
              });
            }),
          )
          .pipe(Effect.mapError(persistenceFailure));
      });

      const settleMoves = Effect.fn("TransactionPlanRepository.settleMoves")(function* (input: {
        readonly userId: UserId;
        readonly team: TeamId;
        readonly at: DateTime.Utc;
        readonly settlements: Array.NonEmptyReadonlyArray<TransactionMoveSettlement>;
      }) {
        const at = DateTime.toDateUtc(input.at);
        const steps = yield* Effect.forEach(input.settlements, (settlement) =>
          Effect.forEach(settlement.steps, (step, position) =>
            newStepId.pipe(
              Effect.map((id) => ({
                id,
                moveId: settlement.move,
                position,
                kind: step.kind,
                playerKey: step.playerKey,
                fromSlot: step.fromSlot ?? null,
                toSlot: step.toSlot ?? null,
                outcome: step.outcome,
                detail: step.detail ?? null,
                decidedAt: DateTime.toDateUtc(step.decidedAt),
              })),
            ),
          ),
        );
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              if (!(yield* lockPlan(tx, input))) {
                return yield* Effect.die(
                  new Error("A run settled moves on a plan that no longer exists"),
                );
              }
              const ids = input.settlements.map((settlement) => String(settlement.move));
              if (!Array.isArrayNonEmpty(ids)) {
                return yield* Effect.die(new Error("A run settled no moves"));
              }
              yield* tx.delete(transactionMoveSteps).where(anyOf(transactionMoveSteps.moveId, ids));
              const rows = steps.flat();
              if (rows.length > 0) {
                yield* tx.insert(transactionMoveSteps).values(rows);
              }
              for (const settlement of input.settlements) {
                yield* tx
                  .update(transactionMoves)
                  .set({
                    ...(settlement.content === undefined
                      ? {}
                      : {
                          kind: settlement.content.kind,
                          adds: settlement.content.adds,
                          fallbacks: settlement.content.fallbacks,
                          bid: settlement.content.bid ?? null,
                        }),
                    result: settlement.result,
                    resultDetail: settlement.detail ?? null,
                    resultAt: at,
                    runDay: settlement.runDay,
                    effectiveDate: settlement.effectiveDate ?? null,
                    phase: settlement.phase ?? null,
                    attempts: settlement.attempts,
                    validation: settlement.validation.status,
                    checkedAt:
                      settlement.validation.checkedAt === undefined
                        ? at
                        : DateTime.toDateUtc(settlement.validation.checkedAt),
                    validationReasons: settlement.validation.reasons,
                    runPosition: settlement.runPosition ?? null,
                    ...(settlement.run === undefined
                      ? {}
                      : {
                          runId: settlement.run.id,
                          runAt: DateTime.toDateUtc(settlement.run.at),
                          runDecidedBy: settlement.run.decidedBy ?? null,
                          runDecidedSurface: settlement.run.surface ?? null,
                        }),
                    updatedAt: at,
                  })
                  .where(
                    and(
                      eq(transactionMoves.userId, input.userId),
                      eq(transactionMoves.teamId, input.team),
                      eq(transactionMoves.id, settlement.move),
                    ),
                  );
              }
              const ended = input.settlements.flatMap((settlement) =>
                endsMove(settlement.result) ? [String(settlement.move)] : [],
              );
              if (Array.isArrayNonEmpty(ended)) {
                yield* tx
                  .delete(transactionMoveClaims)
                  .where(anyOf(transactionMoveClaims.moveId, ended));
              }
              yield* tx
                .update(transactionPlans)
                .set({ updatedAt: at })
                .where(
                  and(
                    eq(transactionPlans.userId, input.userId),
                    eq(transactionPlans.teamId, input.team),
                  ),
                );
            }),
          )
          .pipe(Effect.mapError(persistenceFailure));
      });

      const releaseStaleRuns = Effect.fn("TransactionPlanRepository.releaseStaleRuns")(
        function* (input: { readonly before: DateTime.Utc }) {
          const released = yield* database
            .update(transactionPlans)
            .set({ runClaim: null, runClaimedAt: null })
            .where(
              and(
                isNotNull(transactionPlans.runClaim),
                lte(transactionPlans.runClaimedAt, DateTime.toDateUtc(input.before)),
              ),
            )
            .returning({ teamId: transactionPlans.teamId })
            .pipe(Effect.mapError(persistenceFailure));
          return released.length;
        },
      );

      const readClaimPlans = Effect.fn("TransactionPlanRepository.readClaimPlans")(
        function* (input: { readonly limit: number }) {
          return yield* Effect.gen(function* () {
            const rows = yield* database
              .select({ userId: transactionMoves.userId, teamId: transactionMoves.teamId })
              .from(transactionMoves)
              .where(
                and(
                  eq(transactionMoves.result, "pending"),
                  anyOf(transactionMoves.phase, ["with_league", "lost"]),
                ),
              )
              .groupBy(transactionMoves.userId, transactionMoves.teamId)
              .orderBy(asc(transactionMoves.teamId), asc(transactionMoves.userId))
              .limit(input.limit);
            return yield* Effect.forEach(rows, (row) =>
              Effect.all({
                userId: Schema.decodeEffect(UserId)(row.userId),
                team: Schema.decodeEffect(TeamId)(row.teamId),
              }),
            );
          }).pipe(Effect.mapError(persistenceFailure));
        },
      );

      const readClaimMovesForPlans = Effect.fn("TransactionPlanRepository.readClaimMovesForPlans")(
        function* (input: { readonly plans: ReadonlyArray<TransactionPlanRef> }) {
          return yield* Effect.gen(function* () {
            const scope = planScope(input.plans);
            if (scope === undefined) {
              return [];
            }
            const rows = yield* database
              .select()
              .from(transactionMoves)
              .where(
                and(
                  scope,
                  eq(transactionMoves.result, "pending"),
                  anyOf(transactionMoves.phase, ["with_league", "lost"]),
                ),
              )
              .orderBy(
                asc(transactionMoves.userId),
                asc(transactionMoves.teamId),
                asc(transactionMoves.position),
                asc(transactionMoves.id),
              );
            return yield* Effect.forEach(rows, decodeMove);
          }).pipe(Effect.mapError(persistenceFailure));
        },
      );

      const readDuePlans = Effect.fn("TransactionPlanRepository.readDuePlans")(function* (input: {
        readonly before: StoredMoveDate;
        readonly limit: number;
      }) {
        return yield* Effect.gen(function* () {
          const rows = yield* database
            .select({ userId: transactionMoves.userId, teamId: transactionMoves.teamId })
            .from(transactionMoves)
            .where(
              and(
                openMovePredicate(transactionMoves),
                isNull(transactionMoves.result),
                anyOf(transactionMoves.decision, ["now", "confirmed"]),
                not(eq(transactionMoves.kind, "trade")),
                or(isNull(transactionMoves.runDay), lte(transactionMoves.runDay, input.before)),
              ),
            )
            .groupBy(transactionMoves.userId, transactionMoves.teamId)
            .orderBy(asc(min(transactionMoves.runDay)), asc(transactionMoves.teamId))
            .limit(input.limit);
          return yield* Effect.forEach(rows, (row) =>
            Effect.all({
              userId: Schema.decodeEffect(UserId)(row.userId),
              team: Schema.decodeEffect(TeamId)(row.teamId),
            }),
          );
        }).pipe(Effect.mapError(persistenceFailure));
      });

      const readDueMovesForPlans = Effect.fn("TransactionPlanRepository.readDueMovesForPlans")(
        function* (input: {
          readonly plans: ReadonlyArray<TransactionPlanRef>;
          readonly before: StoredMoveDate;
        }) {
          return yield* Effect.gen(function* () {
            const scope = planScope(input.plans);
            if (scope === undefined) {
              return [];
            }
            const rows = yield* database
              .select()
              .from(transactionMoves)
              .where(
                and(
                  scope,
                  openMovePredicate(transactionMoves),
                  isNull(transactionMoves.result),
                  anyOf(transactionMoves.decision, ["now", "confirmed"]),
                  not(eq(transactionMoves.kind, "trade")),
                  or(isNull(transactionMoves.runDay), lte(transactionMoves.runDay, input.before)),
                ),
              )
              .orderBy(
                asc(transactionMoves.userId),
                asc(transactionMoves.teamId),
                asc(transactionMoves.position),
                asc(transactionMoves.id),
              );
            return yield* Effect.forEach(rows, decodeMove);
          }).pipe(Effect.mapError(persistenceFailure));
        },
      );

      const readOpenMovesForPlans = Effect.fn("TransactionPlanRepository.readOpenMovesForPlans")(
        function* (input: { readonly plans: ReadonlyArray<TransactionPlanRef> }) {
          return yield* Effect.gen(function* () {
            const scope = planScope(input.plans);
            if (scope === undefined) {
              return [];
            }
            const rows = yield* database
              .select()
              .from(transactionMoves)
              .where(and(scope, openMovePredicate(transactionMoves)))
              .orderBy(
                asc(transactionMoves.userId),
                asc(transactionMoves.teamId),
                asc(transactionMoves.position),
                asc(transactionMoves.id),
              );
            return yield* Effect.forEach(rows, decodeMove);
          }).pipe(Effect.mapError(persistenceFailure));
        },
      );

      const readSteps = Effect.fn("TransactionPlanRepository.readSteps")(function* (input: {
        readonly moves: Array.NonEmptyReadonlyArray<TransactionMoveId>;
      }) {
        return yield* Effect.gen(function* () {
          const rows = yield* database
            .select()
            .from(transactionMoveSteps)
            .where(anyOf(transactionMoveSteps.moveId, input.moves))
            .orderBy(asc(transactionMoveSteps.moveId), asc(transactionMoveSteps.position));
          const steps = new Map<TransactionMoveId, Array<StoredMoveStep>>();
          for (const row of rows) {
            const id = yield* Schema.decodeEffect(TransactionMoveId)(row.moveId);
            const held = steps.get(id) ?? [];
            held.push(yield* Schema.decodeEffect(StoredMoveStepRow)(row));
            steps.set(id, held);
          }
          return steps;
        }).pipe(Effect.mapError(persistenceFailure));
      });

      const readGroupMoves = Effect.fn("TransactionPlanRepository.readGroupMoves")(
        function* (input: {
          readonly userId: UserId;
          readonly groups: Array.NonEmptyReadonlyArray<string>;
        }) {
          return yield* Effect.gen(function* () {
            const rows = yield* database
              .select()
              .from(transactionMoves)
              .where(
                and(
                  eq(transactionMoves.userId, input.userId),
                  anyOf(transactionMoves.groupId, input.groups),
                ),
              )
              .orderBy(asc(transactionMoves.position), asc(transactionMoves.id));
            return yield* withClaims(database, rows, input);
          }).pipe(Effect.mapError(persistenceFailure));
        },
      );

      const readPlanMoves = Effect.fn("TransactionPlanRepository.readPlanMoves")(function* (input: {
        readonly userId: UserId;
        readonly team: TeamId;
      }) {
        return yield* Effect.gen(function* () {
          const rows = yield* database
            .select()
            .from(transactionMoves)
            .where(
              and(
                eq(transactionMoves.userId, input.userId),
                eq(transactionMoves.teamId, input.team),
              ),
            )
            .orderBy(asc(transactionMoves.position), asc(transactionMoves.id));
          return yield* withClaims(database, rows, input);
        }).pipe(Effect.mapError(persistenceFailure));
      });

      const readOwnerMoves = Effect.fn("TransactionPlanRepository.readOwnerMoves")(
        function* (input: {
          readonly userId: UserId;
          readonly team: TeamId | undefined;
          readonly state: TransactionMoveReadState;
          readonly after: TransactionMoveCursor | undefined;
          readonly limit: TransactionMovePageLimit;
        }) {
          return yield* Effect.gen(function* () {
            const rows = yield* database
              .select({
                ...getTableColumns(transactionMoves),
                teamName: providerTeams.name,
                teamLeague: providerTeams.league,
                teamSport: providerTeams.sport,
                teamSeason: providerTeams.season,
              })
              .from(transactionMoves)
              .innerJoin(
                transactionPlans,
                and(
                  eq(transactionPlans.userId, transactionMoves.userId),
                  eq(transactionPlans.teamId, transactionMoves.teamId),
                ),
              )
              .innerJoin(
                providerTeams,
                and(
                  eq(providerTeams.id, transactionMoves.teamId),
                  eq(providerTeams.userId, transactionMoves.userId),
                ),
              )
              .where(
                and(
                  eq(transactionMoves.userId, input.userId),
                  input.team === undefined ? undefined : eq(transactionMoves.teamId, input.team),
                  readStatePredicate(input.state),
                  input.after === undefined
                    ? undefined
                    : afterCursorPredicate(input.after, input.state === "ended"),
                ),
              )
              .orderBy(
                ...(input.state === "ended"
                  ? [
                      asc(isNull(transactionMoves.runDay)),
                      desc(transactionMoves.runDay),
                      desc(transactionMoves.teamId),
                      desc(transactionMoves.position),
                      desc(transactionMoves.id),
                    ]
                  : [
                      desc(isNull(transactionMoves.runDay)),
                      asc(transactionMoves.runDay),
                      asc(transactionMoves.teamId),
                      asc(transactionMoves.position),
                      asc(transactionMoves.id),
                    ]),
              )
              .limit(input.limit);
            return yield* withClaimsAndTeams(database, rows, input);
          }).pipe(Effect.mapError(persistenceFailure));
        },
      );

      const readOpenMovesForTeams = Effect.fn("TransactionPlanRepository.readOpenMovesForTeams")(
        function* (input: { readonly userId: UserId; readonly teams: ReadonlyArray<TeamId> }) {
          return yield* Effect.gen(function* () {
            const teams = [...new Set(input.teams)];
            if (!Array.isArrayNonEmpty(teams)) {
              return [];
            }
            const rows = yield* database
              .select()
              .from(transactionMoves)
              .where(
                and(
                  eq(transactionMoves.userId, input.userId),
                  anyOf(transactionMoves.teamId, teams),
                  openMovePredicate(transactionMoves),
                ),
              )
              .orderBy(
                asc(transactionMoves.teamId),
                asc(transactionMoves.position),
                asc(transactionMoves.id),
              );
            return yield* Effect.forEach(rows, decodeMove);
          }).pipe(Effect.mapError(persistenceFailure));
        },
      );

      const readSubmittedMoves = Effect.fn("TransactionPlanRepository.readSubmittedMoves")(
        function* (input: {
          readonly userId: UserId;
          readonly teams: ReadonlyArray<TeamId>;
          readonly dates: ReadonlyArray<StoredMoveDate>;
        }) {
          return yield* Effect.gen(function* () {
            const teams = [...new Set(input.teams)];
            const dates = [...new Set(input.dates)];
            if (!Array.isArrayNonEmpty(teams)) {
              return [];
            }
            const rows = yield* database
              .select()
              .from(transactionMoves)
              .where(
                and(
                  eq(transactionMoves.userId, input.userId),
                  anyOf(transactionMoves.teamId, teams),
                  eq(transactionMoves.result, "executed"),
                  or(
                    isNull(transactionMoves.effectiveDate),
                    Array.isArrayNonEmpty(dates)
                      ? anyOf(transactionMoves.effectiveDate, dates)
                      : undefined,
                  ),
                ),
              )
              .orderBy(
                asc(transactionMoves.teamId),
                asc(transactionMoves.position),
                asc(transactionMoves.id),
              );
            return yield* Effect.forEach(rows, decodeMove);
          }).pipe(Effect.mapError(persistenceFailure));
        },
      );

      const readTeam = Effect.fn("TransactionPlanRepository.readTeam")(function* (input: {
        readonly userId: UserId;
        readonly team: TeamId;
      }) {
        return yield* Effect.gen(function* () {
          const rows = yield* database
            .select(teamColumns)
            .from(providerTeams)
            .where(and(eq(providerTeams.userId, input.userId), eq(providerTeams.id, input.team)))
            .limit(1);
          const row = rows[0];
          return row === undefined
            ? Option.none<TransactionMoveTeam>()
            : Option.some(yield* decodeTeam(row));
        }).pipe(Effect.mapError(persistenceFailure));
      });

      const countOwnerMoves = Effect.fn("TransactionPlanRepository.countOwnerMoves")(
        function* (input: { readonly userId: UserId; readonly team: TeamId | undefined }) {
          return yield* Effect.gen(function* () {
            const rows = yield* database
              .select({
                team: transactionMoves.teamId,
                decision: transactionMoves.decision,
                result: transactionMoves.result,
                phase: transactionMoves.phase,
                total: count(),
              })
              .from(transactionMoves)
              .where(
                and(
                  eq(transactionMoves.userId, input.userId),
                  input.team === undefined ? undefined : eq(transactionMoves.teamId, input.team),
                ),
              )
              .groupBy(
                transactionMoves.teamId,
                transactionMoves.decision,
                transactionMoves.result,
                transactionMoves.phase,
              )
              .orderBy(asc(transactionMoves.teamId));
            const byTeam = new Map<TeamId, MutableMoveCounts>();
            for (const row of rows) {
              if (row.decision === "discarded") {
                continue;
              }
              const team = yield* Schema.decodeEffect(TeamId)(row.team);
              const held = byTeam.get(team) ?? { open: 0, today: 0, saved: 0, ended: 0 };
              const bucket = moveCountBucket(row.decision, row.result, row.phase ?? undefined);
              held[bucket] += row.total;
              if (bucket !== "ended") {
                held.open += row.total;
              }
              byTeam.set(team, held);
            }
            return [...byTeam.entries()].map(([team, counts]) => ({ team, ...counts }));
          }).pipe(Effect.mapError(persistenceFailure));
        },
      );

      const readTeamProviderKeys = Effect.fn("TransactionPlanRepository.readTeamProviderKeys")(
        function* (input: { readonly userId: UserId; readonly team: TeamId }) {
          return yield* Effect.gen(function* () {
            const rows = yield* database
              .select({
                providerTeamKey: providerTeams.providerTeamKey,
                providerLeagueKey: providerTeams.providerLeagueKey,
                name: providerTeams.name,
              })
              .from(providerTeams)
              .where(and(eq(providerTeams.userId, input.userId), eq(providerTeams.id, input.team)))
              .limit(1);
            const row = rows[0];
            return row === undefined
              ? Option.none<{
                  readonly providerTeamKey: string;
                  readonly providerLeagueKey: string;
                  readonly name: string;
                }>()
              : Option.some(row);
          }).pipe(Effect.mapError(persistenceFailure));
        },
      );
      const countOwnerTeams = Effect.fn("TransactionPlanRepository.countOwnerTeams")(
        function* (input: { readonly userId: UserId; readonly team: TeamId | undefined }) {
          return yield* Effect.gen(function* () {
            const rows = yield* database
              .select({ total: count() })
              .from(providerTeams)
              .where(
                and(
                  eq(providerTeams.userId, input.userId),
                  input.team === undefined ? undefined : eq(providerTeams.id, input.team),
                ),
              );
            return rows[0]?.total ?? 0;
          }).pipe(Effect.mapError(persistenceFailure));
        },
      );

      return {
        loadPlan,
        appendMoves,
        editMove,
        discardMoves,
        confirmMoves,
        beginRun,
        finishRun,
        readRun,
        readRunByKey,
        claimRun,
        releaseRun,
        recordResult,
        settleMoves,
        releaseStaleRuns,
        readPlanMoves,
        readSteps,
        readGroupMoves,
        readDuePlans,
        readDueMovesForPlans,
        readOpenMovesForPlans,
        readOwnerMoves,
        readOpenMovesForTeams,
        readSubmittedMoves,
        readTeam,
        readTeamProviderKeys,
        readClaimPlans,
        readClaimMovesForPlans,
        countOwnerMoves,
        countOwnerTeams,
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

type Transaction = Parameters<Parameters<ConnectionsDatabase["Service"]["transaction"]>[0]>[0];
type MoveReader = Pick<ConnectionsDatabase["Service"], "select">;
type PersistenceError = EffectDrizzleQueryError | Schema.SchemaError;
type MoveRowWithTeam = typeof transactionMoves.$inferSelect & {
  readonly teamName: string;
  readonly teamLeague: typeof providerTeams.$inferSelect.league;
  readonly teamSport: typeof providerTeams.$inferSelect.sport;
  readonly teamSeason: number;
};

type MutableMoveCounts = {
  open: number;
  today: number;
  saved: number;
  ended: number;
};

const teamColumns = {
  id: providerTeams.id,
  name: providerTeams.name,
  league: providerTeams.league,
  sport: providerTeams.sport,
  season: providerTeams.season,
};

function ensurePlan(
  tx: Transaction,
  input: { readonly userId: UserId; readonly team: TeamId; readonly at: DateTime.Utc },
): Effect.Effect<TransactionPlanRecord, PersistenceError> {
  return Effect.gen(function* () {
    const at = DateTime.toDateUtc(input.at);
    const inserted = yield* tx
      .insert(transactionPlans)
      .values({ userId: input.userId, teamId: input.team, createdAt: at, updatedAt: at })
      .onConflictDoNothing({
        target: [transactionPlans.userId, transactionPlans.teamId],
      })
      .returning();
    const created = inserted[0];
    if (created !== undefined) {
      return yield* decodePlan(created);
    }
    const existing = yield* tx
      .select()
      .from(transactionPlans)
      .where(
        and(eq(transactionPlans.userId, input.userId), eq(transactionPlans.teamId, input.team)),
      )
      .limit(1)
      .for("update");
    const row = existing[0];
    if (row === undefined) {
      return yield* Effect.die(new Error("A plan that ignored its insert conflict was not found"));
    }
    return yield* decodePlan(row);
  });
}

function lockPlan(
  tx: Transaction,
  input: { readonly userId: UserId; readonly team: TeamId },
): Effect.Effect<boolean, EffectDrizzleQueryError> {
  return tx
    .select({ teamId: transactionPlans.teamId })
    .from(transactionPlans)
    .where(and(eq(transactionPlans.userId, input.userId), eq(transactionPlans.teamId, input.team)))
    .limit(1)
    .for("update")
    .pipe(Effect.map((rows) => rows.length > 0));
}

function withClaims(
  reader: MoveReader,
  rows: ReadonlyArray<typeof transactionMoves.$inferSelect>,
  input: {
    readonly userId: UserId;
  },
): Effect.Effect<ReadonlyArray<TransactionMoveRecord>, PersistenceError> {
  return Effect.gen(function* () {
    const byMove = yield* claimsByMove(
      reader,
      input.userId,
      rows.map((row) => row.id),
    );
    return yield* Effect.forEach(rows, (row) =>
      decodeMove(row).pipe(Effect.map((move) => ({ ...move, claims: byMove.get(move.id) ?? [] }))),
    );
  });
}

function withClaimsAndTeams(
  reader: MoveReader,
  rows: ReadonlyArray<MoveRowWithTeam>,
  input: { readonly userId: UserId },
): Effect.Effect<ReadonlyArray<TransactionMoveWithTeam>, PersistenceError> {
  return Effect.gen(function* () {
    const byMove = yield* claimsByMove(
      reader,
      input.userId,
      rows.map((row) => row.id),
    );
    return yield* Effect.forEach(rows, (row) =>
      Effect.gen(function* () {
        const move = yield* decodeMove(row);
        const team = yield* decodeTeam({
          id: row.teamId,
          name: row.teamName,
          league: row.teamLeague,
          sport: row.teamSport,
          season: row.teamSeason,
        });
        return {
          move: { ...move, claims: byMove.get(move.id) ?? [] },
          team,
        };
      }),
    );
  });
}

function claimsByMove(
  reader: MoveReader,
  userId: UserId,
  moveIds: ReadonlyArray<string>,
): Effect.Effect<ReadonlyMap<string, ReadonlyArray<StoredMoveClaim>>, EffectDrizzleQueryError> {
  return Effect.gen(function* () {
    const ids = [...new Set(moveIds)];
    if (!Array.isArrayNonEmpty(ids)) {
      return new Map<string, ReadonlyArray<StoredMoveClaim>>();
    }
    const claims = yield* reader
      .select()
      .from(transactionMoveClaims)
      .where(
        and(eq(transactionMoveClaims.userId, userId), anyOf(transactionMoveClaims.moveId, ids)),
      )
      .orderBy(asc(transactionMoveClaims.claimKind), asc(transactionMoveClaims.claimKey));
    const byMove = new Map<string, Array<StoredMoveClaim>>();
    for (const claim of claims) {
      const held = byMove.get(claim.moveId) ?? [];
      held.push({ kind: claim.claimKind, key: claim.claimKey });
      byMove.set(claim.moveId, held);
    }
    return byMove;
  });
}

function readMoveClaims(
  tx: Transaction,
  move: TransactionMoveId,
): Effect.Effect<ReadonlyArray<StoredMoveClaim>, EffectDrizzleQueryError> {
  return tx
    .select()
    .from(transactionMoveClaims)
    .where(eq(transactionMoveClaims.moveId, move))
    .orderBy(asc(transactionMoveClaims.claimKind), asc(transactionMoveClaims.claimKey))
    .pipe(
      Effect.map((claims) =>
        claims.map((claim) => ({ kind: claim.claimKind, key: claim.claimKey })),
      ),
    );
}

function moveValues(
  content: TransactionMoveContent,
  at: DateTime.Utc,
): {
  readonly groupId: string | null;
  readonly kind: TransactionMoveKind;
  readonly adds: ReadonlyArray<StoredMovePlayer>;
  readonly fallbacks: ReadonlyArray<StoredMovePlayer>;
  readonly drops: ReadonlyArray<StoredMovePlayer>;
  readonly picks: ReadonlyArray<StoredMovePick>;
  readonly slotMove: StoredMoveSlot | null;
  readonly intent: StoredMoveIntent | null;
  readonly placement: StoredMovePlacement | null;
  readonly counterpartyKey: string | null;
  readonly bid: number | null;
  readonly reason: string;
  readonly runDay: string | null;
  readonly effectiveDate: string | null;
  readonly phase: TransactionMovePhase | null;
  readonly attempts: ReadonlyArray<StoredMoveAttempt>;
  readonly decision: TransactionMoveDecision;
  readonly decidedAt: Date | null;
  readonly decidedBy: TransactionDecisionActor | null;
  readonly decidedSurface: string | null;
  readonly confirmedAt: Date | null;
  readonly confirmedBy: string | null;
  readonly validation: TransactionMoveValidationStatus;
  readonly checkedAt: Date | null;
  readonly validationReasons: ReadonlyArray<unknown>;
  readonly updatedAt: Date;
} {
  return {
    groupId: content.group ?? null,
    kind: content.kind,
    adds: content.adds,
    fallbacks: content.fallbacks,
    drops: content.drops,
    picks: content.picks,
    slotMove: content.slotMove ?? null,
    intent: content.intent ?? null,
    placement: content.placement ?? null,
    counterpartyKey: content.counterpartyKey ?? null,
    bid: content.bid ?? null,
    reason: content.reason,
    runDay: content.runDay ?? null,
    effectiveDate: content.effectiveDate ?? null,
    phase: content.phase ?? null,
    attempts: content.attempts,
    decision: content.decision,
    decidedAt: content.decidedAt === undefined ? null : DateTime.toDateUtc(content.decidedAt),
    decidedBy: content.decidedBy ?? null,
    decidedSurface: content.surface ?? null,
    confirmedAt: content.confirmedAt === undefined ? null : DateTime.toDateUtc(content.confirmedAt),
    confirmedBy: content.confirmedBy ?? null,
    validation: content.validation.status,
    checkedAt:
      content.validation.checkedAt === undefined
        ? null
        : DateTime.toDateUtc(content.validation.checkedAt),
    validationReasons: content.validation.reasons,
    updatedAt: DateTime.toDateUtc(at),
  };
}

function decodePlan(row: unknown): Effect.Effect<TransactionPlanRecord, Schema.SchemaError> {
  return Schema.decodeUnknownEffect(TransactionPlanRow)(row);
}

function decodeRun(row: unknown): Effect.Effect<TransactionRunRecord, Schema.SchemaError> {
  return Schema.decodeUnknownEffect(TransactionRunRow)(row);
}

function decodeMove(row: unknown): Effect.Effect<TransactionMoveRowRecord, Schema.SchemaError> {
  return Schema.decodeUnknownEffect(TransactionMoveRow)(row);
}

function decodeTeam(row: unknown): Effect.Effect<TransactionMoveTeam, Schema.SchemaError> {
  return Schema.decodeUnknownEffect(TransactionMoveTeam)(row);
}

function endsMove(result: TransactionMoveResult): boolean {
  return result === "executed";
}

function planScope(plans: ReadonlyArray<TransactionPlanRef>): SQL | undefined {
  const unique = new Map(plans.map((plan) => [`${plan.userId}:${plan.team}`, plan] as const));
  return [...unique.values()]
    .map((plan) =>
      and(eq(transactionMoves.userId, plan.userId), eq(transactionMoves.teamId, plan.team)),
    )
    .reduce<SQL | undefined>(
      (scope, next) => (scope === undefined ? next : or(scope, next)),
      undefined,
    );
}

function readStatePredicate(state: TransactionMoveReadState): SQL | undefined {
  const open = openMovePredicate(transactionMoves);
  switch (state) {
    case "open":
      return open;
    case "today":
      return and(
        open,
        or(eq(transactionMoves.decision, "undecided"), eq(transactionMoves.decision, "now")),
      );
    case "saved":
      return and(
        open,
        or(eq(transactionMoves.decision, "saved"), eq(transactionMoves.decision, "confirmed")),
      );
    case "ended":
      return and(not(open), ne(transactionMoves.decision, "discarded"));
  }
}

function moveCountBucket(
  decision: TransactionMoveDecision,
  result: TransactionMoveResult | null,
  phase: TransactionMovePhase | undefined,
): "today" | "saved" | "ended" {
  if (
    !isOpenMove({
      decision,
      ...(result === null ? {} : { result }),
      ...(phase === undefined ? {} : { phase }),
    })
  ) {
    return "ended";
  }
  return decision === "saved" || decision === "confirmed" ? "saved" : "today";
}

function afterCursorPredicate(cursor: TransactionMoveCursor, newestFirst = false): SQL | undefined {
  const withinTeam = newestFirst
    ? or(
        lt(transactionMoves.teamId, cursor.team),
        and(
          eq(transactionMoves.teamId, cursor.team),
          or(
            lt(transactionMoves.position, cursor.position),
            and(
              eq(transactionMoves.position, cursor.position),
              lt(transactionMoves.id, cursor.move),
            ),
          ),
        ),
      )
    : or(
        gt(transactionMoves.teamId, cursor.team),
        and(
          eq(transactionMoves.teamId, cursor.team),
          or(
            gt(transactionMoves.position, cursor.position),
            and(
              eq(transactionMoves.position, cursor.position),
              gt(transactionMoves.id, cursor.move),
            ),
          ),
        ),
      );
  if (newestFirst) {
    return cursor.runDay === null
      ? and(isNull(transactionMoves.runDay), withinTeam)
      : or(
          and(isNotNull(transactionMoves.runDay), lt(transactionMoves.runDay, cursor.runDay)),
          isNull(transactionMoves.runDay),
          and(eq(transactionMoves.runDay, cursor.runDay), withinTeam),
        );
  }
  return cursor.runDay === null
    ? or(and(isNull(transactionMoves.runDay), withinTeam), isNotNull(transactionMoves.runDay))
    : or(
        gt(transactionMoves.runDay, cursor.runDay),
        and(eq(transactionMoves.runDay, cursor.runDay), withinTeam),
      );
}

function persistenceFailure(cause: unknown): TransactionPlanPersistenceFailed {
  return Schema.is(TransactionPlanPersistenceFailed)(cause)
    ? cause
    : TransactionPlanPersistenceFailed.make({ cause });
}
