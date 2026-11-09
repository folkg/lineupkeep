import { Effect, Schema, SchemaTransformation } from "effect";

import {
  Flag,
  IntFromStringOrNumber,
  NumberFromStringOrNumber,
  decodePayload,
  optionalNonEmpty,
} from "#yahoo/decode.ts";
import { Unauthorized, YahooParseError } from "#yahoo/errors.ts";
import { YahooDate, YahooGameKey } from "#yahoo/keys.ts";
import type { YahooLeagueKey } from "#yahoo/keys.ts";

import { decodeLeagueSettings } from "./league.ts";
import type { YahooLeagueSettings } from "./league.ts";

export function decodeSession(
  payload: unknown,
): Effect.Effect<void, YahooParseError | Unauthorized> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(SessionPayload, payload, "validate_session");
    if (decoded.users.length === 0) {
      return yield* new Unauthorized({
        message:
          "Yahoo did not return a signed-in user for this session. Sign in again through the hosted browser.",
        structured: false,
      });
    }
  });
}

export function decodeLeagueTeams(
  payload: unknown,
  requestedLeagueKey: YahooLeagueKey,
): Effect.Effect<ReadonlyArray<YahooLeagueTeam>, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(LeagueTeamsPayload, payload, "read_league_teams");
    if (
      decoded.league.league_key !== requestedLeagueKey ||
      decoded.league.teams.some(
        (team) => team.team_key.slice(0, team.team_key.lastIndexOf(".t.")) !== requestedLeagueKey,
      )
    ) {
      return yield* new YahooParseError({
        operation: "read_league_teams",
        field: "league.teams.team_key",
      });
    }
    return decoded.league.teams.map(teamOf);
  });
}

function teamOf(team: typeof TeamPayload.Type): YahooLeagueTeam {
  return {
    teamKey: team.team_key,
    leagueKey: team.team_key.slice(0, team.team_key.lastIndexOf(".t.")),
    name: team.name,
    url: team.url,
    isOwnedByCurrentLogin: team.is_owned_by_current_login,
    managers: (team.managers ?? []).map(({ manager }) => ({
      managerId: manager.manager_id,
      nickname: optionalNonEmpty(manager.nickname),
      isCurrentLogin: manager.is_current_login,
    })),
    teamLogos: (team.team_logos ?? []).map(({ team_logo }) => ({
      size: optionalNonEmpty(team_logo.size),
      url: team_logo.url,
    })),
    numberOfMoves: team.number_of_moves,
    rosterAdds: team.roster_adds === undefined ? undefined : acquisitionOf(team.roster_adds),
    faabBalance: team.faab_balance,
    standings:
      team.team_standings === undefined
        ? undefined
        : {
            rank: team.team_standings.rank,
            pointsFor: team.team_standings.points_for,
            pointsAgainst: team.team_standings.points_against,
            pointsBack: team.team_standings.points_back,
          },
  };
}

function acquisitionOf(acquisition: typeof AcquisitionPayload.Type): YahooAcquisitionUsage {
  return acquisition.coverage_type === "week"
    ? {
        coverage: { type: "week", week: acquisition.coverage_value },
        value: acquisition.value,
      }
    : {
        coverage: { type: "date", date: acquisition.coverage_value },
        value: acquisition.value,
      };
}

export type YahooLeagueTeam = {
  readonly teamKey: string;
  readonly leagueKey: string;
  readonly name: string;
  readonly url?: string;
  readonly isOwnedByCurrentLogin?: boolean;
  readonly managers: ReadonlyArray<YahooManager>;
  readonly teamLogos: ReadonlyArray<YahooTeamLogo>;
  readonly numberOfMoves?: number;
  readonly rosterAdds?: YahooAcquisitionUsage;
  readonly faabBalance?: number;
  readonly standings?: YahooTeamStandings;
};

export type YahooTeamStandings = {
  readonly rank?: number;
  readonly pointsFor?: number;
  readonly pointsAgainst?: number;
  readonly pointsBack?: number;
};

export type YahooDiscoveredTeam = YahooLeagueTeam & {
  readonly gameKey: YahooGameKey;
  readonly season: number;
};

export type YahooManager = {
  readonly managerId?: number;
  readonly nickname?: string;
  readonly isCurrentLogin?: boolean;
};

export type YahooTeamLogo = {
  readonly size?: string;
  readonly url: string;
};

export type YahooAcquisitionUsage = {
  readonly coverage:
    | { readonly type: "week"; readonly week: number }
    | { readonly type: "date"; readonly date: string };
  readonly value: number;
};

const Season = Schema.Union([Schema.String, Schema.Finite]).pipe(
  Schema.decodeTo(
    Schema.Int.check(Schema.isGreaterThan(1900)),
    SchemaTransformation.transform({
      decode: (value) => (typeof value === "number" ? value : Number(value)),
      encode: (value) => value,
    }),
  ),
);

