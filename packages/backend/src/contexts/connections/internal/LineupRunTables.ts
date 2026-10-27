import { createSelectSchema } from "drizzle-orm/effect-schema";
import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { Effect, Equal, Schema, SchemaParser, SchemaTransformation } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { ConnectionId } from "#contexts/connections/Connection.ts";
import { TeamId } from "#contexts/connections/FantasyTeam.ts";
import {
  LineupRequestId,
  LineupRunId,
  LineupRunStatus,
  LineupUuid,
  LineupTargetPeriod,
  LineupTrigger,
  LineupImplementation,
} from "#contexts/connections/LineupRun.ts";
import { scheduledPendingPredicate } from "#database/dbUtilities.ts";

import {
  LineupObservedPlayer,
  LineupPlan,
  LineupRunState,
  lineupRunStatus,
} from "./LineupRunWorkflow.ts";

export const lineupRequests = pgTable(
  "lineup_requests",
  {
    userId: text("user_id").notNull(),
    id: text("id").notNull(),
    intent: text("intent").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.id] })],
);

export const lineupRuns = pgTable(
  "lineup_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    requestId: text("request_id").notNull(),
    teamId: uuid("team_id").notNull(),
    connectionId: text("connection_id").notNull(),
    trigger: text("trigger", { enum: ["manual", "scheduled"] }).notNull(),
    scheduleKey: text("schedule_key"),
    target: jsonb("target").notNull(),
    status: text("status", {
      enum: [
        "queued",
        "reading",
        "planning",
        "validating",
        "applying",
        "verifying",
        "completed",
        "skipped",
        "blocked",
        "retry-wait",
        "failed",
        "uncertain",
        "superseded",
      ],
    }).notNull(),
    state: jsonb("state").notNull(),
    implementation: text("implementation", {
      enum: ["provider_native", "custom_policy"],
    }).notNull(),
    implementationVersion: text("implementation_version").notNull(),
    attempts: integer("attempts").notNull().default(0),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("lineup_runs_id_idx").on(table.id),
    index("lineup_runs_user_id_request_id_idx").on(table.userId, table.requestId),
    index("lineup_runs_user_id_team_id_created_at_idx").on(
      table.userId,
      table.teamId,
      table.createdAt,
    ),
    index("lineup_runs_user_id_created_at_idx").on(table.userId, table.createdAt),
    index("lineup_runs_status_updated_at_idx").on(table.status, table.updatedAt),
    index("lineup_runs_status_next_action_at_idx").on(table.status, table.nextActionAt),
    uniqueIndex("lineup_runs_team_schedule_key_idx").on(table.teamId, table.scheduleKey),
    uniqueIndex("lineup_runs_one_scheduled_pending_idx")
      .on(table.teamId)
      .where(scheduledPendingPredicate(table)),
  ],
);

export const lineupDeliveries = pgTable(
  "lineup_deliveries",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id").notNull(),
    requestId: text("request_id").notNull(),
    status: text("status", { enum: ["pending", "dispatching", "dispatched"] }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    runIds: jsonb("run_ids").notNull(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("lineup_deliveries_user_id_request_id_idx").on(table.userId, table.requestId),
    index("lineup_deliveries_status_created_at_idx").on(table.status, table.createdAt),
  ],
);

export const lineupTeamLeases = pgTable(
  "lineup_team_leases",
  {
    teamId: uuid("team_id").primaryKey(),
    userId: text("user_id").notNull(),
    runId: uuid("run_id").notNull(),
    token: uuid("token").notNull(),
    generation: integer("generation").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("lineup_team_leases_user_id_team_id_idx").on(table.userId, table.teamId)],
);

export const lineupRunAttempts = pgTable(
  "lineup_run_attempts",
  {
    runId: uuid("run_id").notNull(),
    attempt: integer("attempt").notNull(),
    leaseToken: uuid("lease_token").notNull(),
    leaseGeneration: integer("lease_generation").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    outcome: text("outcome"),
  },
  (table) => [primaryKey({ columns: [table.runId, table.attempt] })],
);

export const lineupRunDiagnostics = pgTable(
  "lineup_run_diagnostics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull(),
    attempt: integer("attempt").notNull(),
    userId: text("user_id").notNull(),
    teamId: uuid("team_id").notNull(),
    kind: text("kind", { enum: ["observation", "verification"] }).notNull(),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("lineup_run_diagnostics_run_id_idx").on(table.runId),
    index("lineup_run_diagnostics_expires_at_idx").on(table.expiresAt),
  ],
);

