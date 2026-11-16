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

const StatWindowDays = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(365),
);
const StatWindowWeeks = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(52),
);

export const StatWindow = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("season"),
  }).pipe(
    Schema.annotate({
      description: "Season totals",
    }),
  ),
  Schema.Struct({
    kind: Schema.optional(Schema.Literal("week")),
    week: StatPeriodWeek,
  }).pipe(
    Schema.annotate({
      description: "One scoring week; `{week}` is the short form.",
    }),
  ),
  Schema.Struct({
    kind: Schema.Literal("last_days"),
    days: StatWindowDays,
  }).pipe(
    Schema.annotate({
      description: "The last N days",
    }),
  ),
  Schema.Struct({
    kind: Schema.Literal("last_weeks"),
    weeks: StatWindowWeeks,
  }).pipe(
    Schema.annotate({
      description: "The last N weeks",
    }),
  ),
  Schema.Struct({
    kind: Schema.Literal("range"),
    start: StatPeriodDate,
    end: StatPeriodDate,
  }).pipe(
    Schema.annotate({
      description: "An inclusive date range; the maximum is in `periodSupport`.",
    }),
  ),
]);
export type StatWindow = typeof StatWindow.Type;

export const RecentFormWindow = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("last_days"),
    days: StatWindowDays,
  }),
  Schema.Struct({
    kind: Schema.Literal("last_weeks"),
    weeks: StatWindowWeeks,
  }),
]);
export type RecentFormWindow = typeof RecentFormWindow.Type;

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
        description: "The effective `limit`.",
      }),
    ),
  ),
  total: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
      Schema.annotate({
        description: "Rows before paging; absent when unknown.",
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
      "The player's slot; `verified` establishes eligibility, `unverified` keeps the raw value and reason.",
  }),
);
export type RosterSlot = typeof RosterSlot.Type;

export const RosterPlaces = Schema.Struct({
  used: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.annotate({ description: "Starting and bench places in use." }),
  ),
  maximum: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.annotate({
      description: "The league's whole-roster maximum. Reserve places are outside it.",
    }),
  ),
  free: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.annotate({
      description: "The places left under the maximum. Zero means no place is free.",
    }),
  ),
}).pipe(
  Schema.annotate({
    description:
      "Starting and bench place accounting. Reserve places do not count against the maximum, so a full active roster can still leave a reserve place free.",
  }),
);
export type RosterPlaces = typeof RosterPlaces.Type;

export const ReserveEligibility = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("published_positions"),
    positions: Schema.Array(Schema.NonEmptyString).pipe(
      Schema.annotate({
        description: "The positions the league lets this list hold; empty means any position.",
      }),
    ),
  }),
  Schema.Struct({ kind: Schema.Literal("injury_status") }).pipe(
    Schema.annotate({ description: "Only a player the league reports as injured." }),
  ),
  Schema.Struct({
    kind: Schema.Literal("not_published"),
    detail: Schema.NonEmptyString,
  }).pipe(Schema.annotate({ description: "The league does not say who this list accepts." })),
]).pipe(Schema.annotate({ description: "Who a reserve list accepts." }));
export type ReserveEligibility = typeof ReserveEligibility.Type;

export const WaiverBid = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("published"),
    balance: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }).pipe(
    Schema.annotate({
      description:
        "The league takes a FAAB bid and publishes this team's remaining balance; a waiver claim names a bid from 0 to the balance.",
    }),
  ),
  Schema.Struct({ kind: Schema.Literal("bidless") }).pipe(
    Schema.annotate({
      description:
        "The league takes no FAAB bid, so a waiver claim names no bid and a bid is refused.",
    }),
  ),
]);
export type WaiverBid = typeof WaiverBid.Type;

export const ReserveList = Schema.Struct({
  name: Schema.NonEmptyString.pipe(
    Schema.annotate({ description: "The league's own name for this list." }),
  ),
  eligibility: ReserveEligibility,
  capacity: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.annotate({ description: "How many players this list holds." }),
  ),
  occupied: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.annotate({ description: "How many players are on this list now." }),
  ),
  free: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
    Schema.annotate({ description: "How many places this list has left." }),
  ),
}).pipe(
  Schema.annotate({
    description:
      "One reserve list the league publishes, with its own capacity, occupancy, and free places. A league or sport with no reserve lists publishes none.",
  }),
);
export type ReserveList = typeof ReserveList.Type;

export const RosterFreeablePlace = Schema.Struct({
  player: PlayerRef,
  name: Schema.NonEmptyString,
  list: Schema.NonEmptyString.pipe(
    Schema.annotate({ description: "The reserve list the league accepts this player on." }),
  ),
  place: Schema.NonEmptyString.pipe(
    Schema.annotate({ description: "The active place this move frees." }),
  ),
}).pipe(
  Schema.annotate({
    description:
      "One player who can move to a reserve list right now, with the list and the active place it frees.",
  }),
);
export type RosterFreeablePlace = typeof RosterFreeablePlace.Type;

export const RosterBlocker = Schema.Struct({
  player: PlayerRef,
  name: Schema.NonEmptyString,
  slot: Schema.NonEmptyString.pipe(
    Schema.annotate({ description: "The place this player holds." }),
  ),
  fact: Schema.NonEmptyString.pipe(
    Schema.annotate({ description: "Why this player makes the roster illegal." }),
  ),
  cure: Schema.NonEmptyString.pipe(
    Schema.annotate({
      description: "The plain cure, including the drop that clears this player.",
    }),
  ),
}).pipe(
  Schema.annotate({
    description:
      "One player whose place the league does not accept. Adds and drops stay blocked until every blocker is cured.",
  }),
);
export type RosterBlocker = typeof RosterBlocker.Type;

export const StartingStatus = Schema.Literals([
  "confirmed_starting",
  "confirmed_not_starting",
  "unconfirmed",
  "not_requested",
]).pipe(
  Schema.annotate({
    description:
      "A goalie or pitcher's real-world starting status; `unconfirmed` when unpublished.",
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
      "The team owner's note in Lineupgrade: owner context, not a league fact, never credentials.",
  }),
);
export type TeamOwnerNote = typeof TeamOwnerNote.Type;

export const Cursor = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(2_048)),
  Schema.annotate({
    description: "A `page.next` token, bound to the call's arguments, valid 15 minutes.",
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
