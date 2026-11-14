import { and, asc, eq, gt, isNull, max, not, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Array, Context, Crypto, DateTime, Effect, Layer, Option, Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { TeamId } from "#contexts/connections/FantasyTeam.ts";
import { anyOf } from "#database/dbUtilities.ts";

import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import {
  StoredMoveClaim,
  StoredMoveDate,
  StoredMoveIntent,
  StoredMovePick,
  StoredMovePlacement,
  StoredMovePlayer,
  StoredMoveSlot,
  StoredMoveValidation,
  TransactionMoveCursor,
  TransactionMoveDecision,
  TransactionMoveId,
  TransactionMoveKind,
  TransactionMovePageLimit,
  TransactionMoveProvenance,
  TransactionMoveReadState,
  TransactionMoveRecord,
  TransactionMoveResult,
  TransactionMoveValidationStatus,
  TransactionPlanPersistenceFailed,
  TransactionPlanRecord,
} from "./TransactionPlanRecord.ts";
import type { TransactionMoveRowRecord } from "./TransactionPlanRecord.ts";
import {
  TransactionMoveRow,
  TransactionPlanRow,
  openMovePredicate,
  transactionMoveClaims,
  transactionMoves,
  transactionPlans,
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
  readonly decision: TransactionMoveDecision;
  readonly decidedAt: DateTime.Utc | undefined;
  readonly validation: StoredMoveValidation;
};

export type TransactionMoveAppend = {
  readonly proposedBy: TransactionMoveProvenance;
  readonly content: TransactionMoveContent;
  readonly claims: ReadonlyArray<StoredMoveClaim>;
};

type TransactionMoveEdit = {
  readonly content: TransactionMoveContent;
  readonly claims: ReadonlyArray<StoredMoveClaim>;
};

type TransactionRunClaim =
  | { readonly status: "claimed"; readonly plan: TransactionPlanRecord }
  | { readonly status: "held"; readonly plan: TransactionPlanRecord };

export class TransactionPlanRepository extends Context.Service<TransactionPlanRepository>()(
  "@lineupkeep/backend/contexts/connections/internal/TransactionPlanRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;
      const crypto = yield* Crypto.Crypto;

      const newMoveId = crypto.randomULID.pipe(
        Effect.map((id) => Schema.decodeSync(TransactionMoveId)(id)),
        Effect.mapError(persistenceFailure),
      );

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
        const ids = yield* Effect.forEach(input.moves, (move) =>
          newMoveId.pipe(Effect.map((id) => ({ move, id }))),
        );
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

      const discardMove = Effect.fn("TransactionPlanRepository.discardMove")(function* (input: {
        readonly userId: UserId;
        readonly team: TeamId;
        readonly move: TransactionMoveId;
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
                .set({ decision: "discarded", decidedAt: at, updatedAt: at })
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
              yield* tx
                .update(transactionPlans)
                .set({ updatedAt: at })
                .where(
                  and(
                    eq(transactionPlans.userId, input.userId),
                    eq(transactionPlans.teamId, input.team),
                  ),
                );
              return Option.some({ ...(yield* decodeMove(row)), claims: [] });
            }),
          )
          .pipe(Effect.mapError(persistenceFailure));
      });

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
              .select()
              .from(transactionMoves)
              .where(
                and(
                  eq(transactionMoves.userId, input.userId),
                  input.team === undefined ? undefined : eq(transactionMoves.teamId, input.team),
                  readStatePredicate(input.state),
                  input.after === undefined ? undefined : afterCursorPredicate(input.after),
                ),
              )
              .orderBy(
                asc(transactionMoves.runDay),
                asc(transactionMoves.teamId),
                asc(transactionMoves.position),
                asc(transactionMoves.id),
              )
              .limit(input.limit);
            return yield* withClaims(database, rows, input);
          }).pipe(Effect.mapError(persistenceFailure));
        },
      );

      return {
        loadPlan,
        appendMoves,
        editMove,
        discardMove,
        claimRun,
        releaseRun,
        recordResult,
        readPlanMoves,
        readOwnerMoves,
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

type Transaction = Parameters<Parameters<ConnectionsDatabase["Service"]["transaction"]>[0]>[0];
type MoveReader = Pick<ConnectionsDatabase["Service"], "select">;
type PersistenceError = EffectDrizzleQueryError | Schema.SchemaError;

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
    const ids = rows.map((row) => row.id);
    const claims = Array.isArrayNonEmpty(ids)
      ? yield* reader
          .select()
          .from(transactionMoveClaims)
          .where(
            and(
              eq(transactionMoveClaims.userId, input.userId),
              anyOf(transactionMoveClaims.moveId, ids),
            ),
          )
          .orderBy(asc(transactionMoveClaims.claimKind), asc(transactionMoveClaims.claimKey))
      : [];
    const byMove = new Map<string, Array<StoredMoveClaim>>();
    for (const claim of claims) {
      const held = byMove.get(claim.moveId) ?? [];
      held.push({ kind: claim.claimKind, key: claim.claimKey });
      byMove.set(claim.moveId, held);
    }
    return yield* Effect.forEach(rows, (row) =>
      decodeMove(row).pipe(Effect.map((move) => ({ ...move, claims: byMove.get(move.id) ?? [] }))),
    );
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
  readonly decision: TransactionMoveDecision;
  readonly decidedAt: Date | null;
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
    decision: content.decision,
    decidedAt: content.decidedAt === undefined ? null : DateTime.toDateUtc(content.decidedAt),
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

function decodeMove(row: unknown): Effect.Effect<TransactionMoveRowRecord, Schema.SchemaError> {
  return Schema.decodeUnknownEffect(TransactionMoveRow)(row);
}

function endsMove(result: TransactionMoveResult): boolean {
  return result === "executed" || result === "withdrawn" || result === "expired";
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
      return and(open, eq(transactionMoves.decision, "saved"));
    case "ended":
      return not(open);
  }
}

function afterCursorPredicate(cursor: TransactionMoveCursor): SQL | undefined {
  const withinTeam = or(
    gt(transactionMoves.teamId, cursor.team),
    and(
      eq(transactionMoves.teamId, cursor.team),
      or(
        gt(transactionMoves.position, cursor.position),
        and(eq(transactionMoves.position, cursor.position), gt(transactionMoves.id, cursor.move)),
      ),
    ),
  );
  return cursor.runDay === null
    ? and(isNull(transactionMoves.runDay), withinTeam)
    : or(
        gt(transactionMoves.runDay, cursor.runDay),
        and(eq(transactionMoves.runDay, cursor.runDay), withinTeam),
        isNull(transactionMoves.runDay),
      );
}

function persistenceFailure(cause: unknown): TransactionPlanPersistenceFailed {
  return Schema.is(TransactionPlanPersistenceFailed)(cause)
    ? cause
    : TransactionPlanPersistenceFailed.make({ cause });
}