export const lineupWriteIntents = pgTable(
  "lineup_write_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull(),
    attempt: integer("attempt").notNull(),
    userId: text("user_id").notNull(),
    teamId: uuid("team_id").notNull(),
    connectionId: text("connection_id").notNull(),
    connectionGeneration: integer("connection_generation").notNull(),
    leaseToken: uuid("lease_token").notNull(),
    leaseGeneration: integer("lease_generation").notNull(),
    action: text("action", { enum: ["native_action", "explicit_assignments"] }).notNull(),
    target: jsonb("target").notNull(),
    before: jsonb("before").notNull(),
    plan: jsonb("plan"),
    status: text("status", {
      enum: [
        "intended",
        "sent",
        "accepted",
        "rejected",
        "unknown",
        "not_sent",
        "verified_changed",
        "verified_no_op",
        "verified_mismatch",
      ],
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("lineup_write_intents_run_id_attempt_idx").on(table.runId, table.attempt),
    index("lineup_write_intents_user_id_team_id_status_idx").on(
      table.userId,
      table.teamId,
      table.status,
    ),
  ],
);

const LineupRunRecordSchema = Schema.Struct({
  id: LineupRunId,
  userId: UserId,
  requestId: LineupRequestId,
  teamId: TeamId,
  connectionId: ConnectionId,
  trigger: LineupTrigger,
  scheduleKey: Schema.NullOr(Schema.String),
  target: LineupTargetPeriod,
  status: LineupRunStatus,
  state: LineupRunState,
  implementation: LineupImplementation,
  implementationVersion: Schema.NonEmptyString,
  attempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  nextActionAt: Schema.NullOr(Schema.DateTimeUtc),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).pipe(Schema.toType);
export type LineupRunRecord = typeof LineupRunRecordSchema.Type;

const LineupRunSelect = createSelectSchema(lineupRuns, {
  id: LineupRunId,
  userId: UserId,
  requestId: LineupRequestId,
  teamId: TeamId,
  connectionId: ConnectionId,
  trigger: LineupTrigger,
  scheduleKey: Schema.NullOr(Schema.String),
  target: Schema.Unknown,
  status: LineupRunStatus,
  state: Schema.Unknown,
  implementation: LineupImplementation,
  implementationVersion: Schema.NonEmptyString,
  attempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  nextActionAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  createdAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
});

export const LineupRunRow = LineupRunSelect.pipe(
  Schema.decodeTo(
    LineupRunRecordSchema,
    SchemaTransformation.transformEffect<
      typeof LineupRunRecordSchema.Type,
      typeof LineupRunSelect.Type
    >({
      decode: (row) =>
        Effect.gen(function* () {
          const state = yield* SchemaParser.decodeUnknownEffect(Schema.toCodecJson(LineupRunState))(
            row.state,
          );
          const target = yield* SchemaParser.decodeUnknownEffect(
            Schema.toCodecJson(LineupTargetPeriod),
          )(row.target);
          if (lineupRunStatus(state) !== row.status) {
            return yield* Effect.die(
              new Error("The stored lineup run status does not match its state"),
            );
          }
          if (!Equal.equals(state.target, target) || state.team !== row.teamId) {
            return yield* Effect.die(
              new Error("The stored lineup run state does not match its selection"),
            );
          }
          if (
            state.trigger !== row.trigger ||
            state.implementationVersion !== row.implementationVersion
          ) {
            return yield* Effect.die(
              new Error("The stored lineup run state does not match its implementation"),
            );
          }
          return { ...row, target, state };
        }),
      encode: (row) =>
        Effect.gen(function* () {
          const target = yield* SchemaParser.encodeEffect(Schema.toCodecJson(LineupTargetPeriod))(
            row.target,
          );
          const state = yield* SchemaParser.encodeEffect(Schema.toCodecJson(LineupRunState))(
            row.state,
          );
          return {
            ...row,
            target,
            state,
            status: lineupRunStatus(row.state),
          };
        }),
    }),
  ),
);

const LineupDeliveryRecordSchema = Schema.Struct({
  id: LineupUuid,
  userId: UserId,
  requestId: LineupRequestId,
  status: Schema.Literals(["pending", "dispatching", "dispatched"]),
  attempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  runIds: Schema.Array(LineupRunId),
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
  dispatchedAt: Schema.NullOr(Schema.DateTimeUtc),
}).pipe(Schema.toType);
export type LineupDeliveryRecord = typeof LineupDeliveryRecordSchema.Type;

const LineupDeliverySelect = createSelectSchema(lineupDeliveries, {
  id: LineupUuid,
  userId: UserId,
  requestId: LineupRequestId,
  status: Schema.Literals(["pending", "dispatching", "dispatched"]),
  attempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  runIds: Schema.Unknown,
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
  dispatchedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
});

export const LineupDeliveryRow = LineupDeliverySelect.pipe(
  Schema.decodeTo(
    LineupDeliveryRecordSchema,
    SchemaTransformation.transformEffect<
      typeof LineupDeliveryRecordSchema.Type,
      typeof LineupDeliverySelect.Type
    >({
      decode: (row) =>
        Effect.gen(function* () {
          const runIds = yield* SchemaParser.decodeUnknownEffect(Schema.Array(LineupRunId))(
            row.runIds,
          );
          return { ...row, runIds };
        }),
      encode: (row) =>
        Effect.gen(function* () {
          const runIds = yield* SchemaParser.encodeEffect(Schema.Array(LineupRunId))(row.runIds);
          return { ...row, runIds };
        }),
    }),
  ),
);

const LineupWriteIntentRecordSchema = Schema.Struct({
  id: LineupUuid,
  runId: LineupRunId,
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  userId: UserId,
  teamId: TeamId,
  connectionId: ConnectionId,
  connectionGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  leaseToken: LineupUuid,
  leaseGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  action: Schema.Literals(["native_action", "explicit_assignments"]),
  target: LineupTargetPeriod,
  before: Schema.Array(LineupObservedPlayer),
  plan: Schema.optional(LineupPlan),
  status: Schema.Literals([
    "intended",
    "sent",
    "accepted",
    "rejected",
    "unknown",
    "not_sent",
    "verified_changed",
    "verified_no_op",
    "verified_mismatch",
  ]),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).pipe(Schema.toType);
export type LineupWriteIntentRecord = typeof LineupWriteIntentRecordSchema.Type;

const LineupWriteIntentSelect = createSelectSchema(lineupWriteIntents, {
  id: LineupUuid,
  runId: LineupRunId,
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  userId: UserId,
  teamId: TeamId,
  connectionId: ConnectionId,
  connectionGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  leaseToken: LineupUuid,
  leaseGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  action: Schema.Literals(["native_action", "explicit_assignments"]),
  target: Schema.Unknown,
  before: Schema.Unknown,
  plan: Schema.NullOr(Schema.Unknown),
  status: Schema.Literals([
    "intended",
    "sent",
    "accepted",
    "rejected",
    "unknown",
    "not_sent",
    "verified_changed",
    "verified_no_op",
    "verified_mismatch",
  ]),
  createdAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
});

export const LineupWriteIntentRow = LineupWriteIntentSelect.pipe(
  Schema.decodeTo(
    LineupWriteIntentRecordSchema,
    SchemaTransformation.transformEffect<
      typeof LineupWriteIntentRecordSchema.Type,
      typeof LineupWriteIntentSelect.Type
    >({
      decode: (row) =>
        Effect.gen(function* () {
          const target = yield* SchemaParser.decodeUnknownEffect(
            Schema.toCodecJson(LineupTargetPeriod),
          )(row.target);
          const before = yield* SchemaParser.decodeUnknownEffect(
            Schema.toCodecJson(Schema.Array(LineupObservedPlayer)),
          )(row.before);
          const { plan: currentPlan, ...rest } = row;
          const plan =
            currentPlan === null
              ? undefined
              : yield* SchemaParser.decodeUnknownEffect(Schema.toCodecJson(LineupPlan))(
                  currentPlan,
                );
          return { ...rest, target, before, ...(plan === undefined ? {} : { plan }) };
        }),
      encode: (row) =>
        Effect.gen(function* () {
          const target = yield* SchemaParser.encodeEffect(Schema.toCodecJson(LineupTargetPeriod))(
            row.target,
          );
          const before = yield* SchemaParser.encodeEffect(
            Schema.toCodecJson(Schema.Array(LineupObservedPlayer)),
          )(row.before);
          const plan =
            row.plan === undefined
              ? null
              : yield* SchemaParser.encodeEffect(Schema.toCodecJson(LineupPlan))(row.plan);
          return { ...row, target, before, plan };
        }),
    }),
  ),
);
