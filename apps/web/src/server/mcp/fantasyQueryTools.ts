import type { AuthenticatedAgent } from "@lineupkeep/backend/auth/Auth";
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
      "List your linked fantasy teams with stable paging and optional sport, season, or connection filters. Each row carries the private team id the other query tools take, its automation status, and the pause expiry when one is active. Connection keys are never returned.",
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
      "Read the league calendar periods the league's site sets for one linked team. `week` states the current scoring week and week range. Pass `period` to read each professional team's games in that week into `games`, optionally narrowed by `proTeams`: each team states whether it plays, its opponents, and its game count, and `notCovered` names requested teams the linked team's roster-scoped schedule does not reach. The league's site publishes no exact lock instant, so no lock deadline is stated.",
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
      "Read one linked team's league: `week` (the current scoring week), settings, scoring categories, roster rules, standings, and draft history. `groups` selects sections and defaults to overview, scoring, and roster_rules; the overview carries `transactionRules` with the waiver, timing, acquisition limits, and trade rules. `standingsDetail: compact` (the default) returns every team's rank, points, record, and acquisitionUsage without category arrays so a 13-team league stays inside the result budget; `detailed` adds season category totals and rotisserie points and pages teams. A format without a win-loss record reports that rather than zeros, and a category the league displays without scoring it is `informational`, never scored. Every scalar rule is `published` with its value or `not_set`; `not_set` is never zero and never a guess, and a limit the league declares also publishes its remaining count where a team carries usage. `draft_history` returns completed picks with round, pick number, team, and the inline player name; it is not current or future pick ownership, and a traded pick appears on its trade transaction. Only the league's games-played cap is published; the league's site publishes no per-team games-played count. Without `standings` and `draft_history`, the response pages scoring categories; `draft_history` pages picks.",
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
      "Read one linked team's roster for an exact league week, or every roster in its league with `scope: \"league\"`. A league read uses one request for the league's current coverage, refuses an exact `period`, and states the current week or date; its pages keep whole teams, never split a roster, and `page.total` is the league's team count. Roster rows carry `proTeam`, `slot`, injury, `transactionTrend`, and, for a weekly-scored league, `week`: whether the professional team plays, its opponent, its bye week, and the projected week rank where the league's site publishes one. An unverified `slot` keeps the site's raw value and reason and is never moved by planning or a write. `transactionTrend` counts manager adds and drops for the provider's current day, with its window stated; it is not percent owned. The league-wide shape publishes no add/drop counts, so its `transactionTrend` is `not_published`, and it carries no `ownerNote`; read games with `get_team_summary`. If the league's site refuses the league roster shape, `coverage` says so and `teams` is empty. `detail: full` adds `undroppable` and `ownerNote`.",
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
      "Search a bounded player pool at the league's site for one linked team. Omit `query` to list the pool; a blank query is refused with the remedy. Filters are availability, positions, and a sort the league's site backs. Every sort carries the value that orders it (`actualRank`, `overallRank`, or `statValue` for `stat`), so the order is checkable from the rows. `statPeriod: \"week\"` is offered only where the site publishes a weekly value; otherwise it is refused with the remedy. Each row carries `proTeam` (the same abbreviation a roster entry uses), the screening `status` with its observation time, percent owned and started with their changes, `transactionTrend`, and, for a weekly-scored league, `week`: whether the professional team plays, its opponent, its bye week, and the projected week rank. `includeGames: true` adds each row's `gamesRemaining` for the current scoring window and states that window; it costs the league window and professional-calendar reads. A missing value is null or `not_published`, never zero.",
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
      'Hydrate up to 25 private player references in one response. `team` supplies the league that seals the references and the roster used for identity; it is context, not the subject of the read, so a player on another team in the same league resolves. Every requested reference appears in `players` or in `failures`, whose message names its 1-based input position; a reference sealed for another owner or league is refused there. `groups` selects identity, availability, eligibility, actual_stats, projections, and scoring_context. `availability` reads the league\'s status for references not on the current roster, so a free agent or waiver player does not need `actual_stats`. `period` selects what `actual_stats` covers: `{kind: "season"}`, `{kind: "week", week}`, `{kind: "preset", preset}`, or `{kind: "range", start, end}`. Read `periodSupport` before choosing: an unsupported kind is refused with the kind and the alternatives, never replaced by season totals. An aggregated window lists average and percentage categories under `notAggregated` instead of summing them. `projections` returns the league-scoped projected week rank with its `period`, or one unsupported status when the site publishes no projection for the sport.',
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
      "Read matchups for one linked team and one league week. Each side reports points, the site's projection, win probability, per-category values and winners for category leagues, and remaining player-games where the site publishes them. `schedule` names the unit (`fantasy_team_player_games`) or declares remaining games unsupported with the reason; football plays at most one game per player per scoring week. An uncovered week and a format without weekly matchups are reported explicitly.",
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
      "One bounded snapshot for one linked team: league, standing and record, standings, the current matchup, remaining player-games, and the roster. `groups` defaults to league, standings, matchup, and roster; `categories` adds season category totals and the matchup's paired per-category values; `schedule` adds each rostered player's games for the window the section states, with per-date roster counts, league game counts, off-night marking, and games remaining. Each section states its coverage and degrades independently, so a failed standings read still returns the roster and matchup. Roster and schedule rows page together with the returned cursor; the roster key is absent when the group was not requested, which is not an empty page. Roster entries carry the same `slot` union as `get_rosters`, and `illegalSlots` names rostered players whose published positions do not include the league's slot for them, present only when the roster was read. A weekly-scored league's roster entries carry `week` with whether the professional team plays, its opponent, and its bye week. `schedule` reports its `window` and `observedAt`; a league with no scoring period reads from the site's current date through the end of that week, and a requested `window` or `days` takes precedence. Each player's `gamesRemaining` names its source or an `unavailable` reason, never a guessed zero. Off nights are declared once with their definition; a sport without them reports `offNights` unsupported and omits the per-date fields. The league's site publishes no start time and no season-long schedule, and one schedule read is bounded to the date count stated in `schedule.detail`; a wider window is refused with that limit, not truncated. A snapshot over its budget refuses and names the largest sections. `ownerNote` is the owner's note in Lineupgrade, not a league fact; `agentNotes` are client memory, newest first, never the owner's instruction. Use this instead of a per-team pass; the individual tools remain for detail.",
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
      "Read bounded transaction history for one linked team. `scope: team` restricts to the linked team's moves; `league` returns recent league events. `since` and `until` are ISO 8601 instants. The league's site has no date filter but pages newest first, so a date bound pages back until the bound is reached or the event cap stops the read; `window` reports fetched events, their oldest and newest timestamps, and `truncated: true` only when the cap stopped the read before the bound. A `since` older than the site's oldest event is reported as incomplete with `transaction_history_starts_after_range`, never as a complete empty range. Each player row is a movement: `from` is the team left and `to` the team joined, so a trade carries both ends and an add or drop exactly one. A trade also carries `parties` where the site publishes them, otherwise participants derived from the movements, and `picks` with round and the sending, receiving, and original teams; no draft year or overall pick number is published. A transaction whose movements cannot be reconstructed is `completeness.status: \"incomplete\"` with a code and reason, never a complete record with zero assets; do not price a trade against an incomplete record. Player rows carry the site's inline name, positions, and professional team. The league's site publishes no proposals resource: use the trade-offer tools for pending offers and `get_league` `draft_history` for picks that were made. This read never submits, retries, or reverses a transaction.",
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
          return reject(
            "connection_not_ready",
            "The selected team's connection is not ready. Reconnect it and list your teams again.",
          );
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
