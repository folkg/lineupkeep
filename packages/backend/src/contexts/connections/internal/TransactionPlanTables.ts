import { and, isNotNull, isNull, ne, or } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { createSelectSchema } from "drizzle-orm/effect-schema";
import type { PgColumn } from "drizzle-orm/pg-core";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { Effect, Schema, SchemaParser, SchemaTransformation } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { TeamId } from "#contexts/connections/FantasyTeam.ts";

import { providerTeams } from "./ConnectionTables.ts";
import {
  StoredMoveDate,
  StoredMoveIntent,
  StoredMovePick,
  StoredMovePlacement,
  StoredMovePlayer,
  StoredMoveSlot,
  StoredMoveStep,
  StoredMoveStepKind,
  StoredMoveStepOutcome,
  StoredMoveValidationReason,
  TransactionMoveDecision,
  TransactionMoveId,
  TransactionMoveKind,
  TransactionMoveProvenance,
  TransactionMoveResult,
  TransactionMoveRowRecord,
  TransactionMoveValidationStatus,
  TransactionPlanRecord,
  TransactionPlanRunCounts,
  TransactionPlanRunRefusal,
  TransactionRunId,
  TransactionRunRecord,
  TransactionRunTrigger,
} from "./TransactionPlanRecord.ts";

export const transactionPlans = pgTable(
  "transaction_plans",
  {
    userId: text("user_id").notNull(),
    teamId: text("team_id")
      .notNull()
      .references(() => providerTeams.id, { onDelete: "cascade" }),
    runClaim: text("run_claim"),
    runClaimedAt: timestamp("run_claimed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.teamId] })],
);

export const transactionMoves = pgTable(
  "transaction_moves",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    teamId: text("team_id").notNull(),
    groupId: text("group_id"),
    position: integer("position").notNull(),
    runPosition: integer("run_position"),
    kind: text("kind", {
      enum: ["free_agent_add", "waiver_claim", "drop", "trade", "activate", "stash", "slot_move"],
    }).notNull(),
    adds: jsonb("adds").notNull(),
    fallbacks: jsonb("fallbacks").notNull(),
    drops: jsonb("drops").notNull(),
    picks: jsonb("picks").notNull(),
    slotMove: jsonb("slot_move"),
    intent: jsonb("intent"),
    placement: jsonb("placement"),
    counterpartyKey: text("counterparty_key"),
    externalRef: text("external_ref"),
    bid: integer("bid"),
    reason: text("reason").notNull(),
    runDay: text("run_day"),
    effectiveDate: text("effective_date"),
    decision: text("decision", {
      enum: ["undecided", "saved", "now", "confirmed", "discarded"],
    }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedBy: text("confirmed_by"),
    runId: text("run_id"),
    runAt: timestamp("run_at", { withTimezone: true }),
    validation: text("validation", {
      enum: ["unchecked", "current", "stale", "illegal"],
    }).notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    validationReasons: jsonb("validation_reasons").notNull(),
    result: text("result", {
      enum: ["executed", "pending", "failed", "skipped", "unknown", "withdrawn", "expired"],
    }),
    resultDetail: text("result_detail"),
    resultAt: timestamp("result_at", { withTimezone: true }),
    proposedBy: jsonb("proposed_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("transaction_moves_user_id_team_id_position_idx").on(
      table.userId,
      table.teamId,
      table.position,
    ),
    foreignKey({
      columns: [table.userId, table.teamId],
      foreignColumns: [transactionPlans.userId, transactionPlans.teamId],
    }).onDelete("cascade"),
    index("transaction_moves_timeline_idx")
      .on(table.userId, table.runDay, table.teamId, table.position)
      .where(openMovePredicate(table)),
    index("transaction_moves_due_idx")
      .on(table.runDay, table.decision)
      .where(openMovePredicate(table)),
  ],
);

export const transactionRuns = pgTable(
  "transaction_runs",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    teamId: text("team_id").notNull(),
    trigger: text("trigger", { enum: ["submit", "tick"] }).notNull(),
    key: text("key"),
    at: timestamp("at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    counts: jsonb("counts").notNull(),
    refusals: jsonb("refusals").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      columns: [table.userId, table.teamId],
      foreignColumns: [transactionPlans.userId, transactionPlans.teamId],
    }).onDelete("cascade"),
    uniqueIndex("transaction_runs_owner_key_idx")
      .on(table.userId, table.teamId, table.key)
      .where(isNotNull(table.key)),
    index("transaction_runs_team_at_idx").on(table.userId, table.teamId, table.at),
  ],
);

