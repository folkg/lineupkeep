import { Effect, Schema } from "effect";

import { IntFromStringOrNumber, decodePayload } from "#yahoo/decode.ts";
import { YahooParseError } from "#yahoo/errors.ts";

export function decodePlayerCards(
  payload: unknown,
): Effect.Effect<ReadonlyArray<YahooPlayerCard>, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(PlayerCardsPayload, payload, "read_player_cards");
    return decoded.data.fantasyPlayerCardsView.playerCards.map((card) => ({
      playerKey: card.playerKey,
      displayName: card.player.displayName,
      shortDisplayName: optionalText(card.player.shortDisplayName),
      position: optionalText(card.player.position),
      eligiblePositions: card.player.eligiblePositions ?? [],
      teamName: optionalText(card.player.teamName),
      teamAbbr: optionalText(card.player.teamAbbr),
      headshotUrl: optionalText(card.player.headshotUrl),
      availabilityNote: optionalText(card.player.availabilityNote),
      ownerTeamKey: optionalText(card.player.ownerTeamKey),
      stats: (card.playerStats ?? []).map((stat) => ({ label: stat.label, value: stat.value })),
      availableSubViews: (card.availableSubViews ?? []).map((view) => ({
        key: view.key,
        label: view.label,
      })),
      leagueData:
        card.leagueData === undefined || card.leagueData === null
          ? undefined
          : {
              leagueKey: card.leagueData.leagueKey,
              currentScoringWeek: optionalText(card.leagueData.currentScoringWeek),
              placementStatus: optionalText(card.leagueData.placementStatus),
              ownerTeamName: optionalText(card.leagueData.ownerTeamName),
              ownerTeamKey: optionalText(card.leagueData.ownerTeamKey),
              isOnWishlist: card.leagueData.isOnWishlist,
              isUndroppable: card.leagueData.isUndroppable,
              fantasyPoints: optionalText(card.leagueData.fantasyPoints),
            },
      overview: card.overview?.content ?? undefined,
    }));
  });
}

export function decodePlayerGameLog(
  payload: unknown,
): Effect.Effect<YahooPlayerGameLog, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(PlayerGameLogPayload, payload, "read_player_game_log");
    const content = decoded.data.fantasyPlayerGameLog.content;
    if (content === null) {
      return yield* new YahooParseError({ operation: "read_player_game_log" });
    }
    return {
      headers: content.headers.map((header) => ({
        value: header.value,
        format: optionalText(header.format),
      })),
      games: content.games.map((game) => ({
        id: game.id,
        date: optionalText(game.date),
        opponentAbbr: optionalText(game.opponentAbbr),
        cells: game.cells.map((cell) => ({ value: cell.value, format: optionalText(cell.format) })),
      })),
      legend:
        content.statLegend === undefined
          ? undefined
          : {
              title: optionalText(content.statLegend.title),
              above: optionalText(content.statLegend.above?.text),
              typical: optionalText(content.statLegend.typical?.text),
              below: optionalText(content.statLegend.below?.text),
            },
    };
  });
}

export function decodePlayerSeasonStats(
  payload: unknown,
): Effect.Effect<YahooPlayerSeasonStats, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(
      PlayerSeasonStatsPayload,
      payload,
      "read_player_season_stats",
    );
    const content = decoded.data.fantasyPlayerSeasonStats.content;
    if (content === null) {
      return yield* new YahooParseError({ operation: "read_player_season_stats" });
    }
    return {
      headers: content.headers.map((header) => ({
        value: header.value,
        format: optionalText(header.format),
      })),
      rows: content.rows.map((row) => ({
        subtitle: optionalText(row.subtitle),
        cells: row.cells.map((cell) => ({ value: cell.value, format: optionalText(cell.format) })),
      })),
      seasons: (content.seasons ?? []).map((season) => ({
        title: season.title,
        headers: season.headers.map((header) => ({
          value: header.value,
          format: optionalText(header.format),
        })),
        values: season.values.map((cells) =>
          cells.map((cell) => ({ value: cell.value, format: optionalText(cell.format) })),
        ),
      })),
    };
  });
}

