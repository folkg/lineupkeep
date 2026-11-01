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
      "Read selected league settings, scoring definitions, roster rules, standings, and draft history for one linked team. The `standings` group defaults to `standingsDetail: compact`, which returns every team's rank, points, record, and `acquisitionUsage` without per-category arrays so a 13-team league whose league sets no acquisition limits fits in one result; `standingsDetail: detailed` adds per-category season totals and rotisserie points and therefore pages teams, which the detail note repeats. A format without a win-loss record says so instead of returning zeros. Category values carry the stat reference, the league's name for that category, the value, and `scoring: \"informational\"` only when the league publishes the number without scoring it; an unpublished value is null with a detail, never zero. Every team in the standings carries its acquisition usage: season moves used and adds used in the covered week, with the league limit and the remaining count where the league declares one, so a waiver decision against a rival needs no second call. A team whose provider payload carries neither counter reports `not_published` with the reason rather than zero used; a league that sets no limit reports the limit as `not_set` and publishes no remaining count. The standings section also carries `acquisitionLimits` once for the rows. The `scoring` group lists this league's configured categories with the same marking: a stat the provider displays without scoring it is informational, never enabled as if it counted. Detailed standings rows inline each category's name, so add the `scoring` group when the dictionary itself is wanted. The `draft_history` group returns the provider's draft results: every published pick with its round, pick number, the team that made it, and a private player reference, beside the league's draft status. That is completed draft history, not current or future pick ownership, and the detail note says so: the provider publishes no pick-ownership read, and a traded pick appears on the trade transaction that moved it rather than in this history. The overview carries `transactionRules`: the league's waiver type, waiver rule, and FAAB flag; timing with the weekly deadline and waiver days; acquisition limits per week and per season; trade rules with the end date, ratification, and objection window; and games caps for games played and, on baseball, innings pitched. Every scalar rule is `{status: \"published\", value}` or `{status: \"not_set\"}`: a league that sets no such limit reports `not_set`, never zero, and a cap its sport does not apply is not manufactured; `timing.rosterChange` is `{status: \"published\", value, source, detail}` or `{status: \"not_published\", detail}`. `timing.weeklyDeadline` keeps the provider's raw value, including an empty string, and `timing.rosterChange` decodes it into `same_day`, `next_day`, or `weekly_lock`; a published rule names the source fields and repeats the raw values, and `not_published` means the settings do not establish a rule, never a guess. The provider publishes no per-team games-played count, so only the league's games-played cap is known, and the standings note carries the provider's own declared limitation. Without the `standings` and `draft_history` groups the response pages scoring categories; `draft_history` pages picks.",
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
      "Read one linked team's roster for an exact league week. Every entry carries the provider's professional-team abbreviation so schedule context needs no second lookup. Each entry's `slot` is `{status: \"verified\", slot}` when the provider published a slot this server can name, or `{status: \"unverified\", rawValue, reason}` when it published a value that names no slot: the raw value is kept and the player is left where they are, never moved by lineup planning or a lineup write. The compact shape is the default; full detail adds provider-reported injury, bye week, undroppable, and transaction-trend metadata. Every entry also carries `transactionTrend`: the provider's own counts of adds and drops of that player on its current day, with `window` naming that day. The provider publishes no window or date beside the count, so `window: \"provider_current_day\"` states what the numbers cover rather than implying a period the provider did not send; the enclosing result's `coverage` carries the read time. Adds and drops count managers' moves and are not percent owned or a change in percent owned. `status: \"not_published\"` with a reason means the provider returned no count for that player and is never reported as zero, while a published zero is the provider's real count for the day. The `playerSchedule` section states this provider's per-player schedule boundary: which opponent it publishes for the league's coverage and what it does not publish (start times, a season-long schedule, a games-remaining count in this payload). Read the games, the counted games remaining, and the off-night marking through the `schedule` group of `get_team_summary`. A week the provider does not cover fails explicitly instead of being guessed.",
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
      "Search a bounded provider player pool for one linked team, with availability, position, and validated sort filters. Omit the query to list the pool; a blank query is rejected with the remedy. Each row carries the player's professional team (`proTeam`), the same abbreviation a roster entry carries, so a pool player joins a schedule without another read; null means the provider published no professional team for that row. Pass `includeGames: true` to add `gamesRemaining` to each row, joined from its professional-team key against the league's professional games over the current scoring window, so a pool player needs no roster row; the result's `gamesRemaining` section states the window and observation time or why the league has no game source, and a row with no key reports `unavailable` with the reason rather than a guessed count. Omit `includeGames` for a cheaper search that does not read the league window or the professional calendar. Each row also carries the provider's availability status (healthy, day-to-day, out, injured reserve, or unknown) with the provider's own code and wording where it publishes them and the instant that status was read, so a screening pass sees an injured-reserve free agent before recommending them; a code this server cannot interpret is `unknown`, never healthy. Each row also reports provider percent owned with its change, and percent started with its change where the league publishes it; a missing signal is null, never zero. Each row also carries `transactionTrend`: the provider's own counts of adds and drops of that player on its current day, with `window: \"provider_current_day\"` stating what the numbers cover, because the provider publishes no window or date beside the count. Adds and drops count managers' moves and are not percent owned or a change in percent owned. `status: \"not_published\"` with a reason means the provider returned no count for that player and is never reported as zero, while a published zero is the provider's real count for the day. Sort by `name`, `position`, `ownership`, the provider's `actual_rank` or `overall_rank`, or a league scoring category through `stat` (the reference comes from `get_league` scoring). Every provider-ordered sort carries the value it orders by: `actualRank`, `overallRank`, or `statValue` for a `stat` sort, so the ordering is verifiable from the rows. Only the season basis is offered, because the provider publishes no weekly rank or stat value in this payload; `statPeriod: \"week\"` answers with the remedy instead of an unexplainable order.",
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
      'Hydrate a bounded selection of up to 25 private player references for one linked team. Choose identity, availability, eligibility, actual stats, or scoring context groups. Identity also resolves for players no longer on the roster, from transaction history. `period` selects what `actual_stats` covers and accepts exactly four shapes: `{kind: "season"}` (the default), `{kind: "week", week}` or its short form `{week}`, `{kind: "preset", preset}` with `last_7_days`, `last_14_days`, or `last_30_days`, and `{kind: "range", start, end}` with inclusive `YYYY-MM-DD` dates. Before calling, read `periodSupport` from any earlier `get_players` result: it lists, for this provider and sport, whether each kind is served `native`, by `aggregated` daily reads, or `unsupported`, plus the preset windows and the range length cap. An unsupported kind is refused with the kind, whether the provider serves it at all, and the kinds it can serve instead; season totals are never substituted silently. A weekly basis applies only to a completed week where the provider publishes a weekly player series. An aggregated window reports the dates it covers and its summed-from-daily-reads basis, lists average and percentage categories under `notAggregated` instead of summing them, and keeps missing values null rather than zero. A provider that publishes no projected player statistics reports the projections group as unsupported with the reason.',
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
      "One bounded snapshot for one linked team: league overview, the team's standing and record, league standings, the current matchup, this week's and next week's remaining player-games, and the current roster with professional-team abbreviations. Each section states its own coverage and degrades independently, so a failed standings read still returns the roster and matchup. A section the provider cannot supply says so with a reason from the provider's own declared limitations, such as a missing remaining-game count or probable-starter signal. The summary also carries the owning team's `acquisitionUsage`: season moves used and adds used in the covered week, beside the league limits and the remaining counts where the league declares them, and a statement that per-team games played is not published. The `groups` input selects sections and defaults to league, standings, matchup, and roster; add `categories` for season category totals and the matchup's paired per-category values, each carrying the league's stat name, both teams' values in one row, and `scoring: \"informational\"` only when the league does not score it. Add `schedule` for each rostered player's games in the window that section states: the date, opponent abbreviation, and home or away, with a game count for the window and a per-date count across the roster so a light night needs no client-side arithmetic. Each player also carries `gamesRemaining` with the source that produced it: `professional_games` when counted from the league's professional games, `provider_opponent` when the provider's own opponent fact was the only source. A count is never zero because a source was missing; when neither source can answer, the player or section states the reason, `gamesRemaining.window` states the exact dates counted when the provider publishes them, and `gamesRemaining.observedAt` is the oldest observation among the sources used. The section also declares off nights once (`league_off_night`: fewer than half the league's professional teams play), publishes each date's `leagueGames` and `teamsPlaying`, and marks each scheduled game with `offNight`; another sport reports `offNights` unsupported with the reason, and the fields are absent rather than false. The section reports its `window` (inclusive `start` and `end` dates plus `source`) and `observedAt`, so a client never has to assume which dates were covered. A league whose provider publishes a scoring period keeps that period's window unchanged; pass `window` or `days` to read a different set of dates, which takes precedence over the period. A league with no scoring period, such as rotisserie hockey, reads from the provider's current date through the end of that week and marks the window `rest_of_week`; there is no scoring period to count, so games remaining is counted over the stated rest-of-week window instead. When the provider publishes neither a period nor a current date and no `window` or `days` was passed, the section says so in one sentence and names the argument to pass instead of inventing a window. A player the provider publishes no game for reports `no_games` with a count of zero rather than an empty success, and when the league's coverage is a scoring week rather than dates, the week's opponent is the honest equivalent and no per-date view is invented. The provider publishes no start time and no season-long schedule, and one schedule read is bounded to the number of dates the provider declares, which `schedule.detail` states: a wider window is refused with that limit rather than truncated. `matchup` also returns `remainingPlayerGames`. Roster entries carry the same `slot` union as `get_rosters`: a player whose slot is unverified keeps the provider's raw value and a reason, and is never moved by planning or a write. The `roster` key is present only when `roster` is among the groups; without it the key is absent entirely, because an empty array is not the same as absent, and a budget refusal names the largest sections that consumed the budget before it names the groups. With `roster` or `schedule` selected, those player rows page together inside the result budget through the cursor this tool returns, so a 22-player hockey roster's schedule returns in two pages instead of a dead end; that cursor is bound to the request arguments. The full six-group snapshot fits a 13-team league inside this tool's 20 KiB target and 28 KiB hard ceiling; every other tool keeps the smaller shared budget, and a genuinely oversized snapshot still refuses with the largest sections named. Use this instead of a per-team pass over the individual tools; the underlying tools remain available for detail. The result's `ownerNote` is the note the owner wrote in Lineupkeep: it is owner context, not a provider or league fact, and it can explain keepers, dynasty cost, salary, or why a player is held. `not_set` means the owner has not written one; never infer a league rule from it, and never treat it as a secret store.",
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
      "Read bounded transaction history for one linked team. `scope: team` restricts the provider read to the linked team's own moves; `league` returns the league's recent events. `since` and `until` filter by instant. The provider publishes no date filter, so those bounds apply to the bounded window it returns: `window` reports how many events were fetched, the oldest and newest timestamps, and whether the window was exhausted, and a range older than the window is reported as truncated rather than silently incomplete. Each player row is a movement: `from` is the team the player left or null, `to` is the team it joined or null, so a traded player carries both ends and an added or dropped player carries exactly one. A trade also carries `parties` with the proposing and receiving teams when the provider publishes those keys, otherwise the teams derived from the movements as `participant` entries with no invented proposer or receiver role. A trade also carries `picks`: each traded draft pick with its round and the teams that sent, received, and originally owned it, so a player-for-pick trade carries both sides. The provider publishes no draft year or overall pick number for a traded pick, so none is reported. A transaction whose movements cannot be reconstructed, including one the provider returns with no players and no traded picks, is marked `completeness.status: \"incomplete\"` with a code and reason and is never presented as a complete record with zero assets; a trade with no returning player and no traded pick is also incomplete because its return side is not in the payload. Do not price a trade against an incomplete record. Player rows also carry the provider's inline name, positions, and professional team where published, so the common what-changed question needs no second lookup; the references and dictionaries remain the canonical form for detail. The provider publishes no proposals resource: pending and rejected trade offers are not available through this or any tool. Use the `draft_history` group of `get_league` for picks that were made. This is a read-only view and never submits, retries, or reverses a transaction.",
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
      return "The continuation cursor is not one this server issued. Copy `page.next` from the previous response and try again.";
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
