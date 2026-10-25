import { Schema } from "effect";

const CpuSummarySchema = Schema.Struct({
  busyMs: Schema.Number,
  idleMs: Schema.Number,
  unattributedMs: Schema.Number,
  functions: Schema.Array(
    Schema.Struct({
      function: Schema.String,
      location: Schema.String,
      selfMs: Schema.Number,
      percentOfBusy: Schema.Number,
    }),
  ),
});

const SpanGroupSchema = Schema.Struct({
  name: Schema.String,
  calls: Schema.Number,
  totalMs: Schema.Number,
  maxMs: Schema.Number,
});

const SpanSummarySchema = Schema.Struct({
  operations: Schema.Array(SpanGroupSchema),
  sql: Schema.Struct({
    statements: Schema.Number,
    totalMs: Schema.Number,
    slowest: Schema.Array(SpanGroupSchema),
  }),
  logs: Schema.Array(
    Schema.Struct({
      atMs: Schema.Number,
      level: Schema.String,
      message: Schema.String,
      span: Schema.String,
    }),
  ),
  errors: Schema.Array(Schema.Struct({ span: Schema.String, error: Schema.String })),
});

const ServerSummarySchema = Schema.Struct({
  ...SpanSummarySchema.fields,
  unresolvedRequests: Schema.Array(Schema.String),
  tracesAttachment: Schema.optional(Schema.String),
});

const PlanGroupSchema = Schema.Struct({
  query: Schema.String,
  plan: Schema.String,
  executions: Schema.Number,
  totalMs: Schema.Number,
  maxRows: Schema.Number,
  sequentialScans: Schema.Array(Schema.String),
});

const DatabaseSummarySchema = Schema.Struct({
  totals: Schema.Struct({
    statements: Schema.Number,
    distinct: Schema.Number,
    totalMs: Schema.Number,
  }),
  statements: Schema.Array(
    Schema.Struct({
      query: Schema.String,
      calls: Schema.Number,
      totalMs: Schema.Number,
      meanMs: Schema.Number,
      rows: Schema.Number,
      sharedBlocksHit: Schema.Number,
      sharedBlocksRead: Schema.Number,
    }),
  ),
  plans: Schema.Array(PlanGroupSchema),
  plansAttachment: Schema.optional(Schema.String),
  statementsAttachment: Schema.optional(Schema.String),
});

const Unavailable = Schema.Struct({ kind: Schema.Literal("unavailable"), reason: Schema.String });
export const Cpu = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("captured"), value: CpuSummarySchema }),
  Unavailable,
]);
const Activity = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("captured"), value: ServerSummarySchema }),
  Unavailable,
]);
const Database = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("captured"), value: DatabaseSummarySchema }),
  Unavailable,
]);

const ObservedCallSchema = Schema.Struct({
  surface: Schema.Literals(["mcp", "services"]),
  description: Schema.String,
  traceId: Schema.String,
  spanId: Schema.String,
  durationMs: Schema.Number,
  outcome: Schema.Literals(["completed", "failed"]),
});

const MeasurementSchema = Schema.Struct({
  name: Schema.String,
  sample: Schema.Number,
  outcome: Schema.Literals(["completed", "failed"]),
  conditions: Schema.Array(Schema.String),
  durationMs: Schema.Number,
  budgetMs: Schema.optional(Schema.Number),
  requests: Schema.Array(Schema.String),
  calls: Schema.optional(Schema.Array(ObservedCallSchema)),
  serverActivity: Activity,
  databaseActivity: Database,
});

const ProfileResultSchema = Schema.Struct({
  ...MeasurementSchema.fields,
  browserCpu: Cpu,
  serverCpu: Cpu,
});

export const MeasurementJson = Schema.fromJsonString(MeasurementSchema);
export const ProfileJson = Schema.fromJsonString(ProfileResultSchema);

export type ObservedCall = typeof ObservedCallSchema.Type;
export type CpuSummary = typeof CpuSummarySchema.Type;
export type SpanGroup = typeof SpanGroupSchema.Type;
export type SpanSummary = typeof SpanSummarySchema.Type;
export type ServerSummary = typeof ServerSummarySchema.Type;
export type PlanGroup = typeof PlanGroupSchema.Type;
export type DatabaseSummary = typeof DatabaseSummarySchema.Type;
export type Measurement = typeof MeasurementSchema.Type;
export type ProfileResult = typeof ProfileResultSchema.Type;