export function decodeGames(
  payload: unknown,
): Effect.Effect<ReadonlyArray<YahooMobileGame>, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(GamesEnvelope, payload, "read_games");
    const games: Array<YahooMobileGame> = [];
    for (const league of decoded.data.sportsGames.sportsLeagues) {
      if (!isRecord(league)) {
        continue;
      }
      for (const [key, value] of Object.entries(league)) {
        if (!key.endsWith("Games") || !Array.isArray(value)) {
          continue;
        }
        const decodedGames = yield* decodePayload(Schema.Array(GamePayload), value, "read_games");
        for (const game of decodedGames) {
          games.push({
            gameId: game.gameId,
            week: game.week,
            startTime: game.startTime,
            startDate: optionalText(game.startDate),
            status: game.status,
            displayName: game.displayName,
            isFinal: game.isFinal,
            awayTeam: teamOf(game.awayTeam),
            homeTeam: teamOf(game.homeTeam),
            venue:
              game.venue === undefined
                ? undefined
                : {
                    venueId: optionalText(game.venue.venueId),
                    name: optionalText(game.venue.displayName),
                    city: optionalText(game.venue.city),
                    state: optionalText(game.venue.state),
                  },
            weather:
              game.weather === undefined
                ? undefined
                : {
                    conditionCode: game.weather.conditionCode,
                    forecast: optionalText(game.weather.forecastText),
                    temperature: game.weather.temperature,
                    precipitationProbability: game.weather.precipitationProbability,
                    windSpeed: game.weather.windSpeed,
                  },
          });
        }
      }
    }
    return games;
  });
}

function teamOf(team: (typeof TeamPayload)["Type"]): YahooMobileTeam {
  return {
    teamId: team.teamId,
    displayName: team.displayName,
    abbreviation: team.abbreviation,
    nickname: optionalText(team.nickname),
    fullName: optionalText(team.fullName),
    record:
      team.teamRecord === undefined
        ? undefined
        : {
            wins: team.teamRecord.wins,
            losses: team.teamRecord.losses,
            ties: team.teamRecord.ties,
          },
  };
}

function optionalText(value: string | null | undefined): string | undefined {
  return value === null || value === undefined || value.trim() === "" ? undefined : value;
}

export type YahooPlayerCard = {
  readonly playerKey: string;
  readonly displayName: string;
  readonly shortDisplayName?: string;
  readonly position?: string;
  readonly eligiblePositions: ReadonlyArray<string>;
  readonly teamName?: string;
  readonly teamAbbr?: string;
  readonly headshotUrl?: string;
  readonly availabilityNote?: string;
  readonly ownerTeamKey?: string;
  readonly stats: ReadonlyArray<YahooLabeledValue>;
  readonly availableSubViews: ReadonlyArray<{ readonly key: string; readonly label: string }>;
  readonly leagueData?: YahooPlayerCardLeagueData;
  readonly overview?: unknown;
};

export type YahooPlayerCardLeagueData = {
  readonly leagueKey: string;
  readonly currentScoringWeek?: string;
  readonly placementStatus?: string;
  readonly ownerTeamName?: string;
  readonly ownerTeamKey?: string;
  readonly isOnWishlist: boolean;
  readonly isUndroppable: boolean;
  readonly fantasyPoints?: string;
};

export type YahooPlayerGameLog = {
  readonly headers: ReadonlyArray<YahooLabeledValue>;
  readonly games: ReadonlyArray<{
    readonly id: string;
    readonly date?: string;
    readonly opponentAbbr?: string;
    readonly cells: ReadonlyArray<YahooLabeledValue>;
  }>;
  readonly legend?: {
    readonly title?: string;
    readonly above?: string;
    readonly typical?: string;
    readonly below?: string;
  };
};

export type YahooPlayerSeasonStats = {
  readonly headers: ReadonlyArray<YahooLabeledValue>;
  readonly rows: ReadonlyArray<{
    readonly subtitle?: string;
    readonly cells: ReadonlyArray<YahooLabeledValue>;
  }>;
  readonly seasons: ReadonlyArray<{
    readonly title: string;
    readonly headers: ReadonlyArray<YahooLabeledValue>;
    readonly values: ReadonlyArray<ReadonlyArray<YahooLabeledValue>>;
  }>;
};

export type YahooMobileGame = {
  readonly gameId: string;
  readonly week: number;
  readonly startTime: string;
  readonly startDate?: string;
  readonly status: string;
  readonly displayName: string;
  readonly isFinal: boolean;
  readonly awayTeam: YahooMobileTeam;
  readonly homeTeam: YahooMobileTeam;
  readonly venue?: {
    readonly venueId?: string;
    readonly name?: string;
    readonly city?: string;
    readonly state?: string;
  };
  readonly weather?: {
    readonly conditionCode: number;
    readonly forecast?: string;
    readonly temperature: number;
    readonly precipitationProbability: number;
    readonly windSpeed: number;
  };
};

export type YahooMobileTeam = {
  readonly teamId: string;
  readonly displayName: string;
  readonly abbreviation: string;
  readonly nickname?: string;
  readonly fullName?: string;
  readonly record?: { readonly wins: number; readonly losses: number; readonly ties: number };
};

export type YahooLabeledValue = {
  readonly label?: string;
  readonly value: string;
  readonly format?: string;
};

