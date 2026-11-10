import { Effect, Schema } from "effect";

import {
  Flag,
  IntFromStringOrNumber,
  decodePayload,
  isReadonlyArray,
  optionalNonEmpty,
} from "#yahoo/decode.ts";
import { YahooCoverageMismatch, YahooParseError } from "#yahoo/errors.ts";
import { YahooDate, leagueKeyOfTeam, sameCoverage } from "#yahoo/keys.ts";
import type { YahooCoverage, YahooLeagueKey, YahooTeamKey } from "#yahoo/keys.ts";

import type { YahooTransactionCounts } from "./player.ts";
import { GamesPlayedDetailPayload, gamesPlayedOf } from "./team.ts";
import type { YahooGamesPlayed } from "./team.ts";

export function decodeRoster(
  payload: unknown,
  requestedTeamKey: YahooTeamKey,
  requestedCoverage: YahooCoverage | undefined,
): Effect.Effect<YahooRoster, YahooParseError | YahooCoverageMismatch> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(TeamRosterPayload, payload, "read_roster");
    if (decoded.team.team_key !== requestedTeamKey) {
      return yield* new YahooParseError({
        operation: "read_roster",
        field: "team.team_key",
      });
    }
    const rows = rosterRows(decoded.team.roster);
    if (rows.players.length === 0) {
      return yield* new YahooParseError({ operation: "read_roster" });
    }
    const coverage = yield* coverageOf(rows.declared, rows.players, "read_roster");
    if (requestedCoverage !== undefined && !sameCoverage(requestedCoverage, coverage)) {
      return yield* new YahooCoverageMismatch({
        operation: "read_roster",
        requested: requestedCoverage,
        covered: coverage,
      });
    }
    return {
      teamKey: decoded.team.team_key,
      leagueKey: decoded.team.team_key.slice(0, decoded.team.team_key.lastIndexOf(".t.")),
      coverage,
      editable: rows.declared?.is_editable,
      players: rows.players.map(rosterPlayerOf),
    };
  });
}

function rosterRows(
  roster: (typeof TeamRosterPayload.Type)["team"]["roster"],
): RosterRows<typeof RosterPlayerPayload.Type> {
  if (isReadonlyArray(roster)) {
    return {
      declared: undefined,
      players: roster.flatMap((entry) => entry.players),
    };
  }
  const entries = "entries" in roster ? roster.entries : [roster];
  return {
    declared: roster,
    players: entries.flatMap((entry) => entry.players),
  };
}

function leagueRosterRows(roster: LeagueRoster): RosterRows<typeof LeagueRosterPlayerPayload.Type> {
  if (isReadonlyArray(roster)) {
    return {
      declared: undefined,
      players: roster.flatMap((entry) => entry.players),
    };
  }
  const entries = "entries" in roster ? roster.entries : [roster];
  return {
    declared: roster,
    players: entries.flatMap((entry) => entry.players),
  };
}

function coverageOf(
  declared: RosterCoverageMetadata | undefined,
  players: ReadonlyArray<{ readonly selected_position: SelectedPositionType }>,
  operation: "read_roster" | "read_league_rosters",
): Effect.Effect<YahooCoverage, YahooParseError> {
  return Effect.gen(function* () {
    const coverageTypes = new Set(players.map((player) => player.selected_position.coverage_type));
    if (coverageTypes.size !== 1) {
      return yield* new YahooParseError({
        operation,
        field: "players.selected_position",
      });
    }
    const coverageType = [...coverageTypes][0];
    if (coverageType === "week") {
      const weeks = new Set(
        players.flatMap((player) =>
          player.selected_position.week === undefined ? [] : [player.selected_position.week],
        ),
      );
      const week = singleNumber(weeks) ?? declared?.week;
      if (weeks.size > 1 || week === undefined) {
        return yield* new YahooParseError({
          operation,
          field: "players.selected_position.week",
        });
      }
      if (declared?.week !== undefined && declared.week !== week) {
        return yield* new YahooParseError({
          operation,
          field: "roster.week",
        });
      }
      return { type: "week", week };
    }
    if (coverageType === "date") {
      const dates = new Set(
        players.flatMap((player) =>
          player.selected_position.date === undefined ? [] : [player.selected_position.date],
        ),
      );
      const date = singleText(dates) ?? declared?.date;
      if (dates.size > 1 || date === undefined) {
        return yield* new YahooParseError({
          operation,
          field: "players.selected_position.date",
        });
      }
      if (declared?.date !== undefined && declared.date !== date) {
        return yield* new YahooParseError({
          operation,
          field: "roster.date",
        });
      }
      return { type: "date", date };
    }
    return yield* new YahooParseError({
      operation,
      field: "players.selected_position.coverage_type",
    });
  });
}

