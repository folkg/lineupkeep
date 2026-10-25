import { Schema } from "effect";

export const LocalRunSchema = Schema.Struct({
  runId: Schema.String,
  stage: Schema.String,
  cwd: Schema.String,
  directory: Schema.String,
  databaseName: Schema.String,
  lockDirectory: Schema.String,
  target: Schema.Literals(["node", "cloudflare", "container"]),
  environment: Schema.Record(Schema.String, Schema.String),
});
export const LocalDestroySchema = Schema.Struct({
  remainingResources: Schema.Array(Schema.String),
});

export const LocalEndpointsSchema = Schema.Struct({
  database: Schema.String,
  application: Schema.String,
  email: Schema.String,
  traces: Schema.String,
  inspector: Schema.optional(Schema.String),
});

export type LocalRun = typeof LocalRunSchema.Type;
