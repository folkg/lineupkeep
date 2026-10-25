import { Schema } from "effect";

import { ConnectionId, Provider } from "./Connection.ts";
import {
  FantasyLeague,
  FantasySport,
  TeamAutomation,
  TeamAvailability,
  TeamId,
} from "./FantasyTeam.ts";

export const queryCursorTtlMillis = 15 * 60 * 1000;
const queryPageMaximumLimit = 50;

export const QueryPeriod = Schema.Struct({
  week: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(99)),
});
export type QueryPeriod = typeof QueryPeriod.Type;

export const PlayerRef = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(2_048)),
  Schema.brand("PlayerRef"),
);
export type PlayerRef = typeof PlayerRef.Type;

export const CounterpartyRef = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(2_048)),
  Schema.brand("CounterpartyRef"),
);
export type CounterpartyRef = typeof CounterpartyRef.Type;

export const StatRef = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  Schema.brand("StatRef"),
);
export type StatRef = typeof StatRef.Type;

export const QueryCoverage = Schema.Struct({
  resource: Schema.NonEmptyString,
  status: Schema.Literals(["available", "unsupported", "degraded"]),
  source: Schema.NonEmptyString,
  fetchedAt: Schema.DateTimeUtc,
  period: Schema.optional(QueryPeriod),
  detail: Schema.optional(Schema.String),
});
export type QueryCoverage = typeof QueryCoverage.Type;

export const QueryFailure = Schema.Struct({
  code: Schema.NonEmptyString,
  resource: Schema.NonEmptyString,
  message: Schema.String,
});
export type QueryFailure = typeof QueryFailure.Type;

export const QueryBudget = Schema.Struct({
  targetBytes: Schema.Int.check(Schema.isGreaterThan(0)),
  hardLimitBytes: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type QueryBudget = typeof QueryBudget.Type;

export const QueryPage = Schema.Struct({
  returned: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  complete: Schema.Boolean,
  remaining: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  next: Schema.optional(Schema.String),
});
export type QueryPage = typeof QueryPage.Type;

export const QueryStatus = Schema.Literals(["ok", "unsupported", "failed"]);
export type QueryStatus = typeof QueryStatus.Type;

export const QueryTeam = Schema.Struct({
  id: TeamId,
  name: Schema.NonEmptyString,
  provider: Provider,
  league: FantasyLeague,
  sport: FantasySport,
  season: Schema.Int.check(Schema.isGreaterThan(1900)),
});
export type QueryTeam = typeof QueryTeam.Type;

export const TeamListRow = Schema.Struct({
  team: TeamId,
  connection: ConnectionId,
  provider: Provider,
  league: FantasyLeague,
  sport: FantasySport,
  season: Schema.Int.check(Schema.isGreaterThan(1900)),
  name: Schema.NonEmptyString,
  availability: TeamAvailability,
  automation: TeamAutomation,
  lastSeenAt: Schema.DateTimeUtc,
});
export type TeamListRow = typeof TeamListRow.Type;

export const NarrowingResult = Schema.Struct({
  status: Schema.Literal("narrowing_required"),
  resource: Schema.NonEmptyString,
  record: Schema.optional(Schema.String),
  groups: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  detail: Schema.String,
  budget: QueryBudget,
});
export type NarrowingResult = typeof NarrowingResult.Type;

export const Cursor = Schema.String.pipe(Schema.check(Schema.isMaxLength(2_048)));
export const PageLimit = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(queryPageMaximumLimit),
);

export type QueryError =
  | QueryTeamNotFound
  | QueryConnectionNotReady
  | QueryCursorInvalid
  | QueryReferenceInvalid
  | QuerySelectionInvalid
  | QueryPersistenceFailed;

export class QueryTeamNotFound extends Schema.TaggedError<
  QueryTeamNotFound,
  { readonly brand: unique symbol }
>()("query.team_not_found", {
  team: TeamId,
}) {}

export class QueryConnectionNotReady extends Schema.TaggedError<
  QueryConnectionNotReady,
  { readonly brand: unique symbol }
>()("query.connection_not_ready", {
  team: TeamId,
  status: Schema.Literals(["linking", "ready", "reconnect-required", "disconnected", "missing"]),
}) {}

export class QueryCursorInvalid extends Schema.TaggedError<
  QueryCursorInvalid,
  { readonly brand: unique symbol }
>()("query.cursor_invalid", {
  reason: Schema.Literals(["invalid", "expired", "mismatch"]),
}) {}

export class QueryReferenceInvalid extends Schema.TaggedError<
  QueryReferenceInvalid,
  { readonly brand: unique symbol }
>()("query.reference_invalid", {
  reason: Schema.Literals(["invalid", "owner_mismatch", "league_mismatch"]),
}) {}

export class QuerySelectionInvalid extends Schema.TaggedError<
  QuerySelectionInvalid,
  { readonly brand: unique symbol }
>()("query.selection_invalid", {
  detail: Schema.String,
}) {}

export class QueryPersistenceFailed extends Schema.TaggedError<
  QueryPersistenceFailed,
  { readonly brand: unique symbol }
>()("query.persistence_failed", {
  cause: Schema.Defect(),
}) {}