export const transactionMoveClaims = pgTable(
  "transaction_move_claims",
  {
    userId: text("user_id").notNull(),
    teamId: text("team_id").notNull(),
    claimKind: text("claim_kind", { enum: ["player", "place", "draft_pick"] }).notNull(),
    claimKey: text("claim_key").notNull(),
    moveId: text("move_id")
      .notNull()
      .references(() => transactionMoves.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("transaction_move_claims_owner_claim_idx").on(
      table.userId,
      table.teamId,
      table.claimKind,
      table.claimKey,
    ),
    index("transaction_move_claims_move_id_idx").on(table.moveId),
  ],
);

export const transactionMoveSteps = pgTable(
  "transaction_move_steps",
  {
    id: text("id").primaryKey(),
    moveId: text("move_id")
      .notNull()
      .references(() => transactionMoves.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: text("kind", { enum: ["reserve_move", "slot_move", "add", "drop"] }).notNull(),
    playerKey: text("player_key").notNull(),
    fromSlot: text("from_slot"),
    toSlot: text("to_slot"),
    outcome: text("outcome", {
      enum: ["executed", "pending", "failed", "skipped", "unknown"],
    }).notNull(),
    detail: text("detail"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("transaction_move_steps_move_id_position_idx").on(table.moveId, table.position),
  ],
);

const StoredMoveStepFacts = Schema.Struct({
  kind: StoredMoveStepKind,
  playerKey: Schema.NonEmptyString,
  fromSlot: Schema.NullOr(Schema.NonEmptyString),
  toSlot: Schema.NullOr(Schema.NonEmptyString),
  outcome: StoredMoveStepOutcome,
  detail: Schema.NullOr(Schema.NonEmptyString),
  decidedAt: Schema.DateTimeUtcFromDate,
});

export const StoredMoveStepRow = StoredMoveStepFacts.pipe(
  Schema.decodeTo(
    StoredMoveStep,
    SchemaTransformation.transform({
      decode: (row) => ({
        kind: row.kind,
        playerKey: row.playerKey,
        ...(row.fromSlot === null ? {} : { fromSlot: row.fromSlot }),
        ...(row.toSlot === null ? {} : { toSlot: row.toSlot }),
        outcome: row.outcome,
        ...(row.detail === null ? {} : { detail: row.detail }),
        decidedAt: row.decidedAt,
      }),
      encode: (step) => ({
        kind: step.kind,
        playerKey: step.playerKey,
        fromSlot: step.fromSlot ?? null,
        toSlot: step.toSlot ?? null,
        outcome: step.outcome,
        detail: step.detail ?? null,
        decidedAt: step.decidedAt,
      }),
    }),
  ),
);

export function openMovePredicate(table: {
  readonly decision: PgColumn;
  readonly result: PgColumn;
}): SQL {
  const predicate = and(
    ne(table.decision, "discarded"),
    or(
      isNull(table.result),
      and(ne(table.result, "executed"), ne(table.result, "withdrawn"), ne(table.result, "expired")),
    ),
  );
  if (predicate === undefined) {
    throw new Error("An open-move predicate over fixed columns is always defined");
  }
  return predicate;
}

const TransactionPlanSelect = createSelectSchema(transactionPlans, {
  userId: UserId,
  teamId: TeamId,
  runClaim: Schema.NullOr(Schema.NonEmptyString),
  runClaimedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  createdAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
});

export const TransactionPlanRow = TransactionPlanSelect.pipe(
  Schema.decodeTo(
    TransactionPlanRecord,
    SchemaTransformation.transform<TransactionPlanRecord, typeof TransactionPlanSelect.Type>({
      decode: (row) => ({
        userId: row.userId,
        team: row.teamId,
        ...(row.runClaim === null ? {} : { runClaim: row.runClaim }),
        ...(row.runClaimedAt === null ? {} : { runClaimedAt: row.runClaimedAt }),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }),
      encode: (record) => ({
        userId: record.userId,
        teamId: record.team,
        runClaim: record.runClaim ?? null,
        runClaimedAt: record.runClaimedAt ?? null,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      }),
    }),
  ),
);

const TransactionMoveSelect = createSelectSchema(transactionMoves, {
  id: TransactionMoveId,
  userId: UserId,
  teamId: TeamId,
  groupId: Schema.NullOr(Schema.NonEmptyString),
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  runPosition: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  kind: TransactionMoveKind,
  adds: Schema.Unknown,
  fallbacks: Schema.Unknown,
  drops: Schema.Unknown,
  picks: Schema.Unknown,
  slotMove: Schema.Unknown,
  intent: Schema.Unknown,
  placement: Schema.Unknown,
  counterpartyKey: Schema.NullOr(Schema.NonEmptyString),
  externalRef: Schema.NullOr(Schema.NonEmptyString),
  bid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  reason: Schema.NonEmptyString,
  runDay: Schema.NullOr(StoredMoveDate),
  effectiveDate: Schema.NullOr(StoredMoveDate),
  decision: TransactionMoveDecision,
  decidedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  confirmedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  confirmedBy: Schema.NullOr(UserId),
  runId: Schema.NullOr(TransactionRunId),
  runAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  validation: TransactionMoveValidationStatus,
  checkedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  validationReasons: Schema.Unknown,
  result: Schema.NullOr(TransactionMoveResult),
  resultDetail: Schema.NullOr(Schema.NonEmptyString),
  resultAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  proposedBy: Schema.Unknown,
  createdAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
});

export const TransactionMoveRow = TransactionMoveSelect.pipe(
  Schema.decodeTo(
    TransactionMoveRowRecord,
    SchemaTransformation.transformEffect<
      TransactionMoveRowRecord,
      typeof TransactionMoveSelect.Type
    >({
      decode: (row) =>
        Effect.gen(function* () {
          const adds = yield* SchemaParser.decodeUnknownEffect(Schema.Array(StoredMovePlayer))(
            row.adds,
          );
          const fallbacks = yield* SchemaParser.decodeUnknownEffect(Schema.Array(StoredMovePlayer))(
            row.fallbacks,
          );
          const drops = yield* SchemaParser.decodeUnknownEffect(Schema.Array(StoredMovePlayer))(
            row.drops,
          );
          const picks = yield* SchemaParser.decodeUnknownEffect(Schema.Array(StoredMovePick))(
            row.picks,
          );
          const slotMove = yield* SchemaParser.decodeUnknownEffect(Schema.NullOr(StoredMoveSlot))(
            row.slotMove,
          );
          const intent = yield* SchemaParser.decodeUnknownEffect(Schema.NullOr(StoredMoveIntent))(
            row.intent,
          );
          const placement = yield* SchemaParser.decodeUnknownEffect(
            Schema.NullOr(StoredMovePlacement),
          )(row.placement);
          const reasons = yield* SchemaParser.decodeUnknownEffect(
            Schema.Array(StoredMoveValidationReason),
          )(row.validationReasons);
          const proposedBy = yield* SchemaParser.decodeUnknownEffect(TransactionMoveProvenance)(
            row.proposedBy,
          );
          return {
            id: row.id,
            userId: row.userId,
            team: row.teamId,
            ...(row.groupId === null ? {} : { group: row.groupId }),
            position: row.position,
            ...(row.runPosition === null ? {} : { runPosition: row.runPosition }),
            kind: row.kind,
            adds,
            fallbacks,
            drops,
            picks,
            ...(slotMove === null ? {} : { slotMove }),
            ...(intent === null ? {} : { intent }),
            ...(placement === null ? {} : { placement }),
            ...(row.counterpartyKey === null ? {} : { counterpartyKey: row.counterpartyKey }),
            ...(row.externalRef === null ? {} : { externalRef: row.externalRef }),
            ...(row.bid === null ? {} : { bid: row.bid }),
            reason: row.reason,
            ...(row.runDay === null ? {} : { runDay: row.runDay }),
            ...(row.effectiveDate === null ? {} : { effectiveDate: row.effectiveDate }),
            decision: row.decision,
            ...(row.decidedAt === null ? {} : { decidedAt: row.decidedAt }),
            ...(row.confirmedAt === null ? {} : { confirmedAt: row.confirmedAt }),
            ...(row.confirmedBy === null ? {} : { confirmedBy: row.confirmedBy }),
            ...(row.runId === null ? {} : { runId: row.runId }),
            ...(row.runAt === null ? {} : { runAt: row.runAt }),
            validation: {
              status: row.validation,
              ...(row.checkedAt === null ? {} : { checkedAt: row.checkedAt }),
              reasons,
            },
            ...(row.result === null ? {} : { result: row.result }),
            ...(row.resultDetail === null ? {} : { resultDetail: row.resultDetail }),
            ...(row.resultAt === null ? {} : { resultAt: row.resultAt }),
            proposedBy,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
        }),
      encode: (record) =>
        Effect.gen(function* () {
          const adds = yield* SchemaParser.encodeEffect(Schema.Array(StoredMovePlayer))(
            record.adds,
          );
          const fallbacks = yield* SchemaParser.encodeEffect(Schema.Array(StoredMovePlayer))(
            record.fallbacks,
          );
          const drops = yield* SchemaParser.encodeEffect(Schema.Array(StoredMovePlayer))(
            record.drops,
          );
          const picks = yield* SchemaParser.encodeEffect(Schema.Array(StoredMovePick))(
            record.picks,
          );
          const reasons = yield* SchemaParser.encodeEffect(
            Schema.Array(StoredMoveValidationReason),
          )(record.validation.reasons);
          return {
            id: record.id,
            userId: record.userId,
            teamId: record.team,
            groupId: record.group ?? null,
            position: record.position,
            runPosition: record.runPosition ?? null,
            kind: record.kind,
            adds,
            fallbacks,
            drops,
            picks,
            slotMove: record.slotMove ?? null,
            intent: record.intent ?? null,
            placement: record.placement ?? null,
            counterpartyKey: record.counterpartyKey ?? null,
            externalRef: record.externalRef ?? null,
            bid: record.bid ?? null,
            reason: record.reason,
            runDay: record.runDay ?? null,
            effectiveDate: record.effectiveDate ?? null,
            decision: record.decision,
            decidedAt: record.decidedAt ?? null,
            confirmedAt: record.confirmedAt ?? null,
            confirmedBy: record.confirmedBy ?? null,
            runId: record.runId ?? null,
            runAt: record.runAt ?? null,
            validation: record.validation.status,
            checkedAt: record.validation.checkedAt ?? null,
            validationReasons: reasons,
            result: record.result ?? null,
            resultDetail: record.resultDetail ?? null,
            resultAt: record.resultAt ?? null,
            proposedBy: record.proposedBy,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          };
        }),
    }),
  ),
);

const TransactionRunSelect = createSelectSchema(transactionRuns, {
  id: TransactionRunId,
  userId: UserId,
  teamId: TeamId,
  trigger: TransactionRunTrigger,
  key: Schema.NullOr(Schema.NonEmptyString),
  at: Schema.DateTimeUtcFromDate,
  finishedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  counts: Schema.Unknown,
  refusals: Schema.Unknown,
  createdAt: Schema.DateTimeUtcFromDate,
});

export const TransactionRunRow = TransactionRunSelect.pipe(
  Schema.decodeTo(
    TransactionRunRecord,
    SchemaTransformation.transformEffect<TransactionRunRecord, typeof TransactionRunSelect.Type>({
      decode: (row) =>
        Effect.gen(function* () {
          const counts = yield* SchemaParser.decodeUnknownEffect(TransactionPlanRunCounts)(
            row.counts,
          );
          const refusals = yield* SchemaParser.decodeUnknownEffect(
            Schema.Array(TransactionPlanRunRefusal),
          )(row.refusals);
          return {
            run: row.id,
            userId: row.userId,
            team: row.teamId,
            trigger: row.trigger,
            ...(row.key === null ? {} : { key: row.key }),
            at: row.at,
            ...(row.finishedAt === null ? {} : { finishedAt: row.finishedAt }),
            counts,
            refusals,
          };
        }),
      encode: (record) =>
        Effect.gen(function* () {
          const counts = yield* SchemaParser.encodeEffect(TransactionPlanRunCounts)(record.counts);
          const refusals = yield* SchemaParser.encodeEffect(
            Schema.Array(TransactionPlanRunRefusal),
          )(record.refusals);
          return {
            id: record.run,
            userId: record.userId,
            teamId: record.team,
            trigger: record.trigger,
            key: record.key ?? null,
            at: record.at,
            finishedAt: record.finishedAt ?? null,
            counts,
            refusals,
            createdAt: record.at,
          };
        }),
    }),
  ),
);