const SessionPayload = Schema.Struct({
  users: Schema.Array(
    Schema.Struct({
      guid: Schema.Union([Schema.String, Schema.Finite]),
    }),
  ),
});

const AcquisitionPayload = Schema.Union([
  Schema.Struct({
    coverage_type: Schema.Literal("week"),
    coverage_value: IntFromStringOrNumber,
    value: NumberFromStringOrNumber,
  }),
  Schema.Struct({
    coverage_type: Schema.Literal("date"),
    coverage_value: YahooDate,
    value: NumberFromStringOrNumber,
  }),
]);

const TeamPayload = Schema.Struct({
  team_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u))),
  name: Schema.NonEmptyString,
  url: Schema.optional(Schema.String.pipe(Schema.check(Schema.isPattern(/^https:\/\/[^\s]+$/u)))),
  is_owned_by_current_login: Schema.optional(Flag),
  team_logos: Schema.optional(
    Schema.Array(
      Schema.Struct({
        team_logo: Schema.Struct({
          size: Schema.optional(Schema.String),
          url: Schema.String,
        }),
      }),
    ),
  ),
  managers: Schema.optional(
    Schema.Array(
      Schema.Struct({
        manager: Schema.Struct({
          manager_id: Schema.optional(IntFromStringOrNumber),
          nickname: Schema.optional(Schema.String),
          is_current_login: Schema.optional(Flag),
        }),
      }),
    ),
  ),
  number_of_moves: Schema.optional(IntFromStringOrNumber),
  roster_adds: Schema.optional(AcquisitionPayload),
  faab_balance: Schema.optional(IntFromStringOrNumber),
  team_standings: Schema.optional(
    Schema.Struct({
      rank: Schema.optional(IntFromStringOrNumber),
      points_for: Schema.optional(NumberFromStringOrNumber),
      points_against: Schema.optional(NumberFromStringOrNumber),
      points_back: Schema.optional(NumberFromStringOrNumber),
    }),
  ),
});

const LeagueTeamsPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u))),
    teams: Schema.Array(TeamPayload),
  }),
});

export function decodeDiscoveredLeagues(
  payload: unknown,
  requestedGameKeys: ReadonlyArray<YahooGameKey>,
): Effect.Effect<ReadonlyArray<YahooDiscoveredLeague>, YahooParseError | Unauthorized> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(DiscoverPayload, payload, "discover_leagues");
    if (decoded.users.length === 0) {
      return yield* new Unauthorized({
        message:
          "Yahoo did not return a signed-in user for this session. Sign in again through the hosted browser.",
        structured: false,
      });
    }
    const leagues: Array<YahooDiscoveredLeague> = [];
    for (const user of decoded.users) {
      for (const game of user.games) {
        if (!requestedGameKeys.includes(game.code)) {
          return yield* new YahooParseError({
            operation: "discover_leagues",
            field: "games.code",
          });
        }
        for (const entry of game.leagues) {
          const league = entry.league;
          const settings = yield* decodeLeagueSettings(
            { league: { ...league, season: game.season } },
            league.league_key,
          );
          leagues.push({
            leagueKey: league.league_key,
            name: league.name,
            gameKey: game.code,
            season: game.season,
            teamCount: league.num_teams,
            scoringType: optionalNonEmpty(league.scoring_type),
            scoringLabel: optionalNonEmpty(league.scoring_label),
            settings,
            tradeDraftPicks: settings.settings.canTradeDraftPicks,
            teams: league.teams.map((team) => ({
              ...teamOf(team),
              gameKey: game.code,
              season: game.season,
            })),
          });
        }
      }
    }
    return leagues;
  });
}

export type YahooDiscoveredLeague = {
  readonly leagueKey: string;
  readonly name: string;
  readonly gameKey: YahooGameKey;
  readonly season: number;
  readonly teamCount?: number;
  readonly scoringType?: string;
  readonly scoringLabel?: string;
  readonly settings: YahooLeagueSettings;
  readonly tradeDraftPicks?: boolean;
  readonly teams: ReadonlyArray<YahooDiscoveredTeam>;
};

const DiscoverLeaguePayload = Schema.Struct({
  league_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u))),
  name: Schema.NonEmptyString,
  url: Schema.String,
  num_teams: IntFromStringOrNumber,
  scoring_type: Schema.NonEmptyString,
  scoring_label: Schema.optional(Schema.String),
  settings: Schema.Unknown,
  teams: Schema.Array(TeamPayload),
});

const DiscoverGamePayload = Schema.Struct({
  code: YahooGameKey,
  season: Season,
  leagues: Schema.Array(Schema.Struct({ league: DiscoverLeaguePayload })),
});

const DiscoverPayload = Schema.Struct({
  users: Schema.Array(
    Schema.Struct({
      games: Schema.Array(DiscoverGamePayload),
    }),
  ),
});
