import type { UserId } from "@lineupkeep/backend/auth/User";
import { FantasyQueries } from "@lineupkeep/backend/connections/FantasyQueries";
import {
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
  TeamSummaryResult,
  GetTeamSummaryInput,
  TransactionsResult,
} from "@lineupkeep/backend/connections/QueryResults";
import { fantasyQueryScopes } from "@lineupkeep/backend/connections/QueryScopes";
import type { QueryError } from "@lineupkeep/backend/connections/QueryValues";
import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import { Tool, Toolkit } from "effect/ai";

import { RequiredScope } from "./toolAuthorization";

const ToolFailure = Schema.Struct({ code: Schema.String, message: Schema.String });

export const fantasyQueryTools = Toolkit.make(
  Tool.make("list_teams", {
    description:
      "List your linked fantasy teams with stable paging and optional sport, season, or connection filters. Each row carries a private team id for the other query tools, its current automation status, and the pause expiry when one is active; provider keys are never returned.",
    parameters: ListTeamsInput,
    success: Schema.toCodecJson(ListTeamsResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "List teams")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("get_calendar", {
    description:
      "Read the league calendar periods the provider currently establishes for one linked team. The current week and date window come from league settings; lock deadlines are reported as unverified rather than guessed, and historical period availability is explicit.",
    parameters: GetCalendarInput,
    success: Schema.toCodecJson(CalendarResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "Get calendar")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("get_league", {
    description:
      "Read selected league settings, scoring definitions, roster rules, and standings for one linked team. The `standings` group carries each team's rank, win-loss record where the format publishes one, season points, and per-category season totals where the provider publishes them; a format without a win-loss record says so instead of returning zeros. The response pages teams when standings are requested, otherwise scoring categories. Scoring categories use private stat references.",
    parameters: GetLeagueInput,
    success: Schema.toCodecJson(LeagueResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "Get league")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("get_rosters", {
    description:
      "Read one linked team's roster for an exact league week. Every entry carries the provider's professional-team abbreviation so schedule context needs no second lookup. The compact shape is the default; full detail adds provider-reported injury, bye, flexibility, and drop metadata. A provider that publishes no per-player games-remaining or probable-starter field says so with the reason instead of returning an empty schedule. A week the provider does not cover fails explicitly instead of being guessed.",
    parameters: GetRostersInput,
    success: Schema.toCodecJson(RosterResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "Get rosters")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("search_players", {
    description:
      "Search a bounded provider player pool for one linked team, with availability, position, and validated sort filters. Omit the query to list the pool; a blank query is rejected with the remedy. Each row reports provider percent owned with its weekly change, and percent started with its change where the league publishes it; a missing signal is null, never zero. Sort by `name`, `position`, `ownership`, the provider's `actual_rank` or `overall_rank`, or a league scoring category through `stat` (the reference comes from `get_league` scoring). Ranked and stat sorts accept a `statPeriod` of `season` (the default) or `week` where the provider accepts a weekly stat sort; an unsupported combination answers with the remedy instead of forwarding a request the provider would refuse.",
    parameters: SearchPlayersInput,
    success: Schema.toCodecJson(SearchPlayersResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "Search players")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("get_players", {
    description:
      "Hydrate a bounded selection of up to 25 private player references for one linked team. Choose identity, availability, eligibility, actual stats, or scoring context groups. Identity also resolves for players no longer on the roster, from transaction history. Actual statistics declare a week or season basis; a provider that publishes no projected player statistics reports the projections group as unsupported with the reason. Missing stats remain null rather than zero.",
    parameters: GetPlayersInput,
    success: Schema.toCodecJson(PlayersResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "Get players")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("get_matchups", {
    description:
      "Read matchups for one linked team and one explicit league week. Each side reports points, the provider projection where published, win probability, per-category values and category winners for category leagues, and remaining player-games for the week where the provider publishes them. The result's `schedule` section names the unit (`fantasy_team_player_games`) or declares remaining games unsupported with the reason: football plays one game per player per scoring week. Matchups use private counterparty references; an uncovered week is reported explicitly, and a league format without weekly matchups returns an unsupported result with the reason.",
    parameters: GetMatchupsInput,
    success: Schema.toCodecJson(MatchupsResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "Get matchups")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("get_team_summary", {
    description:
      "One bounded snapshot for one linked team: league overview, the team's standing and record, league standings, the current matchup with per-category values, this week's and next week's remaining player-games, and the current roster with professional-team abbreviations. Each section states its own coverage and degrades independently, so a failed standings read still returns the roster and matchup. A section the provider cannot supply says so with a reason: football publishes no remaining-game count, and no league publishes probable starters. Use this instead of a per-team pass over the individual tools; the roster section pages inside the same result budget, and the underlying tools remain available for detail.",
    parameters: GetTeamSummaryInput,
    success: Schema.toCodecJson(TeamSummaryResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "Get team summary")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("get_transactions", {
    description:
      "Read bounded transaction history for one linked team. `scope: team` restricts the provider read to the linked team's own moves; `league` returns the league's recent events. `since` and `until` filter by instant. The provider publishes no date filter, so those bounds apply to the bounded window it returns: `window` reports how many events were fetched, the oldest and newest timestamps, and whether the window was exhausted, and a range older than the window is reported as truncated rather than silently incomplete. This is a read-only view and never submits, retries, or reverses a transaction.",
    parameters: GetTransactionsInput,
    success: Schema.toCodecJson(TransactionsResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "Get transactions")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
);

export function fantasyQueryToolHandlers(
  userId: UserId,
): Layer.Layer<Tool.HandlersFor<Toolkit.Tools<typeof fantasyQueryTools>>, never, FantasyQueries> {
  return fantasyQueryTools.toLayer(
    Effect.gen(function* () {
      const queries = yield* FantasyQueries;
      return fantasyQueryTools.of({
        list_teams: (input) => queries.listTeams(userId, input).pipe(mapOutcome),
        get_calendar: (input) => queries.getCalendar(userId, input).pipe(mapOutcome),
        get_league: (input) => queries.getLeague(userId, input).pipe(mapOutcome),
        get_rosters: (input) => queries.getRosters(userId, input).pipe(mapOutcome),
        search_players: (input) => queries.searchPlayers(userId, input).pipe(mapOutcome),
        get_players: (input) => queries.getPlayers(userId, input).pipe(mapOutcome),
        get_matchups: (input) => queries.getMatchups(userId, input).pipe(mapOutcome),
        get_team_summary: (input) => queries.getTeamSummary(userId, input).pipe(mapOutcome),
        get_transactions: (input) => queries.getTransactions(userId, input).pipe(mapOutcome),
      });
    }),
  );
}

function mapOutcome<A>(
  program: Effect.Effect<A, QueryError>,
): Effect.Effect<A, { code: string; message: string }, never> {
  return program.pipe(
    Effect.catch((error) => {
      switch (error._tag) {
        case "query.team_not_found":
          return reject(
            "team_not_found",
            "The selected team is not available to this account. List your teams again.",
          );
        case "query.connection_not_ready":
          return reject(
            "connection_not_ready",
            "The selected team's connection is not ready. Reconnect it and list your teams again.",
          );
        case "query.cursor_invalid":
          return reject(
            "cursor_invalid",
            "The continuation cursor is invalid or expired. Start the query again.",
          );
        case "query.reference_invalid":
          return reject(
            "reference_invalid",
            "A private reference in this request is invalid for this account. Start the query again.",
          );
        case "query.selection_invalid":
          return reject("selection_invalid", error.detail);
        case "query.persistence_failed":
          return Effect.annotateCurrentSpan({
            "app.outcome": "failure",
            "error.type": error._tag,
          }).pipe(
            Effect.andThen(
              Effect.die(new Error("The query could not be completed. Start the query again.")),
            ),
          );
      }
    }),
  );
}

function reject(
  code: string,
  message: string,
): Effect.Effect<never, { code: string; message: string }, never> {
  return Effect.annotateCurrentSpan({ "app.outcome": "rejected", "error.type": code }).pipe(
    Effect.andThen(Effect.fail({ code, message })),
  );
}
