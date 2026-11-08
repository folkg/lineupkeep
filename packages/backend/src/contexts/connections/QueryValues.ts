import { Schema } from "effect";

import { ConnectionId, ProviderKey } from "./Connection.ts";
import {
  FantasyLeague,
  FantasySport,
  TeamAutomation,
  TeamAvailability,
  TeamId,
} from "./FantasyTeam.ts";

export const queryCursorTtlMillis = 15 * 60 * 1000;
const queryPageMaximumLimit = 50;

export const LeagueFormat = Schema.Literals([
  "head_to_head_categories",
  "head_to_head_points",
  "rotisserie",
  "unknown",
]);
export type LeagueFormat = typeof LeagueFormat.Type;

export const QueryPeriod = Schema.Struct({
  week: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(99)),
});
export type QueryPeriod = typeof QueryPeriod.Type;

const StatPeriodWeek = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(99),
);

const StatPeriodDate = Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)));

export const StatPeriodPreset = Schema.Literals(["last_7_days", "last_14_days", "last_30_days"]);
export type StatPeriodPreset = typeof StatPeriodPreset.Type;

export const StatPeriod = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("season"),
  }).pipe(
    Schema.annotate({
      description: "Season-to-date totals; the default when `period` is omitted.",
    }),
  ),
  Schema.Struct({
    kind: Schema.optional(Schema.Literal("week")),
    week: StatPeriodWeek,
  }).pipe(
    Schema.annotate({
      description:
        "One scoring week. `{week}` alone is the short form. Served only for a completed week in a sport with a weekly series.",
    }),
  ),
  Schema.Struct({
    kind: Schema.Literal("preset"),
    preset: StatPeriodPreset,
  }).pipe(
    Schema.annotate({
      description:
        "A fixed recent window ending on the current fantasy day: `last_7_days`, `last_14_days`, or `last_30_days`.",
    }),
  ),
  Schema.Struct({
    kind: Schema.Literal("range"),
    start: StatPeriodDate,
    end: StatPeriodDate,
  }).pipe(
    Schema.annotate({
      description:
        "An inclusive calendar range. The site bounds its length and reports the cap in `periodSupport`.",
    }),
  ),
]);
export type StatPeriod = typeof StatPeriod.Type;

export type StatPeriodKind = "season" | "week" | "preset" | "range";

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

export const TradeOfferRef = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(2_048)),
  Schema.brand("TradeOfferRef"),
);
export type TradeOfferRef = typeof TradeOfferRef.Type;

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
  size: Schema.optional(
    Schema.Int.check(Schema.isGreaterThan(0)).pipe(
      Schema.annotate({
        description: "The page's row bound: the effective `limit`.",
      }),
    ),
  ),
  total: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
      Schema.annotate({
        description: "Rows in the paged resource before paging, where the read knows it.",
      }),
    ),
  ),
});
export type QueryPage = typeof QueryPage.Type;

export const QueryStatus = Schema.Literals(["ok", "unsupported", "failed"]);
export type QueryStatus = typeof QueryStatus.Type;

export const QueryTeam = Schema.Struct({
  id: TeamId,
  name: Schema.NonEmptyString,
  provider: ProviderKey,
  league: FantasyLeague,
  sport: FantasySport,
  season: Schema.Int.check(Schema.isGreaterThan(1900)),
});
export type QueryTeam = typeof QueryTeam.Type;

export const TeamListRow = Schema.Struct({
  team: TeamId,
  connection: ConnectionId,
  provider: ProviderKey,
  league: FantasyLeague,
  sport: FantasySport,
  season: Schema.Int.check(Schema.isGreaterThan(1900)),
  name: Schema.NonEmptyString,
  availability: TeamAvailability,
  automation: TeamAutomation,
  lastSeenAt: Schema.DateTimeUtc,
});
export type TeamListRow = typeof TeamListRow.Type;

export const RosterSlot = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("verified"),
    slot: Schema.NonEmptyString,
  }),
  Schema.Struct({
    status: Schema.Literal("unverified"),
    rawValue: Schema.String,
    reason: Schema.NonEmptyString,
  }),
]).pipe(
  Schema.annotate({
    description:
      "Where the player sits. `verified` establishes position eligibility; `unverified` keeps the raw value and reason and is never moved.",
  }),
);
export type RosterSlot = typeof RosterSlot.Type;

export const StartingStatus = Schema.Literals([
  "confirmed_starting",
  "confirmed_not_starting",
  "unconfirmed",
  "not_requested",
]).pipe(
  Schema.annotate({
    description:
      "A goalie or pitcher's real-world starting status; `unconfirmed` when the site published none.",
  }),
);
export type StartingStatus = typeof StartingStatus.Type;

export const NarrowingResult = Schema.Struct({
  status: Schema.Literal("narrowing_required"),
  resource: Schema.NonEmptyString,
  record: Schema.optional(Schema.String),
  groups: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  detail: Schema.String,
  budget: QueryBudget,
});
export type NarrowingResult = typeof NarrowingResult.Type;

export const TeamOwnerNote = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("provided"),
    text: Schema.NonEmptyString,
    updatedAt: Schema.optional(Schema.DateTimeUtc),
  }),
  Schema.Struct({ status: Schema.Literal("not_set") }),
]).pipe(
  Schema.annotate({
    description:
      "The team owner's note in Lineupgrade: owner context, not a league fact, and never a place for credentials.",
  }),
);
export type TeamOwnerNote = typeof TeamOwnerNote.Type;

export const Cursor = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(2_048)),
  Schema.annotate({
    description:
      "A `page.next` token, bound to the issuing call's arguments and valid for 15 minutes.",
  }),
);
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
export type QueryCursorInvalidReason = typeof QueryCursorInvalid.fields.reason.Type;

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