const NullableString = Schema.optional(Schema.NullOr(Schema.String));

const LabeledValuePayload = Schema.Struct({
  value: Schema.String,
  format: NullableString,
});

const PlayerCardPayload = Schema.Struct({
  playerKey: Schema.String,
  player: Schema.Struct({
    displayName: Schema.String,
    shortDisplayName: NullableString,
    position: NullableString,
    eligiblePositions: Schema.optional(Schema.Array(Schema.String)),
    teamName: NullableString,
    teamAbbr: NullableString,
    headshotUrl: NullableString,
    availabilityNote: NullableString,
    ownerTeamKey: NullableString,
  }),
  playerStats: Schema.optional(
    Schema.Array(Schema.Struct({ label: Schema.String, value: Schema.String })),
  ),
  availableSubViews: Schema.optional(
    Schema.Array(Schema.Struct({ key: Schema.String, label: Schema.String })),
  ),
  leagueData: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        leagueKey: Schema.String,
        currentScoringWeek: NullableString,
        placementStatus: NullableString,
        ownerTeamName: NullableString,
        ownerTeamKey: NullableString,
        isOnWishlist: Schema.Boolean,
        isUndroppable: Schema.Boolean,
        fantasyPoints: NullableString,
      }),
    ),
  ),
  overview: Schema.optional(
    Schema.Struct({ content: Schema.optional(Schema.NullOr(Schema.Unknown)) }),
  ),
});

const PlayerCardsPayload = Schema.Struct({
  data: Schema.Struct({
    fantasyPlayerCardsView: Schema.Struct({
      playerCards: Schema.Array(PlayerCardPayload),
    }),
  }),
});

const HeaderPayload = Schema.Struct({
  value: Schema.String,
  format: NullableString,
});

const PlayerGameLogPayload = Schema.Struct({
  data: Schema.Struct({
    fantasyPlayerGameLog: Schema.Struct({
      content: Schema.NullOr(
        Schema.Struct({
          headers: Schema.Array(HeaderPayload),
          games: Schema.Array(
            Schema.Struct({
              id: Schema.String,
              cells: Schema.Array(LabeledValuePayload),
              date: NullableString,
              opponentAbbr: NullableString,
            }),
          ),
          statLegend: Schema.optional(
            Schema.Struct({
              title: NullableString,
              above: Schema.optional(Schema.Struct({ text: NullableString })),
              typical: Schema.optional(Schema.Struct({ text: NullableString })),
              below: Schema.optional(Schema.Struct({ text: NullableString })),
            }),
          ),
        }),
      ),
    }),
  }),
});

const PlayerSeasonStatsPayload = Schema.Struct({
  data: Schema.Struct({
    fantasyPlayerSeasonStats: Schema.Struct({
      content: Schema.NullOr(
        Schema.Struct({
          headers: Schema.Array(HeaderPayload),
          rows: Schema.Array(
            Schema.Struct({
              cells: Schema.Array(LabeledValuePayload),
              subtitle: NullableString,
            }),
          ),
          seasons: Schema.optional(
            Schema.Array(
              Schema.Struct({
                title: Schema.String,
                headers: Schema.Array(HeaderPayload),
                values: Schema.Array(Schema.Array(LabeledValuePayload)),
              }),
            ),
          ),
        }),
      ),
    }),
  }),
});

const GamesEnvelope = Schema.Struct({
  data: Schema.Struct({
    sportsGames: Schema.Struct({
      sportsLeagues: Schema.Array(Schema.Unknown),
    }),
  }),
});

const TeamPayload = Schema.Struct({
  teamId: Schema.String,
  displayName: Schema.String,
  abbreviation: Schema.String,
  nickname: NullableString,
  fullName: NullableString,
  teamRecord: Schema.optional(
    Schema.Struct({
      wins: IntFromStringOrNumber,
      losses: IntFromStringOrNumber,
      ties: IntFromStringOrNumber,
    }),
  ),
});

const GamePayload = Schema.Struct({
  gameId: Schema.String,
  week: IntFromStringOrNumber,
  startTime: Schema.String,
  startDate: NullableString,
  displayName: Schema.String,
  status: Schema.String,
  isFinal: Schema.Boolean,
  awayTeam: TeamPayload,
  homeTeam: TeamPayload,
  venue: Schema.optional(
    Schema.Struct({
      venueId: NullableString,
      displayName: NullableString,
      city: NullableString,
      state: NullableString,
    }),
  ),
  weather: Schema.optional(
    Schema.Struct({
      conditionCode: IntFromStringOrNumber,
      forecastText: NullableString,
      temperature: IntFromStringOrNumber,
      precipitationProbability: IntFromStringOrNumber,
      windSpeed: IntFromStringOrNumber,
    }),
  ),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
