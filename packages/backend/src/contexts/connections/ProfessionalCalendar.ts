import { Context, Schema } from "effect";
import type { DateTime, Effect } from "effect";

import { FantasyLeague } from "./FantasyTeam.ts";
import type { GameSourceFailure, GameSourceKey } from "./GameSource.ts";
import { GameSourceFailureSchema } from "./GameSource.ts";
import type { ProfessionalGame, ProfessionalGameFreshness } from "./ProfessionalGame.ts";
import type { QueryPersistenceFailed } from "./QueryValues.ts";

export type ProfessionalGameFact = {
  readonly game: ProfessionalGame;
  readonly source: GameSourceKey;
  readonly sourceReference: string;
  readonly observedAt: DateTime.Utc;
};

export type UnresolvedProfessionalTeam = {
  readonly game: string;
  readonly side: "home" | "away";
  readonly identifier: string;
  readonly name: string;
};

export type ProfessionalGameWeek = {
  readonly league: FantasyLeague;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly source: GameSourceKey;
  readonly observedAt: DateTime.Utc;
  readonly games: ReadonlyArray<ProfessionalGameFact>;
  readonly unresolvedTeams: ReadonlyArray<UnresolvedProfessionalTeam>;
};

type ProfessionalGameWindow = {
  readonly league: FantasyLeague;
  readonly from: string;
  readonly to: string;
  readonly source: GameSourceKey;
  readonly teamCount: number;
  readonly observedAt: DateTime.Utc;
  readonly games: ReadonlyArray<ProfessionalGameFact>;
  readonly unresolvedTeams: ReadonlyArray<UnresolvedProfessionalTeam>;
};

export class ProfessionalCalendarUnavailable extends Schema.TaggedError<
  ProfessionalCalendarUnavailable,
  { readonly brand: unique symbol }
>()("professional_calendar.unavailable", {
  league: FantasyLeague,
  reason: Schema.Literals(["no_source", "invalid_week", "invalid_window"]),
}) {}

export class ProfessionalGameFactStale extends Schema.TaggedError<
  ProfessionalGameFactStale,
  { readonly brand: unique symbol }
>()("professional_calendar.fact_stale", {
  weekStart: Schema.NonEmptyString,
  previousObservedAt: Schema.optional(Schema.DateTimeUtc),
  cause: GameSourceFailureSchema,
}) {}

export class ProfessionalCalendar extends Context.Service<
  ProfessionalCalendar,
  ProfessionalCalendarShape
>()("@lineupkeep/backend/contexts/connections/ProfessionalCalendar") {}

export type ProfessionalCalendarShape = {
  readonly readLeagueWeek: (input: {
    readonly league: FantasyLeague;
    readonly weekStart: string;
    readonly freshness: ProfessionalGameFreshness;
    readonly notBefore?: DateTime.Utc;
  }) => Effect.Effect<
    ProfessionalGameWeek,
    | ProfessionalCalendarUnavailable
    | ProfessionalGameFactStale
    | GameSourceFailure
    | QueryPersistenceFailed
  >;

  readonly readGames: (input: {
    readonly league: FantasyLeague;
    readonly from: string;
    readonly to: string;
    readonly freshness: ProfessionalGameFreshness;
    readonly notBefore?: DateTime.Utc;
  }) => Effect.Effect<
    ProfessionalGameWindow,
    | ProfessionalCalendarUnavailable
    | ProfessionalGameFactStale
    | GameSourceFailure
    | QueryPersistenceFailed
  >;
};