function singleNumber(values: ReadonlySet<number>): number | undefined {
  return values.size === 1 ? [...values][0] : undefined;
}

function singleText(values: ReadonlySet<string>): string | undefined {
  return values.size === 1 ? [...values][0] : undefined;
}

function rosterPlayerOf(player: typeof LeagueRosterPlayerPayload.Type): YahooRosterPlayer {
  return {
    playerKey: player.player_key,
    name: player.name.full,
    displayPosition: player.display_position,
    primaryPosition: player.primary_position,
    positionType: optionalNonEmpty(player.position_type),
    proTeamAbbreviation: optionalNonEmpty(player.editorial_team_abbr),
    proTeamKey: optionalNonEmpty(player.editorial_team_key),
    eligiblePositions: (player.eligible_positions ?? []).map(({ position }) => position),
    selectedPosition: selectedPositionOf(player.selected_position),
    editable: player.is_editable,
    statusCode: optionalNonEmpty(player.status),
    statusDetail: optionalNonEmpty(player.injury_note) ?? optionalNonEmpty(player.status_full),
    byeWeek: player.bye_weeks?.week,
    opponent: player.opponent,
    startingStatus: startingStatusOf(player.starting_status),
    undroppable: player.is_undroppable,
    transactions: transactionCountsOf(player.transactions),
  };
}

function selectedPositionOf(position: typeof SelectedPosition.Type): YahooSelectedPosition {
  const coverage =
    position.coverage_type === "week" && position.week !== undefined
      ? { type: "week" as const, week: position.week }
      : position.coverage_type === "date" && position.date !== undefined
        ? { type: "date" as const, date: position.date }
        : undefined;
  return {
    coverage,
    position: position.position,
    isFlex: position.is_flex,
  };
}

function startingStatusOf(
  status: ReadonlyArray<typeof StartingStatus.Type> | undefined,
): YahooStartingStatus | undefined {
  if (status === undefined) {
    return undefined;
  }
  const starting = status.find((entry) => entry.is_starting === 0 || entry.is_starting === 1);
  if (starting === undefined) {
    return undefined;
  }
  const coverageEntry = status.find(
    (entry) =>
      entry.coverage_type !== undefined || entry.week !== undefined || entry.date !== undefined,
  );
  const coverage =
    coverageEntry?.coverage_type === "week" && coverageEntry.week !== undefined
      ? { type: "week" as const, week: coverageEntry.week }
      : coverageEntry?.coverage_type === "date" && coverageEntry.date !== undefined
        ? { type: "date" as const, date: coverageEntry.date }
        : undefined;
  return { coverage, starting: starting.is_starting === 1 };
}

function transactionCountsOf(
  value: typeof PlayerTransactions.Type | undefined,
): YahooTransactionCounts | undefined {
  if (value === undefined) {
    return undefined;
  }
  const counts = isReadonlyArray(value) ? value[0] : value;
  return counts;
}

export type YahooRoster = {
  readonly teamKey: string;
  readonly leagueKey: string;
  readonly coverage: YahooCoverage;
  readonly editable?: boolean;
  readonly players: ReadonlyArray<YahooRosterPlayer>;
};

export type YahooLeagueRoster = YahooRoster & {
  readonly name: string;
  readonly pendingTransactions?: ReadonlyArray<YahooPendingTransaction>;
  readonly gamesPlayed?: ReadonlyArray<YahooGamesPlayed>;
};

