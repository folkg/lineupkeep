import { Context, Schema } from "effect";
import type { DateTime, Effect } from "effect";

import type { FantasyLeague, FantasySport } from "./FantasyTeam.ts";
import type { ProfessionalGameStatus } from "./ProfessionalGame.ts";

export const GameSourceKey = Schema.Literals(["nhl-web"]);
export type GameSourceKey = typeof GameSourceKey.Type;

type GameSourceCoverage = {
  readonly league: FantasyLeague;
  readonly sport: FantasySport;
  readonly teamCount: number;
};

type GameSourceCapabilities = {
  readonly coverage: ReadonlyArray<GameSourceCoverage>;
  readonly weekDays: number;
  readonly publishesStartTime: boolean;
  readonly publishesVenueTimeZone: boolean;
  readonly publishesStatus: boolean;
  readonly maximumResponseBytes: number;
};

export type GameSourceTeam = {
  readonly identifier: string;
  readonly abbreviation: string;
  readonly name: string;
};

export type GameSourceGame = {
  readonly id: string;
  readonly date: string;
  readonly startTime: {
    readonly instant: DateTime.Utc;
    readonly timeZone: string;
  } | null;
  readonly venue: string | null;
  readonly status: ProfessionalGameStatus;
  readonly home: GameSourceTeam;
  readonly away: GameSourceTeam;
};

export type GameSourceLeagueWeek = {
  readonly league: FantasyLeague;
  readonly weekStart: string;
  readonly weekEnd: string;
  readonly games: ReadonlyArray<GameSourceGame>;
};

export class GameSourceRequestFailed extends Schema.TaggedError<
  GameSourceRequestFailed,
  { readonly brand: unique symbol }
>()("game_source.request_failed", {
  source: GameSourceKey,
  status: Schema.optional(Schema.Int),
  detail: Schema.optional(Schema.String),
}) {}

export class GameSourceResponseInvalid extends Schema.TaggedError<
  GameSourceResponseInvalid,
  { readonly brand: unique symbol }
>()("game_source.response_invalid", {
  source: GameSourceKey,
  field: Schema.optional(Schema.NonEmptyString),
}) {}

export const GameSourceFailureSchema = Schema.Union([
  GameSourceRequestFailed,
  GameSourceResponseInvalid,
]);
export type GameSourceFailure = typeof GameSourceFailureSchema.Type;

export type GameSourceShape = {
  readonly key: GameSourceKey;
  readonly capabilities: GameSourceCapabilities;
  readonly readLeagueWeek: (input: {
    readonly league: FantasyLeague;
    readonly weekStart: string;
  }) => Effect.Effect<GameSourceLeagueWeek, GameSourceFailure>;
};

export class GameSourceRegistry extends Context.Service<
  GameSourceRegistry,
  GameSourceRegistryShape
>()("@lineupkeep/backend/contexts/connections/GameSource/GameSourceRegistry") {}

export type GameSourceRegistryShape = {
  readonly sourceFor: (
    league: FantasyLeague,
  ) => { readonly source: GameSourceShape; readonly coverage: GameSourceCoverage } | undefined;
};

export function gameSourceRegistryOf(
  sources: ReadonlyArray<GameSourceShape>,
): GameSourceRegistryShape {
  return {
    sourceFor: (league) => {
      for (const source of sources) {
        const coverage = source.capabilities.coverage.find((entry) => entry.league === league);
        if (coverage !== undefined) {
          return { source, coverage };
        }
      }
      return undefined;
    },
  };
}
