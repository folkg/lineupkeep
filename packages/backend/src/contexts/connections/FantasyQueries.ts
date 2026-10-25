import { Context } from "effect";
import type { Effect } from "effect";

import type { UserId } from "#contexts/auth/User.ts";

import type {
  CalendarResult,
  GetCalendarInput,
  GetLeagueInput,
  GetMatchupsInput,
  GetPlayersInput,
  GetRostersInput,
  GetTransactionsInput,
  LeagueResult,
  ListTeamsInput,
  ListTeamsResult,
  MatchupsResult,
  PlayersResult,
  RosterResult,
  SearchPlayersInput,
  SearchPlayersResult,
  TransactionsResult,
} from "./QueryResults.ts";
import type { QueryError } from "./QueryValues.ts";

export class FantasyQueries extends Context.Service<FantasyQueries, FantasyQueriesShape>()(
  "@lineupkeep/backend/contexts/connections/FantasyQueries",
) {}

export type FantasyQueriesShape = {
  readonly listTeams: (
    userId: UserId,
    input: ListTeamsInput,
  ) => Effect.Effect<ListTeamsResult, QueryError>;

  readonly getCalendar: (
    userId: UserId,
    input: GetCalendarInput,
  ) => Effect.Effect<CalendarResult, QueryError>;

  readonly getLeague: (
    userId: UserId,
    input: GetLeagueInput,
  ) => Effect.Effect<LeagueResult, QueryError>;

  readonly getRosters: (
    userId: UserId,
    input: GetRostersInput,
  ) => Effect.Effect<RosterResult, QueryError>;

  readonly searchPlayers: (
    userId: UserId,
    input: SearchPlayersInput,
  ) => Effect.Effect<SearchPlayersResult, QueryError>;

  readonly getPlayers: (
    userId: UserId,
    input: GetPlayersInput,
  ) => Effect.Effect<PlayersResult, QueryError>;

  readonly getMatchups: (
    userId: UserId,
    input: GetMatchupsInput,
  ) => Effect.Effect<MatchupsResult, QueryError>;

  readonly getTransactions: (
    userId: UserId,
    input: GetTransactionsInput,
  ) => Effect.Effect<TransactionsResult, QueryError>;
};
