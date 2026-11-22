import type { AuthenticatedAgent } from "@lineupkeep/backend/auth/Auth";
import { providerSessionRefusal } from "@lineupkeep/backend/connections/Connection";
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
  GetLineupOutlookInput,
  LineupOutlookResult,
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
  Tool.make("get_lineup_outlook", {
    description:
      "Forward starter-slot fit for one team. Date leagues use days/window; weekly leagues return one week. Includes moves, sitting players with games, unknown days, opponents. No recommendations; asks to narrow large results.",
    parameters: GetLineupOutlookInput,
    success: Schema.toCodecJson(LineupOutlookResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "Get lineup outlook")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
  Tool.make("list_teams", {
    description:
      "Your linked fantasy teams, filterable by sport, season, or connection. `team` is the private id every other tool takes.",
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
      "One linked team's calendar for a published week window: current week, periods, and pro-team games for one `period`. A dated league returns week `unsupported`; use the player `schedule` group.",
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
      "One linked team's league: settings, scoring categories, roster rules, standings, and draft history. `groups` selects the sections.",
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
      "One linked team's roster for an exact league week, or all league rosters with `scope: league`. Places and reserves use league names. Pages are byte-budgeted; `limit` is a cap.",
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
      "Search one league's pool; rows are compact discovery. Use `get_players` for stats and full detail. Add `gamesWindow` for games. Pages are byte-budgeted; `limit` is a cap.",
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
      "Hydrate up to 25 player references from `search_players` or `get_rosters`. Each returns in `players` or `failures`; group `schedule` adds games. Pages are byte-budgeted; `limit` is a cap.",
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
      "Matchups for one linked team in one league week: points, projections, win probability, per-category values, and remaining player-games.",
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
      "Bounded one-team read: league, standing, record, standings, matchup, remaining games, roster, places, reserves, `canFree`, `illegal`, and `addsPossible` (open roster places, not weekly adds). `groups` selects sections.",
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
      "Bounded history for one linked team, newest first. Pending offers are `get_pending_trade_offers`; made picks are `get_league` `draft_history`.",
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
  agent: AuthenticatedAgent,
): Layer.Layer<Tool.HandlersFor<Toolkit.Tools<typeof fantasyQueryTools>>, never, FantasyQueries> {
  return fantasyQueryTools.toLayer(
    Effect.gen(function* () {
      const queries = yield* FantasyQueries;
      return fantasyQueryTools.of({
        get_lineup_outlook: (input) =>
          queries.getLineupOutlook(agent.userId, input).pipe(mapOutcome),
        list_teams: (input) => queries.listTeams(agent.userId, input).pipe(mapOutcome),
        get_calendar: (input) => queries.getCalendar(agent.userId, input).pipe(mapOutcome),
        get_league: (input) => queries.getLeague(agent.userId, input).pipe(mapOutcome),
        get_rosters: (input) => queries.getRosters(agent.userId, input).pipe(mapOutcome),
        search_players: (input) => queries.searchPlayers(agent.userId, input).pipe(mapOutcome),
        get_players: (input) => queries.getPlayers(agent.userId, input).pipe(mapOutcome),
        get_matchups: (input) => queries.getMatchups(agent.userId, input).pipe(mapOutcome),
        get_team_summary: (input) => queries.getTeamSummary(agent.userId, input).pipe(mapOutcome),
        get_transactions: (input) => queries.getTransactions(agent.userId, input).pipe(mapOutcome),
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
          return reject("connection_not_ready", providerSessionRefusal(error.status));
        case "query.cursor_invalid":
          return reject("cursor_invalid", cursorInvalidMessage(error.reason));
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

function cursorInvalidMessage(reason: "invalid" | "expired" | "mismatch"): string {
  switch (reason) {
    case "mismatch":
      return "The continuation cursor was issued for a different request. A cursor is bound to the arguments of the call that returned it, so a cursor from one `groups`, `team`, `period`, or filter selection is refused for another. Repeat the first call with the arguments you want and follow the `page.next` it returns.";
    case "expired":
      return "The continuation cursor has expired, because a cursor is valid for 15 minutes. Repeat the first call to start a new page sequence.";
    case "invalid":
      return "The continuation cursor was not issued by Lineupgrade. Copy `page.next` from the previous response and try again.";
  }
}

function reject(
  code: string,
  message: string,
): Effect.Effect<never, { code: string; message: string }, never> {
  return Effect.annotateCurrentSpan({ "app.outcome": "rejected", "error.type": code }).pipe(
    Effect.andThen(Effect.fail({ code, message })),
  );
}