export type YahooLeagueRosters = {
  readonly leagueKey: string;
  readonly coverage: YahooCoverage;
  readonly teams: ReadonlyArray<YahooLeagueRosterTeam>;
};

export type YahooLeagueRosterTeam = {
  readonly teamKey: string;
  readonly name: string;
  readonly players: ReadonlyArray<YahooRosterPlayer>;
};

export type YahooPendingTransaction = {
  readonly transactionKey?: string;
  readonly type: string;
  readonly status?: string;
};

export type YahooRosterPlayer = {
  readonly playerKey: string;
  readonly name: string;
  readonly displayPosition: string;
  readonly primaryPosition: string;
  readonly positionType?: string;
  readonly proTeamAbbreviation?: string;
  readonly proTeamKey?: string;
  readonly eligiblePositions: ReadonlyArray<string>;
  readonly selectedPosition: YahooSelectedPosition;
  readonly editable?: boolean;
  readonly statusCode?: string;
  readonly statusDetail?: string;
  readonly byeWeek?: number;
  readonly opponent?: string | null;
  readonly startingStatus?: YahooStartingStatus;
  readonly undroppable?: boolean;
  readonly transactions?: YahooTransactionCounts;
};

export type YahooSelectedPosition = {
  readonly coverage?: YahooCoverage;
  readonly position: string;
  readonly isFlex?: boolean;
};

export type YahooStartingStatus = {
  readonly coverage?: YahooCoverage;
  readonly starting: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pendingTransactionsOf(value: unknown): ReadonlyArray<YahooPendingTransaction> | undefined {
  if (value === undefined) {
    return undefined;
  }
  const entries = isReadonlyArray(value) ? value : [];
  return entries.flatMap((entry) => {
    const nested = isRecord(entry) && "transaction" in entry ? entry["transaction"] : entry;
    const transaction = isReadonlyArray(nested) ? nested[0] : nested;
    if (!isRecord(transaction)) {
      return [];
    }
    const type = transaction["type"];
    if (typeof type !== "string") {
      return [];
    }
    const key = transaction["transaction_key"];
    const status = transaction["status"];
    return [
      {
        ...(typeof key === "string" ? { transactionKey: key } : {}),
        type,
        ...(typeof status === "string" ? { status } : {}),
      },
    ];
  });
}

type SelectedPositionType = typeof SelectedPosition.Type;

type RosterCoverageMetadata = {
  readonly coverage_type?: string;
  readonly week?: number;
  readonly date?: string;
  readonly is_editable?: boolean;
};

type RosterRows<Player> = {
  readonly declared: RosterCoverageMetadata | undefined;
  readonly players: ReadonlyArray<Player>;
};

type LeagueRoster =
  | ReadonlyArray<typeof LeagueRosterEntry.Type>
  | (RosterCoverageMetadata & { readonly entries: ReadonlyArray<typeof LeagueRosterEntry.Type> })
  | typeof LeagueRosterEntry.Type;

const SelectedPosition = Schema.Struct({
  coverage_type: Schema.NonEmptyString,
  week: Schema.optional(IntFromStringOrNumber),
  date: Schema.optional(YahooDate),
  position: Schema.Union([Schema.NonEmptyString, Schema.Literal("")]),
  is_flex: Schema.optional(Flag),
});

const StartingStatus = Schema.Struct({
  coverage_type: Schema.optional(Schema.String),
  date: Schema.optional(Schema.String),
  week: Schema.optional(IntFromStringOrNumber),
  is_starting: Schema.optional(IntFromStringOrNumber),
});

const PlayerTransactions = Schema.Union([
  Schema.Struct({
    adds: Schema.optional(IntFromStringOrNumber),
    drops: Schema.optional(IntFromStringOrNumber),
    trades: Schema.optional(IntFromStringOrNumber),
    total: Schema.optional(IntFromStringOrNumber),
  }),
  Schema.Array(
    Schema.Struct({
      adds: Schema.optional(IntFromStringOrNumber),
      drops: Schema.optional(IntFromStringOrNumber),
      trades: Schema.optional(IntFromStringOrNumber),
      total: Schema.optional(IntFromStringOrNumber),
    }),
  ),
]);

const RosterPlayerFields = Schema.Struct({
  player_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.p\.[0-9]+$/u))),
  name: Schema.Struct({ full: Schema.NonEmptyString }),
  display_position: Schema.NonEmptyString,
  primary_position: Schema.NonEmptyString,
  position_type: Schema.optional(Schema.String),
  eligible_positions: Schema.optional(Schema.Array(Schema.Struct({ position: Schema.String }))),
  editorial_team_abbr: Schema.optional(Schema.String),
  editorial_team_key: Schema.optional(Schema.String),
  selected_position: SelectedPosition,
  is_editable: Schema.optional(Flag),
  status: Schema.optional(Schema.String),
  status_full: Schema.optional(Schema.String),
  injury_note: Schema.optional(Schema.String),
  bye_weeks: Schema.optional(Schema.Struct({ week: IntFromStringOrNumber })),
  is_undroppable: Schema.optional(Flag),
});

