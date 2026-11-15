import { Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { TeamId } from "#contexts/connections/FantasyTeam.ts";
import {
  StoredMoveDate,
  StoredMoveIntent,
  StoredMovePick,
  StoredMovePlacement,
  StoredMovePlayer,
  StoredMoveSlot,
  StoredMoveClaim,
  StoredMoveValidation,
  StoredMoveValidationReason,
  TransactionMoveCursor,
  TransactionMoveDecision,
  TransactionMoveId,
  TransactionMoveKind,
  TransactionMovePageLimit,
  TransactionMoveProvenance,
  TransactionMoveReadState,
  TransactionMoveResult,
  TransactionMoveTeam,
  TransactionMoveValidationStatus,
  TransactionPlanPersistenceFailed,
  isOpenMove,
} from "#contexts/connections/TransactionPlans.ts";

export {
  StoredMoveDate,
  StoredMoveIntent,
  StoredMovePick,
  StoredMovePlacement,
  StoredMovePlayer,
  StoredMoveSlot,
  StoredMoveClaim,
  StoredMoveValidation,
  StoredMoveValidationReason,
  TransactionMoveCursor,
  TransactionMoveDecision,
  TransactionMoveId,
  TransactionMoveKind,
  TransactionMovePageLimit,
  TransactionMoveProvenance,
  TransactionMoveReadState,
  TransactionMoveResult,
  TransactionMoveTeam,
  TransactionMoveValidationStatus,
  TransactionPlanPersistenceFailed,
  isOpenMove,
};

export const StoredMoveStepKind = Schema.Literals(["reserve_move", "slot_move", "add", "drop"]);
export type StoredMoveStepKind = typeof StoredMoveStepKind.Type;

export const StoredMoveStepOutcome = Schema.Literals([
  "executed",
  "pending",
  "failed",
  "skipped",
  "unknown",
]);
export type StoredMoveStepOutcome = typeof StoredMoveStepOutcome.Type;

export const StoredMoveStep = Schema.Struct({
  kind: StoredMoveStepKind,
  playerKey: Schema.NonEmptyString,
  fromSlot: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.optional(Schema.NonEmptyString),
  outcome: StoredMoveStepOutcome,
  detail: Schema.optional(Schema.NonEmptyString),
  decidedAt: Schema.DateTimeUtc,
});
export type StoredMoveStep = typeof StoredMoveStep.Type;

export const TransactionPlanRecord = Schema.Struct({
  userId: UserId,
  team: TeamId,
  runClaim: Schema.optional(Schema.NonEmptyString),
  runClaimedAt: Schema.optional(Schema.DateTimeUtc),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).pipe(Schema.toType);
export type TransactionPlanRecord = typeof TransactionPlanRecord.Type;

const TransactionMoveFields = {
  id: TransactionMoveId,
  userId: UserId,
  team: TeamId,
  group: Schema.optional(Schema.NonEmptyString),
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  runPosition: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  kind: TransactionMoveKind,
  adds: Schema.Array(StoredMovePlayer),
  fallbacks: Schema.Array(StoredMovePlayer),
  drops: Schema.Array(StoredMovePlayer),
  picks: Schema.Array(StoredMovePick),
  slotMove: Schema.optional(StoredMoveSlot),
  intent: Schema.optional(StoredMoveIntent),
  placement: Schema.optional(StoredMovePlacement),
  counterpartyKey: Schema.optional(Schema.NonEmptyString),
  externalRef: Schema.optional(Schema.NonEmptyString),
  bid: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  reason: Schema.NonEmptyString,
  runDay: Schema.optional(StoredMoveDate),
  effectiveDate: Schema.optional(StoredMoveDate),
  decision: TransactionMoveDecision,
  decidedAt: Schema.optional(Schema.DateTimeUtc),
  validation: StoredMoveValidation,
  result: Schema.optional(TransactionMoveResult),
  resultDetail: Schema.optional(Schema.NonEmptyString),
  resultAt: Schema.optional(Schema.DateTimeUtc),
  proposedBy: TransactionMoveProvenance,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
};

export const TransactionMoveRowRecord = Schema.Struct(TransactionMoveFields).pipe(Schema.toType);
export type TransactionMoveRowRecord = typeof TransactionMoveRowRecord.Type;

export const TransactionMoveRecord = Schema.Struct({
  ...TransactionMoveFields,
  claims: Schema.Array(
    Schema.Struct({
      kind: Schema.Literals(["player", "place", "draft_pick"]),
      key: Schema.NonEmptyString,
    }),
  ),
}).pipe(Schema.toType);
export type TransactionMoveRecord = typeof TransactionMoveRecord.Type;