const RosterPlayerPayload = Schema.Struct({
  ...RosterPlayerFields.fields,
  opponent: Schema.NullOr(Schema.String),
  starting_status: Schema.optional(Schema.Array(StartingStatus)),
  transactions: Schema.optional(PlayerTransactions),
});

const LeagueRosterPlayerPayload = Schema.Struct({
  ...RosterPlayerFields.fields,
  opponent: Schema.optional(Schema.NullOr(Schema.String)),
  starting_status: Schema.optional(Schema.Array(StartingStatus)),
  transactions: Schema.optional(PlayerTransactions),
});

const RosterCoverage = Schema.Struct({
  coverage_type: Schema.optional(Schema.NonEmptyString),
  week: Schema.optional(IntFromStringOrNumber),
  date: Schema.optional(YahooDate),
  is_editable: Schema.optional(Flag),
});

const RosterEntry = Schema.Struct({
  ...RosterCoverage.fields,
  players: Schema.Array(RosterPlayerPayload),
});

const LeagueRosterEntry = Schema.Struct({
  ...RosterCoverage.fields,
  players: Schema.Array(LeagueRosterPlayerPayload),
});

const TeamRosterPayload = Schema.Struct({
  team: Schema.Struct({
    team_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u))),
    roster: Schema.Union([
      Schema.Array(RosterEntry),
      Schema.Struct({
        ...RosterCoverage.fields,
        entries: Schema.Array(RosterEntry),
      }),
      RosterEntry,
    ]),
  }),
});

export function decodeLeagueRosters(
  payload: unknown,
  requestedLeagueKey: YahooLeagueKey,
): Effect.Effect<YahooLeagueRosters, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(LeagueRostersPayload, payload, "read_league_rosters");
    if (decoded.league.league_key !== requestedLeagueKey) {
      return yield* new YahooParseError({
        operation: "read_league_rosters",
        field: "league.league_key",
      });
    }
    const teamKeys = new Set<YahooTeamKey>();
    const teams: Array<YahooLeagueRosterTeam> = [];
    let coverage: YahooCoverage | undefined;
    for (const team of decoded.league.teams) {
      if (teamKeys.has(team.team_key) || leagueKeyOfTeam(team.team_key) !== requestedLeagueKey) {
        return yield* new YahooParseError({
          operation: "read_league_rosters",
          field: "league.teams.team_key",
        });
      }
      teamKeys.add(team.team_key);
      const rows = leagueRosterRows(team.roster);
      if (rows.players.length === 0) {
        return yield* new YahooParseError({
          operation: "read_league_rosters",
          field: `league.teams.${team.team_key}.roster.players`,
        });
      }
      const teamCoverage = yield* coverageOf(rows.declared, rows.players, "read_league_rosters");
      if (coverage !== undefined && !sameCoverage(coverage, teamCoverage)) {
        return yield* new YahooParseError({
          operation: "read_league_rosters",
          field: "league.teams.roster.coverage",
        });
      }
      coverage = teamCoverage;
      teams.push({
        teamKey: team.team_key,
        name: team.name,
        players: rows.players.map(rosterPlayerOf),
      });
    }
    if (coverage === undefined) {
      return yield* new YahooParseError({
        operation: "read_league_rosters",
        field: "league.teams",
      });
    }
    return {
      leagueKey: requestedLeagueKey,
      coverage,
      teams: teams.toSorted((left, right) =>
        left.teamKey < right.teamKey ? -1 : left.teamKey > right.teamKey ? 1 : 0,
      ),
    };
  });
}

export function decodeLeagueRostersMany(
  payload: unknown,
  requestedLeagueKeys: ReadonlyArray<YahooLeagueKey>,
): Effect.Effect<ReadonlyArray<YahooLeagueRoster>, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(AggregateRostersPayload, payload, "read_league_rosters");
    const rosters: Array<YahooLeagueRoster> = [];
    for (const user of decoded.users) {
      for (const game of user.games) {
        for (const entry of game.leagues) {
          const league = "league" in entry ? entry.league : entry;
          if (!requestedLeagueKeys.includes(league.league_key)) {
            return yield* new YahooParseError({
              operation: "read_league_rosters",
              field: "league.league_key",
            });
          }
          for (const team of league.teams) {
            const rows = leagueRosterRows(team.roster);
            if (rows.players.length === 0) {
              return yield* new YahooParseError({
                operation: "read_league_rosters",
                field: `league.teams.${team.team_key}.roster.players`,
              });
            }
            rosters.push({
              teamKey: team.team_key,
              leagueKey: league.league_key,
              name: team.name,
              coverage: yield* coverageOf(rows.declared, rows.players, "read_league_rosters"),
              editable: rows.declared?.is_editable,
              pendingTransactions: pendingTransactionsOf(team.transactions),
              gamesPlayed: gamesPlayedOf(team.games_played),
              players: rows.players.map(rosterPlayerOf),
            });
          }
        }
      }
    }
    return rosters.toSorted((left, right) =>
      left.teamKey < right.teamKey ? -1 : left.teamKey > right.teamKey ? 1 : 0,
    );
  });
}

const GamesPlayedGroupPayload = Schema.Struct({
  games_played_by_position_type: Schema.optional(GamesPlayedDetailPayload),
});

const LeagueRostersPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u))),
    teams: Schema.Array(
      Schema.Struct({
        team_key: Schema.String.pipe(
          Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u)),
        ),
        name: Schema.NonEmptyString,
        roster: Schema.Union([
          Schema.Array(LeagueRosterEntry),
          Schema.Struct({ ...RosterCoverage.fields, entries: Schema.Array(LeagueRosterEntry) }),
          LeagueRosterEntry,
        ]),
      }),
    ),
  }),
});

const AggregateLeagueRostersPayload = Schema.Struct({
  league_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u))),
  name: Schema.NonEmptyString,
  teams: Schema.Array(
    Schema.Struct({
      team_key: Schema.String.pipe(
        Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u)),
      ),
      name: Schema.NonEmptyString,
      transactions: Schema.optional(
        Schema.Union([Schema.Array(Schema.Unknown), Schema.Struct({})]),
      ),
      games_played: Schema.optional(
        Schema.Union([GamesPlayedGroupPayload, Schema.Array(GamesPlayedGroupPayload)]),
      ),
      roster: Schema.Union([
        Schema.Array(LeagueRosterEntry),
        Schema.Struct({ ...RosterCoverage.fields, entries: Schema.Array(LeagueRosterEntry) }),
        LeagueRosterEntry,
      ]),
    }),
  ),
});

const AggregateLeagueEntry = Schema.Union([
  Schema.Struct({ league: AggregateLeagueRostersPayload }),
  AggregateLeagueRostersPayload,
]);

const AggregateRostersPayload = Schema.Struct({
  users: Schema.Array(
    Schema.Struct({
      games: Schema.Array(
        Schema.Struct({
          leagues: Schema.Array(AggregateLeagueEntry),
        }),
      ),
    }),
  ),
});
