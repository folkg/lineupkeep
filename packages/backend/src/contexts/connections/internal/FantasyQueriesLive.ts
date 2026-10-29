import { Array as EffectArray, DateTime, Effect, Layer } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import { Connections } from "#contexts/connections/Connections.ts";
import { FantasyQueries } from "#contexts/connections/FantasyQueries.ts";
import type { FantasySport } from "#contexts/connections/FantasyTeam.ts";
import type {
  ProviderDraftPick,
  ProviderLeagueSettings,
  ProviderLeagueTeam,
  ProviderPeriodWindow,
  ProviderPlayerDetail,
  ProviderPlayerStatGroup,
  ProviderReadFailure,
  ProviderRoster,
  ProviderRosterCoverage,
  ProviderMatchup,
  ProviderRemainingGames,
  ProviderRosterPlayer,
  ProviderStandings,
  ProviderStatBasis,
  ProviderStatPeriod,
  ProviderStatValue,
  ProviderTeamScore,
  ProviderTransactionTeam,
} from "#contexts/connections/Provider.ts";
import type { ProviderLimitationSubject } from "#contexts/connections/Provider.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";
import type {
  CalendarData,
  DraftPick,
  GetCalendarInput,
  GetLeagueInput,
  GetMatchupsInput,
  GetPlayersInput,
  GetRostersInput,
  GetTransactionsInput,
  LeagueData,
  LeagueGroup,
  ListTeamsInput,
  MatchupsData,
  PlayersData,
  PlayerGroup,
  RosterData,
  RosterPlayer as RosterPlayerView,
  RosterDetail,
  CategoryValue,
  SearchPlayersData,
  SearchPlayersInput,
  TransactionsData,
  TransactionWindow,
  GetTeamSummaryInput,
  StandingRow,
  StandingDetail,
  SummaryGroup,
  SummaryScheduleWeek,
  TeamSummaryData,
} from "#contexts/connections/QueryResults.ts";
import {
  CalendarData as CalendarSchema,
  LeagueData as LeagueSchema,
  ListTeamsData,
  MatchupsData as MatchupsSchema,
  PlayersData as PlayersSchema,
  RosterData as RosterSchema,
  SearchPlayersData as SearchPlayersSchema,
  TransactionsData as TransactionsSchema,
  TeamSummaryData as TeamSummarySchema,
} from "#contexts/connections/QueryResults.ts";
import {
  type QueryCoverage,
  type QueryFailure,
  type QueryError,
  type QueryPage,
  type QueryPeriod,
  type QueryStatus,
  type CounterpartyRef,
  type QueryTeam,
  type StatPeriod,
  QueryPersistenceFailed,
  QuerySelectionInvalid,
  type StatRef,
} from "#contexts/connections/QueryValues.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import { fitPage, queryBudget } from "./QueryBudget.ts";
import { loadTeamContext, providerIdentity } from "./QueryContext.ts";
import type { TeamContext } from "./QueryContext.ts";
import { QueryRepository } from "./QueryRepository.ts";
import type { OwnedTeam } from "./QueryRepository.ts";
import { QueryTokens } from "./QueryTokens.ts";

const defaultLeagueGroups: ReadonlyArray<LeagueGroup> = ["overview", "scoring", "roster_rules"];
const defaultPlayerGroups: ReadonlyArray<PlayerGroup> = ["identity", "availability", "eligibility"];
const summaryGroups: ReadonlyArray<SummaryGroup> = [
  "league",
  "standings",
  "categories",
  "matchup",
  "roster",
];
const defaultSummaryGroups: ReadonlyArray<SummaryGroup> = [
  "league",
  "standings",
  "matchup",
  "roster",
];

type ReadOutcome<A> =
  | { readonly _tag: "ok"; readonly value: A }
  | { readonly _tag: "unsupported"; readonly detail: string }
  | { readonly _tag: "failed"; readonly failure: QueryFailure };

export const FantasyQueriesLive = Layer.effect(
  FantasyQueries,
  Effect.gen(function* () {
    const connections = yield* Connections;
    const repository = yield* QueryRepository;
    const registry = yield* ProviderRegistry;
    const encryption = yield* ConnectionCredentialEncryption;
    const tokens = yield* QueryTokens;

    const loadContext = (
      userId: UserId,
      teamId: OwnedTeam["team"]["id"],
    ): Effect.Effect<TeamContext, QueryError> =>
      loadTeamContext(repository, encryption, registry, userId, teamId);

    const readOutcome = <A>(
      context: TeamContext,
      resource: string,
      program: Effect.Effect<A, ProviderReadFailure>,
    ): Effect.Effect<ReadOutcome<A>> =>
      Effect.matchEffect(program, {
        onSuccess: (value) => Effect.succeed<ReadOutcome<A>>({ _tag: "ok", value }),
        onFailure: (error) => {
          switch (error._tag) {
            case "provider.operation_unsupported":
              return Effect.succeed<ReadOutcome<A>>({ _tag: "unsupported", detail: error.reason });
            case "provider.session_rejected":
              return repository.recordSessionRejected(context.userId, context.owned).pipe(
                Effect.as<ReadOutcome<A>>({
                  _tag: "failed",
                  failure: {
                    code: "provider_session_rejected",
                    resource,
                    message:
                      "The provider rejected the stored session. Reconnect the connection and start the query again.",
                  },
                }),
              );
            case "provider.request_failed":
              return Effect.succeed<ReadOutcome<A>>({
                _tag: "failed",
                failure: {
                  code: "provider_unavailable",
                  resource,
                  message: "The provider could not be reached.",
                },
              });
            case "provider.response_invalid":
              return Effect.succeed<ReadOutcome<A>>({
                _tag: "failed",
                failure: {
                  code: "provider_invalid_response",
                  resource,
                  message:
                    error.field === undefined
                      ? "The provider returned data that could not be verified for this request."
                      : `The provider returned data that could not be verified (field \`${error.field}\`).`,
                },
              });
            case "provider.period_mismatch":
              return Effect.succeed<ReadOutcome<A>>({
                _tag: "failed",
                failure: {
                  code: "period_unavailable",
                  resource,
                  message: periodMismatchDetail(error.requested, error.covered),
                },
              });
            case "provider.period_unsupported":
              return Effect.succeed<ReadOutcome<A>>({
                _tag: "failed",
                failure: {
                  code: "period_unsupported",
                  resource,
                  message: `${error.reason} ${error.remedy}`,
                },
              });
          }
        },
      });

    const readLeague = (context: TeamContext): Effect.Effect<ReadOutcome<ProviderLeagueSettings>> =>
      Effect.gen(function* () {
        const outcome = yield* readOutcome(
          context,
          "league",
          context.provider.readLeague({
            ...providerIdentity(context),
            providerLeagueKey: context.owned.team.providerLeagueKey,
            sport: context.owned.team.sport,
          }),
        );
        if (outcome._tag !== "ok" || outcome.value.season === context.owned.team.season) {
          return outcome;
        }
        return {
          _tag: "failed" as const,
          failure: {
            code: "league_season_mismatch",
            resource: "league",
            message: "The provider league season does not match the linked team.",
          },
        };
      });

    const resolveStatRef = (
      context: TeamContext,
      stat: StatRef,
    ): Effect.Effect<StatRefResolution, QueryError> =>
      Effect.gen(function* () {
        const outcome = yield* readLeague(context);
        if (outcome._tag !== "ok") {
          return {
            _tag: "unavailable" as const,
            detail:
              outcome._tag === "failed"
                ? outcome.failure.message
                : "The provider reported no league scoring categories.",
          };
        }
        const cache = new Map<number, StatRef>();
        for (const category of outcome.value.statCategories) {
          const ref = yield* statRefFor(context, tokens, cache, category.statId);
          if (ref === stat) {
            return { _tag: "resolved" as const, statId: category.statId };
          }
        }
        return { _tag: "unknown" as const };
      });

    const transactionIdentityIndex = (
      context: TeamContext,
      fetchedAt: DateTime.Utc,
      coverageEntries: Array<QueryCoverage>,
      unresolvedKeys: ReadonlyArray<string>,
    ): Effect.Effect<ReadonlyMap<string, TransactionIdentity>> =>
      Effect.gen(function* () {
        const wanted = new Set(unresolvedKeys);
        const identities = new Map<string, TransactionIdentity>();
        if (wanted.size === 0) {
          return identities;
        }
        const outcome = yield* readOutcome(
          context,
          "transactions",
          context.provider.readTransactions({
            ...providerIdentity(context),
            providerLeagueKey: context.owned.team.providerLeagueKey,
            providerTeamKey: undefined,
            limit: 50,
          }),
        );
        if (outcome._tag !== "ok") {
          coverageEntries.push(
            outcome._tag === "failed"
              ? degradedCoverage("players", "transactions", fetchedAt, outcome.failure.message)
              : unsupportedCoverage("players", "transactions", fetchedAt),
          );
          return identities;
        }
        for (const transaction of outcome.value) {
          for (const player of transaction.players) {
            if (!wanted.has(player.providerPlayerKey) || identities.has(player.providerPlayerKey)) {
              continue;
            }
            const identity = playerIdentity(player);
            if (identity !== undefined) {
              identities.set(player.providerPlayerKey, {
                identity,
                eligiblePositions: player.eligiblePositions,
              });
            }
          }
        }
        if (identities.size > 0) {
          coverageEntries.push(
            coverage(
              "players",
              "transactions",
              fetchedAt,
              undefined,
              "Identity for players outside the current roster comes from transaction history.",
            ),
          );
        }
        return identities;
      });

    const openOffset = (
      userId: UserId,
      fingerprint: string,
      cursor: string | undefined,
      now: DateTime.Utc,
    ): Effect.Effect<number, QueryError> =>
      cursor === undefined
        ? Effect.succeed(0)
        : tokens.openCursor({ userId, fingerprint, cursor, now });

    const listTeams = Effect.fn("FantasyQueries.listTeams")(function* (
      userId: UserId,
      input: ListTeamsInput,
    ) {
      const teams = yield* connections
        .listTeams(userId)
        .pipe(Effect.mapError((cause) => QueryPersistenceFailed.make({ cause })));
      const rows = teams
        .filter(
          (team) =>
            (input.sport === undefined || team.sport === input.sport) &&
            (input.season === undefined || team.season === input.season) &&
            (input.connection === undefined || team.connectionId === input.connection),
        )
        .map((team) => ({
          team: team.id,
          connection: team.connectionId,
          provider: team.provider,
          league: team.league,
          sport: team.sport,
          season: team.season,
          name: team.name,
          availability: team.availability,
          automation: team.automation,
          lastSeenAt: team.lastSeenAt,
        }))
        .toSorted(
          (left, right) =>
            left.league.localeCompare(right.league) ||
            left.name.localeCompare(right.name) ||
            left.team.localeCompare(right.team),
        );
      const fingerprintValue = yield* queryFingerprint(
        [
          "list_teams",
          `sport=${input.sport ?? ""}`,
          `season=${input.season === undefined ? "" : String(input.season)}`,
          `connection=${input.connection ?? ""}`,
          "order=league,name,id",
        ].join("|"),
      );
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      return yield* fitPage({
        schema: ListTeamsData,
        rows,
        offset,
        limit: input.limit ?? 50,
        resource: "teams",
        groups: undefined,
        remedy: "Request a smaller limit. Every team row is already compact.",
        build: (pageRows, page) => ({
          status: "ok" as const,
          teams: [...pageRows],
          page,
          budget: queryBudget,
        }),
        makeNext: (nextOffset) =>
          tokens.sealCursor({ userId, fingerprint: fingerprintValue, offset: nextOffset, now }),
        recordLabel: (row) => row.team,
      });
    });

    const getCalendar = Effect.fn("FantasyQueries.getCalendar")(function* (
      userId: UserId,
      input: GetCalendarInput,
    ) {
      const context = yield* loadContext(userId, input.team);
      const team = queryTeam(context.owned);
      const fetchedAt = yield* DateTime.now;
      const outcome = yield* readLeague(context);
      if (outcome._tag !== "ok") {
        return calendarWithoutWeekWindow(context.provider, team, fetchedAt, outcome);
      }
      const league = outcome.value;
      const window = league.periodWindow;
      if (window === undefined) {
        return calendarWithoutWeekWindow(context.provider, team, fetchedAt, outcome);
      }
      if (window.end < window.start) {
        return calendarWithoutWeekWindow(context.provider, team, fetchedAt, {
          _tag: "failed",
          failure: {
            code: "provider_invalid_response",
            resource: "league",
            message: "The provider league period range is invalid.",
          },
        });
      }
      const periods = Array.from({ length: window.end - window.start + 1 }, (_, index) => {
        const week = window.start + index;
        return { week, isCurrent: week === window.current };
      });
      const fingerprintValue = yield* queryFingerprint(`calendar|team=${input.team}|order=week`);
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      const base = {
        status: "ok" as const,
        team,
        window: {
          currentWeek: window.current,
          startWeek: window.start,
          endWeek: window.end,
        },
        dates: {
          ...(league.startDate === undefined ? {} : { start: league.startDate }),
          ...(league.endDate === undefined ? {} : { end: league.endDate }),
        },
        lockContext: {
          status: "unverified" as const,
          ...(league.weeklyDeadline === undefined ? {} : { weeklyDeadline: league.weeklyDeadline }),
          detail: limitation(context.provider, "lock_timing"),
        },
        historical: {
          status: "unsupported" as const,
          detail: limitation(context.provider, "historical_seasons"),
        },
        coverage: [coverage("league", "league_settings", fetchedAt)],
        failures: [],
        budget: queryBudget,
      };
      return yield* fitPage({
        schema: CalendarSchema,
        rows: periods,
        offset,
        limit: 30,
        resource: "periods",
        groups: undefined,
        remedy: "Request a smaller limit.",
        build: (pageRows, page) => ({ ...base, periods: [...pageRows], page }),
        makeNext: (nextOffset) =>
          tokens.sealCursor({ userId, fingerprint: fingerprintValue, offset: nextOffset, now }),
        recordLabel: (row) => `week:${String(row.week)}`,
      });
    });

    const getLeague = Effect.fn("FantasyQueries.getLeague")(function* (
      userId: UserId,
      input: GetLeagueInput,
    ) {
      const context = yield* loadContext(userId, input.team);
      const team = queryTeam(context.owned);
      const groups = [...new Set(input.groups ?? defaultLeagueGroups)];
      if (groups.length === 0) {
        return yield* QuerySelectionInvalid.make({
          detail: "Select at least one league group.",
        });
      }
      const presentation = input.standingsDetail ?? "compact";
      if (input.standingsDetail !== undefined && !groups.includes("standings")) {
        return yield* QuerySelectionInvalid.make({
          detail:
            "`standingsDetail` applies only when the `standings` group is requested. Add `standings` to `groups`, or omit `standingsDetail`.",
        });
      }
      const fetchedAt = yield* DateTime.now;
      const outcome = yield* readLeague(context);
      if (outcome._tag !== "ok") {
        return leagueWithoutData(team, groups, fetchedAt, outcome);
      }
      const league = outcome.value;
      const includeScoring = groups.includes("scoring") || presentation === "detailed";
      const scoring = includeScoring ? yield* scoringCategories(context, tokens, league) : [];
      const standingsOutcome = groups.includes("standings")
        ? yield* readOutcome(
            context,
            "standings",
            context.provider.readStandings({
              ...providerIdentity(context),
              providerLeagueKey: context.owned.team.providerLeagueKey,
            }),
          )
        : undefined;
      const scoringNames = categoryNames(league);
      const standingTable =
        standingsOutcome?._tag === "ok"
          ? yield* standingRows(
              context,
              tokens,
              standingsOutcome.value,
              presentation === "compact" ? undefined : scoringNames,
            )
          : { rows: [] as ReadonlyArray<StandingRow>, omittedCategoryCount: 0 };
      const standingsRows = standingTable.rows;
      const standingsFormat = league.format;
      const draftOutcome = groups.includes("draft_history")
        ? yield* readOutcome(
            context,
            "draft_results",
            context.provider.readDraftResults({
              ...providerIdentity(context),
              providerLeagueKey: context.owned.team.providerLeagueKey,
            }),
          )
        : undefined;
      const leagueTeamsOutcome =
        draftOutcome?._tag === "ok"
          ? yield* readOutcome(
              context,
              "league_teams",
              context.provider.readLeagueTeams({
                ...providerIdentity(context),
                providerLeagueKey: context.owned.team.providerLeagueKey,
              }),
            )
          : undefined;
      const draftPicks =
        draftOutcome?._tag === "ok"
          ? yield* draftPickRows(
              context,
              tokens,
              draftOutcome.value,
              leagueTeamsOutcome?._tag === "ok" ? leagueTeamsOutcome.value : [],
            )
          : [];
      const draftPaged = groups.includes("draft_history") && draftOutcome?._tag === "ok";
      const standingsPaged = groups.includes("standings") && !draftPaged;
      const pagedResource = draftPaged ? "draft_history" : standingsPaged ? "standings" : "scoring";
      const fingerprintValue = yield* queryFingerprint(
        `league|team=${input.team}|groups=${[...groups].sort().join(",")}|standings=${standingsPaged ? presentation : "none"}|paged=${pagedResource}|order=${draftPaged ? "draft_pick" : standingsPaged ? "rank" : "stat_id"}`,
      );
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      const failures: QueryFailure[] = [];
      const coverageEntries: QueryCoverage[] = [coverage("league", "league_settings", fetchedAt)];
      if (groups.includes("scoring")) {
        coverageEntries.push(coverage("scoring", "league_settings", fetchedAt));
      }
      if (standingsOutcome !== undefined) {
        coverageEntries.push(
          standingsOutcome._tag === "ok"
            ? coverage("standings", "standings", fetchedAt)
            : standingsOutcome._tag === "unsupported"
              ? unsupportedCoverage("standings", "standings", fetchedAt, standingsOutcome.detail)
              : degradedCoverage(
                  "standings",
                  "standings",
                  fetchedAt,
                  standingsOutcome.failure.message,
                ),
        );
        if (standingsOutcome._tag === "failed") {
          failures.push(standingsOutcome.failure);
        }
      }
      if (draftOutcome !== undefined) {
        coverageEntries.push(
          draftOutcome._tag === "ok"
            ? coverage("draft_history", "draft_results", fetchedAt)
            : draftOutcome._tag === "unsupported"
              ? unsupportedCoverage(
                  "draft_history",
                  "draft_results",
                  fetchedAt,
                  draftOutcome.detail,
                )
              : degradedCoverage(
                  "draft_history",
                  "draft_results",
                  fetchedAt,
                  draftOutcome.failure.message,
                ),
        );
        if (draftOutcome._tag === "failed") {
          failures.push(draftOutcome.failure);
        }
      }
      if (leagueTeamsOutcome !== undefined) {
        coverageEntries.push(
          leagueTeamsOutcome._tag === "ok"
            ? coverage("league_teams", "league_teams", fetchedAt)
            : leagueTeamsOutcome._tag === "unsupported"
              ? unsupportedCoverage(
                  "league_teams",
                  "league_teams",
                  fetchedAt,
                  leagueTeamsOutcome.detail,
                )
              : degradedCoverage(
                  "league_teams",
                  "league_teams",
                  fetchedAt,
                  leagueTeamsOutcome.failure.message,
                ),
        );
        if (leagueTeamsOutcome._tag === "failed") {
          failures.push(leagueTeamsOutcome.failure);
        }
      }
      const base = {
        status: "ok" as const,
        team,
        ...(groups.includes("overview") ? { overview: leagueOverview(league) } : {}),
        ...(groups.includes("roster_rules") ? { rosterRules: rosterRules(league) } : {}),
        coverage: coverageEntries,
        failures,
        budget: queryBudget,
      };
      if (draftPaged) {
        return yield* fitPage({
          schema: LeagueSchema,
          rows: draftPicks,
          offset,
          limit: input.limit ?? 20,
          resource: "draft_history.picks",
          groups,
          remedy:
            "Request the `draft_history` group without the other groups for the most picks per page.",
          build: (pageRows, page) => ({
            ...base,
            ...(includeScoring ? { scoring } : {}),
            ...(standingsOutcome === undefined
              ? {}
              : {
                  standings: standingsData(
                    standingsOutcome,
                    standingsRows,
                    standingTable.omittedCategoryCount,
                    standingsFormat,
                    presentation,
                  ),
                }),
            draftHistory: draftHistoryData(draftOutcome, pageRows, league.draftStatus),
            page,
          }),
          makeNext: (nextOffset) =>
            tokens.sealCursor({ userId, fingerprint: fingerprintValue, offset: nextOffset, now }),
          recordLabel: (pick) => `${String(pick.round)}.${String(pick.pick)}`,
        });
      }
      if (standingsPaged && standingsOutcome !== undefined) {
        return yield* fitPage({
          schema: LeagueSchema,
          rows: standingsRows,
          offset,
          limit: input.limit ?? 20,
          resource: "standings.teams",
          groups,
          remedy:
            "Request the `standings` group without the other groups or `scoring`, or use `standingsDetail: compact`.",
          build: (pageRows, page) => ({
            ...base,
            ...(includeScoring ? { scoring } : {}),
            ...(draftOutcome === undefined
              ? {}
              : { draftHistory: draftHistoryData(draftOutcome, draftPicks, league.draftStatus) }),
            standings: standingsData(
              standingsOutcome,
              [...pageRows],
              standingTable.omittedCategoryCount,
              standingsFormat,
              presentation,
            ),
            page,
          }),
          makeNext: (nextOffset) =>
            tokens.sealCursor({ userId, fingerprint: fingerprintValue, offset: nextOffset, now }),
          recordLabel: (row) => row.team,
        });
      }
      return yield* fitPage({
        schema: LeagueSchema,
        rows: groups.includes("scoring") ? scoring : [],
        offset,
        limit: input.limit ?? 20,
        resource: "scoring",
        groups,
        remedy: "Request the `scoring` group without the other groups, or a smaller limit.",
        build: (pageRows, page) => ({
          ...base,
          ...(standingsOutcome === undefined
            ? {}
            : {
                standings: standingsData(
                  standingsOutcome,
                  standingsRows,
                  standingTable.omittedCategoryCount,
                  standingsFormat,
                  presentation,
                ),
              }),
          ...(draftOutcome === undefined
            ? {}
            : { draftHistory: draftHistoryData(draftOutcome, draftPicks, league.draftStatus) }),
          scoring: [...pageRows],
          page,
        }),
        makeNext: (nextOffset) =>
          tokens.sealCursor({ userId, fingerprint: fingerprintValue, offset: nextOffset, now }),
        recordLabel: (row) => row.stat,
      });
    });

    const getRosters = Effect.fn("FantasyQueries.getRosters")(function* (
      userId: UserId,
      input: GetRostersInput,
    ) {
      const context = yield* loadContext(userId, input.team);
      const team = queryTeam(context.owned);
      const detail: RosterDetail = input.detail ?? "compact";
      const fetchedAt = yield* DateTime.now;
      const leagueOutcome = yield* readLeague(context);
      if (
        input.period !== undefined &&
        leagueOutcome._tag === "ok" &&
        withinPeriodWindow(leagueOutcome.value.periodWindow, input.period) === false
      ) {
        return yield* QuerySelectionInvalid.make({
          detail: "The requested period is outside the linked league's season.",
        });
      }
      const window = leagueOutcome._tag === "ok" ? leagueOutcome.value.periodWindow : undefined;
      const period = input.period ?? currentPeriod(window);
      const readRoster = (
        requested: { readonly week: number } | undefined,
      ): Effect.Effect<ReadOutcome<ProviderRoster>> =>
        readOutcome(
          context,
          "roster",
          context.provider.readRoster({
            ...providerIdentity(context),
            providerTeamKey: context.owned.team.providerTeamKey,
            period: providerRosterPeriod(requested),
          }),
        );
      let rosterOutcome = yield* readRoster(period);
      if (
        rosterOutcome._tag === "failed" &&
        rosterOutcome.failure.code === "period_unavailable" &&
        input.period === undefined
      ) {
        const current = yield* readRoster(undefined);
        if (current._tag === "ok" && current.value.coverage.type === "date") {
          rosterOutcome = current;
        }
      }
      if (rosterOutcome._tag !== "ok") {
        return rosterWithoutData(
          context.provider,
          team,
          period,
          fetchedAt,
          rosterOutcome,
          leagueOutcome,
        );
      }
      const roster = rosterOutcome.value;
      const rosterCoverage =
        roster.coverage.type === "week"
          ? coverage("roster", "roster", fetchedAt, { week: roster.coverage.week })
          : coverage(
              "roster",
              "roster",
              fetchedAt,
              undefined,
              `Date-scoped roster for ${roster.coverage.date}`,
            );
      const periodKey =
        roster.coverage.type === "week"
          ? String(roster.coverage.week)
          : `date:${roster.coverage.date}`;
      const players = yield* Effect.forEach(
        roster.players,
        (player) => rosterPlayer(context, tokens, player, detail),
        { concurrency: 1 },
      );
      const fingerprintValue = yield* queryFingerprint(
        `rosters|team=${input.team}|period=${periodKey}|detail=${detail}|order=slot,player`,
      );
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      const base: Omit<RosterData, "players" | "page"> = {
        status: "ok",
        team,
        ...(roster.coverage.type === "week" ? { period: { week: roster.coverage.week } } : {}),
        coverage: [leagueCoverage(leagueOutcome, fetchedAt), rosterCoverage],
        playerSchedule: {
          status: "unsupported",
          detail: limitation(context.provider, "player_schedule"),
        },
        failures: leagueFailure(leagueOutcome),
        budget: queryBudget,
      };
      return yield* fitPage({
        schema: RosterSchema,
        rows: players,
        offset,
        limit: input.limit ?? 50,
        resource: "roster.players",
        groups: [detail],
        remedy: "Use `detail: compact` or request a smaller limit.",
        build: (pageRows, page) => ({ ...base, players: [...pageRows], page }),
        makeNext: (nextOffset) =>
          tokens.sealCursor({ userId, fingerprint: fingerprintValue, offset: nextOffset, now }),
        recordLabel: (row) => row.player,
      });
    });

    const searchPlayers = Effect.fn("FantasyQueries.searchPlayers")(function* (
      userId: UserId,
      input: SearchPlayersInput,
    ) {
      const query = input.query?.trim();
      if (query === "") {
        return yield* QuerySelectionInvalid.make({
          detail:
            "The player search query must contain at least one visible character. Omit the query to search the whole available player pool.",
        });
      }
      const context = yield* loadContext(userId, input.team);
      const team = queryTeam(context.owned);
      const fetchedAt = yield* DateTime.now;
      const availability = input.availability ?? "all";
      const sort = input.sort ?? "name";
      const statPeriod = input.statPeriod ?? "season";
      const playerSearch = context.provider.capabilities.playerSearch;
      if (!playerSearch.sorts.includes(sort)) {
        return yield* QuerySelectionInvalid.make({
          detail: `This provider does not accept the \`${sort}\` player sort. Choose one of: ${playerSearch.sorts.join(", ")}.`,
        });
      }
      if (statPeriod === "week") {
        return yield* QuerySelectionInvalid.make({
          detail:
            "The provider's player search publishes only season rank and stat values, so a weekly ordering cannot be shown in the rows. Use statPeriod `season`, or sort by name, position, or ownership.",
        });
      }
      if (sort === "stat" && input.stat === undefined) {
        return yield* QuerySelectionInvalid.make({
          detail:
            "A stat sort needs the scoring category reference from `get_league` in `stat`, or choose `actual_rank`, `overall_rank`, `ownership`, `position`, or `name`.",
        });
      }
      if (sort !== "stat" && input.stat !== undefined) {
        return yield* QuerySelectionInvalid.make({
          detail: "The `stat` reference is used only with sort `stat`.",
        });
      }
      let statId: number | undefined;
      if (input.stat !== undefined) {
        const resolved = yield* resolveStatRef(context, input.stat);
        if (resolved._tag === "unavailable") {
          return searchWithoutData(team, fetchedAt, {
            _tag: "failed",
            failure: {
              code: "league_unavailable",
              resource: "players",
              message: resolved.detail,
            },
          });
        }
        if (resolved._tag === "unknown") {
          return yield* QuerySelectionInvalid.make({
            detail:
              "The stat reference is not one of this league's scoring categories. Read `get_league` scoring and use one of those references.",
          });
        }
        statId = resolved.statId;
      }
      const outcome = yield* readOutcome(
        context,
        "players",
        context.provider.searchPlayers({
          ...providerIdentity(context),
          providerLeagueKey: context.owned.team.providerLeagueKey,
          season: context.owned.team.season,
          query,
          availability,
          sort,
          statId,
          statType: statPeriod,
          limit: 50,
        }),
      );
      if (outcome._tag !== "ok") {
        return searchWithoutData(team, fetchedAt, outcome);
      }
      const positions = new Set(input.positions ?? []);
      const filtered = outcome.value.players.filter(
        (player) =>
          (availability === "all" || player.availability === availability) &&
          (positions.size === 0 ||
            positions.has(player.primaryPosition) ||
            positions.has(player.displayPosition) ||
            player.eligiblePositions.some((position) => positions.has(position))),
      );
      const ordered = providerOrdered(context.provider, sort)
        ? filtered
        : filtered.toSorted((left, right) => comparePlayers(left, right, sort));
      const refs = yield* tokens.sealPlayerRefs({
        userId,
        leagueKey: context.owned.team.providerLeagueKey,
        playerKeys: ordered.map((player) => player.providerPlayerKey),
      });
      const players = EffectArray.map(EffectArray.zip(ordered, refs), ([player, playerRef]) => ({
        player: playerRef,
        name: player.name,
        primaryPosition: player.primaryPosition,
        displayPosition: player.displayPosition,
        eligiblePositions: player.eligiblePositions,
        availability: player.availability,
        percentOwned: player.percentOwned,
        percentOwnedDelta: player.percentOwnedDelta,
        percentStarted: player.percentStarted,
        percentStartedChange: player.percentStartedChange,
        actualRank: player.actualRank,
        overallRank: player.overallRank,
        ...(sort === "stat" ? { statValue: player.statValue } : {}),
      }));
      const fingerprintValue = yield* queryFingerprint(
        [
          "search_players",
          `team=${input.team}`,
          `query=${query ?? ""}`,
          `positions=${[...positions].sort().join(",")}`,
          `availability=${availability}`,
          `sort=${sort}`,
          `stat=${input.stat ?? ""}`,
          `statPeriod=${statPeriod}`,
          "order=provider",
        ].join("|"),
      );
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      const base: Omit<SearchPlayersData, "players" | "page"> = {
        status: "ok",
        team,
        coverage: [coverage("players", "player_search", fetchedAt)],
        failures: [],
        budget: queryBudget,
      };
      return yield* fitPage({
        schema: SearchPlayersSchema,
        rows: players,
        offset,
        limit: input.limit ?? 25,
        resource: "players",
        groups: undefined,
        remedy: "Narrow the query, positions, or availability, or request a smaller limit.",
        build: (pageRows, page) => ({ ...base, players: [...pageRows], page }),
        makeNext: (nextOffset) =>
          tokens.sealCursor({ userId, fingerprint: fingerprintValue, offset: nextOffset, now }),
        recordLabel: (row) => row.player,
      });
    });

    const getPlayers = Effect.fn("FantasyQueries.getPlayers")(function* (
      userId: UserId,
      input: GetPlayersInput,
    ) {
      const context = yield* loadContext(userId, input.team);
      const team = queryTeam(context.owned);
      const groups = [...new Set(input.groups ?? defaultPlayerGroups)];
      if (groups.length === 0) {
        return yield* QuerySelectionInvalid.make({
          detail: "Select at least one player group.",
        });
      }
      const fetchedAt = yield* DateTime.now;
      const leagueKey = context.owned.team.providerLeagueKey;
      const opened = yield* tokens.openPlayerRefs({ userId, leagueKey, refs: input.players });
      const resolved = EffectArray.map(
        EffectArray.zip(input.players, opened),
        ([ref, providerPlayerKey]) => ({
          ref,
          providerPlayerKey,
        }),
      );
      const valid = resolved.filter(
        (
          row,
        ): row is {
          readonly ref: (typeof input.players)[number];
          readonly providerPlayerKey: string;
        } => row.providerPlayerKey !== undefined,
      );
      const failures: QueryFailure[] = resolved.flatMap((row) =>
        row.providerPlayerKey === undefined
          ? [
              {
                code: "invalid_player_reference",
                resource: row.ref,
                message: "The player reference is invalid for this team and owner.",
              },
            ]
          : [],
      );
      const coverageEntries: QueryCoverage[] = [];
      let league: ProviderLeagueSettings | undefined;
      if (
        groups.includes("scoring_context") ||
        groups.includes("actual_stats") ||
        groups.includes("projections")
      ) {
        const leagueOutcome = yield* readLeague(context);
        if (leagueOutcome._tag === "ok") {
          league = leagueOutcome.value;
          coverageEntries.push(coverage("scoring", "league_settings", fetchedAt));
        } else {
          coverageEntries.push(
            leagueOutcome._tag === "failed"
              ? degradedCoverage(
                  "scoring",
                  "league_settings",
                  fetchedAt,
                  leagueOutcome.failure.message,
                )
              : unsupportedCoverage("scoring", "league_settings", fetchedAt),
          );
          if (leagueOutcome._tag === "failed") {
            failures.push(leagueOutcome.failure);
          }
        }
      }
      const rosterOutcome = yield* readOutcome(
        context,
        "roster",
        context.provider.readRoster({
          ...providerIdentity(context),
          providerTeamKey: context.owned.team.providerTeamKey,
          period: undefined,
        }),
      );
      let roster: ProviderRoster | undefined;
      if (rosterOutcome._tag === "ok") {
        roster = rosterOutcome.value;
        coverageEntries.push(
          roster.coverage.type === "week"
            ? coverage("roster", "roster", fetchedAt, { week: roster.coverage.week })
            : coverage(
                "roster",
                "roster",
                fetchedAt,
                undefined,
                `Date-scoped roster for ${roster.coverage.date}`,
              ),
        );
      } else {
        coverageEntries.push(unsupportedCoverage("roster", "roster", fetchedAt));
        if (rosterOutcome._tag === "failed") {
          failures.push(rosterOutcome.failure);
        }
      }
      const requestedPeriod = normalizeStatPeriod(input.period);
      let details: ReadonlyArray<ProviderPlayerDetail> = [];
      let detailsUnsupported: string | undefined;
      if (groups.includes("actual_stats")) {
        const detailsOutcome = yield* readOutcome(
          context,
          "players",
          context.provider.readPlayerDetails({
            ...providerIdentity(context),
            providerLeagueKey: leagueKey,
            providerPlayerKeys: valid.map((row) => row.providerPlayerKey),
            sport: context.owned.team.sport,
            period: requestedPeriod,
            currentPeriod: league?.periodWindow?.current,
            seasonStart: league?.startDate,
            seasonEnd: league?.endDate,
          }),
        );
        if (detailsOutcome._tag === "ok") {
          details = detailsOutcome.value;
          const basis = details.find((player) => player.actual !== undefined)?.actual?.basis;
          coverageEntries.push(
            coverage(
              "players",
              "player_details",
              fetchedAt,
              undefined,
              basis === undefined ? undefined : statBasisDetail(basis),
            ),
          );
        } else {
          if (
            detailsOutcome._tag === "failed" &&
            detailsOutcome.failure.code === "period_unsupported"
          ) {
            return yield* QuerySelectionInvalid.make({
              detail: `${periodKindRefusal(requestedPeriod)} ${detailsOutcome.failure.message}`,
            });
          }
          detailsUnsupported =
            detailsOutcome._tag === "unsupported"
              ? detailsOutcome.detail
              : detailsOutcome.failure.message;
          coverageEntries.push(
            detailsOutcome._tag === "unsupported"
              ? unsupportedCoverage("players", "player_details", fetchedAt)
              : degradedCoverage(
                  "players",
                  "player_details",
                  fetchedAt,
                  detailsOutcome.failure.message,
                ),
          );
          if (
            detailsOutcome._tag === "failed" &&
            detailsOutcome.failure.code !== "period_unavailable"
          ) {
            failures.push(detailsOutcome.failure);
          }
        }
      }
      const rosterByKey = new Map(
        (roster?.players ?? []).map((player) => [player.providerPlayerKey, player]),
      );
      const detailsByKey = new Map(details.map((player) => [player.providerPlayerKey, player]));
      const transactionIdentities = yield* transactionIdentityIndex(
        context,
        fetchedAt,
        coverageEntries,
        valid
          .map((row) => row.providerPlayerKey)
          .filter(
            (key) =>
              playerIdentity(rosterByKey.get(key)) === undefined &&
              playerIdentity(detailsByKey.get(key)) === undefined,
          ),
      );
      const statRefs = new Map<number, StatRef>();
      const dictionaryStatIds = new Set<number>();
      const statRefFor = (statId: number): Effect.Effect<StatRef> =>
        Effect.gen(function* () {
          const existing = statRefs.get(statId);
          if (existing !== undefined) {
            return existing;
          }
          const ref = yield* tokens.statRef({ leagueKey, statId });
          statRefs.set(statId, ref);
          return ref;
        });
      const statValues = (
        stats: ProviderPlayerStatGroup["stats"],
      ): Effect.Effect<ReadonlyArray<{ readonly stat: StatRef; readonly value: number | null }>> =>
        Effect.forEach(
          stats,
          (stat) =>
            statRefFor(stat.statId).pipe(Effect.map((ref) => ({ stat: ref, value: stat.value }))),
          { concurrency: 1 },
        );
      const statGroup = (
        group: ProviderPlayerStatGroup,
      ): Effect.Effect<NonNullable<PlayersData["players"][number]["actualStats"]>> =>
        Effect.gen(function* () {
          const notAggregated = yield* Effect.forEach(
            group.notAggregated,
            (omitted) =>
              statRefFor(omitted.statId).pipe(
                Effect.map((stat) => ({ stat, detail: omitted.detail })),
              ),
            { concurrency: 1 },
          );
          return {
            status: "available" as const,
            basis: group.basis.type,
            ...(group.basis.type === "week" ? { period: { week: group.basis.week } } : {}),
            ...(group.basis.type === "date_range"
              ? {
                  range: {
                    start: group.basis.start,
                    end: group.basis.end,
                    days: group.basis.days,
                  },
                  aggregation: {
                    method: "daily_sum" as const,
                    detail: `Summed from ${String(group.basis.days)} provider daily reads; categories in \`notAggregated\` are not summed.`,
                  },
                }
              : {}),
            stats: yield* statValues(group.stats),
            notAggregated,
          };
        });
      const scoringFor = (
        player: ProviderRosterPlayer | undefined,
      ): Effect.Effect<NonNullable<PlayersData["players"][number]["scoringContext"]>> =>
        Effect.gen(function* () {
          if (league === undefined) {
            return {
              status: "unsupported" as const,
              detail: "League scoring context is not available for this request.",
            };
          }
          const positionType = player?.positionType;
          const relevant = league.statCategories.filter(
            (category) =>
              positionType === undefined ||
              category.positionTypes.length === 0 ||
              category.positionTypes.includes(positionType),
          );
          const refs = yield* Effect.forEach(
            relevant,
            (category) =>
              statRefFor(category.statId).pipe(
                Effect.map((ref) => {
                  dictionaryStatIds.add(category.statId);
                  return ref;
                }),
              ),
            { concurrency: 1 },
          );
          return { status: "available" as const, categories: refs };
        });
      const playerRows = yield* Effect.forEach(
        valid,
        (row) =>
          Effect.gen(function* () {
            const rosterPlayer = rosterByKey.get(row.providerPlayerKey);
            const detail = detailsByKey.get(row.providerPlayerKey);
            const transactionIdentity = transactionIdentities.get(row.providerPlayerKey);
            const identity =
              playerIdentity(rosterPlayer) ??
              playerIdentity(detail) ??
              transactionIdentity?.identity;
            const eligiblePositions =
              rosterPlayer !== undefined
                ? rosterPlayer.eligiblePositions
                : (detail?.eligiblePositions ?? transactionIdentity?.eligiblePositions);
            const eligibility = eligiblePositions === undefined ? undefined : { eligiblePositions };
            const availability = !groups.includes("availability")
              ? undefined
              : rosterPlayer !== undefined
                ? { rosterStatus: "rostered" as const, injury: injuryOf(rosterPlayer) }
                : detail === undefined
                  ? undefined
                  : { rosterStatus: detail.rosterStatus, injury: { reported: false as const } };
            const actualStats = !groups.includes("actual_stats")
              ? undefined
              : detailsUnsupported !== undefined
                ? { status: "unsupported" as const, detail: detailsUnsupported }
                : detail?.actual === undefined
                  ? {
                      status: "unsupported" as const,
                      detail: "The provider reported no actual statistics for this player.",
                    }
                  : yield* statGroup(detail.actual);
            const projections = !groups.includes("projections")
              ? undefined
              : context.provider.capabilities.publishesProjections &&
                  detail?.projected !== undefined
                ? yield* statGroup(detail.projected)
                : {
                    status: "unsupported" as const,
                    detail: limitation(context.provider, "projections"),
                  };
            const scoringContext = !groups.includes("scoring_context")
              ? undefined
              : yield* scoringFor(rosterPlayer);
            if (actualStats?.status === "available") {
              for (const stat of [
                ...(detail?.actual?.stats ?? []),
                ...(detail?.actual?.notAggregated ?? []),
              ]) {
                dictionaryStatIds.add(stat.statId);
              }
            }
            if (identity === undefined) {
              failures.push({
                code: "player_identity_unavailable",
                resource: row.ref,
                message: "The provider did not return identity data for this player.",
              });
            }
            return {
              player: row.ref,
              ...(identity === undefined ? {} : { identity }),
              ...(eligibility === undefined ? {} : { eligibility }),
              ...(availability === undefined ? {} : { availability }),
              ...(actualStats === undefined ? {} : { actualStats }),
              ...(projections === undefined ? {} : { projections }),
              ...(scoringContext === undefined ? {} : { scoringContext }),
            };
          }),
        { concurrency: 1 },
      );
      const definitions = yield* Effect.forEach(
        [...dictionaryStatIds].sort((left, right) => left - right),
        (statId) =>
          statRefFor(statId).pipe(Effect.map((ref) => dictionaryEntry(statId, ref, league))),
        { concurrency: 1 },
      );
      const hasData = playerRows.some(
        (row) =>
          row.identity !== undefined ||
          row.actualStats?.status === "available" ||
          row.scoringContext?.status === "available",
      );
      const status: QueryStatus = valid.length === 0 ? "failed" : hasData ? "ok" : "unsupported";
      const fingerprintValue = yield* queryFingerprint(
        [
          "players",
          `team=${input.team}`,
          `period=${statPeriodKey(requestedPeriod)}`,
          `groups=${[...groups].sort().join(",")}`,
          `players=${input.players.join(",")}`,
          "order=request",
        ].join("|"),
      );
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      const base: Omit<PlayersData, "players" | "page"> = {
        status,
        team,
        period: requestedPeriod,
        periodSupport: periodSupportOf(context, context.owned.team.sport),
        dictionary: definitions,
        coverage: coverageEntries,
        failures,
        budget: queryBudget,
      };
      return yield* fitPage({
        schema: PlayersSchema,
        rows: playerRows,
        offset,
        limit: input.limit ?? 25,
        resource: "players",
        groups,
        remedy: "Select fewer player groups or fewer player references.",
        build: (pageRows, page) => ({ ...base, players: [...pageRows], page }),
        makeNext: (nextOffset) =>
          tokens.sealCursor({ userId, fingerprint: fingerprintValue, offset: nextOffset, now }),
        recordLabel: (row) => row.player,
      });
    });

    const getMatchups = Effect.fn("FantasyQueries.getMatchups")(function* (
      userId: UserId,
      input: GetMatchupsInput,
    ) {
      const context = yield* loadContext(userId, input.team);
      const team = queryTeam(context.owned);
      const fetchedAt = yield* DateTime.now;
      const leagueOutcome = yield* readLeague(context);
      if (
        leagueOutcome._tag === "ok" &&
        withinPeriodWindow(leagueOutcome.value.periodWindow, input.period) === false
      ) {
        return yield* QuerySelectionInvalid.make({
          detail: "The requested period is outside the linked league's season.",
        });
      }
      if (leagueOutcome._tag === "ok" && leagueOutcome.value.periodWindow === undefined) {
        return matchupsUnavailable(
          team,
          input.period,
          fetchedAt,
          leagueOutcome,
          "This league format publishes no scoring-week matchups.",
        );
      }
      const outcome = yield* readOutcome(
        context,
        "matchups",
        context.provider.readMatchups({
          ...providerIdentity(context),
          providerLeagueKey: context.owned.team.providerLeagueKey,
          period: input.period,
        }),
      );
      if (outcome._tag !== "ok") {
        return matchupsWithoutData(team, input.period, fetchedAt, outcome);
      }
      const statRefs = new Map<number, StatRef>();
      const scoringNames = categoryNames(
        leagueOutcome._tag === "ok" ? leagueOutcome.value : undefined,
      );
      const matchups = yield* Effect.forEach(
        outcome.value,
        (matchup) =>
          Effect.gen(function* () {
            const home = yield* counterpartyRef(context, tokens, matchup.home.providerTeamKey);
            const away = yield* counterpartyRef(context, tokens, matchup.away.providerTeamKey);
            const categoryWinners = yield* Effect.forEach(
              matchup.categoryWinners,
              (winner) =>
                Effect.gen(function* () {
                  const winnerRef =
                    winner.winnerProviderTeamKey === undefined
                      ? undefined
                      : yield* counterpartyRef(context, tokens, winner.winnerProviderTeamKey);
                  return {
                    stat: yield* statRefFor(context, tokens, statRefs, winner.statId),
                    ...(winnerRef === undefined ? {} : { winner: winnerRef }),
                    tied: winner.isTied,
                  };
                }),
              { concurrency: 1 },
            );
            return {
              period: matchup.period,
              home: {
                team: home,
                name: matchup.home.name,
                points: matchup.home.points,
                projectedPoints: matchup.home.projectedPoints,
                winProbability: matchup.home.winProbability,
                ...(matchup.home.remainingGames === undefined
                  ? {}
                  : { remainingGames: matchup.home.remainingGames }),
                ...(matchup.home.categoryTotals.length === 0
                  ? {}
                  : {
                      categories: yield* categoryValueRows(
                        context,
                        tokens,
                        statRefs,
                        labelledCategories(matchup.home.categoryTotals, scoringNames, new Set()),
                        matchupValueMissing,
                      ),
                    }),
              },
              away: {
                team: away,
                name: matchup.away.name,
                points: matchup.away.points,
                projectedPoints: matchup.away.projectedPoints,
                winProbability: matchup.away.winProbability,
                ...(matchup.away.remainingGames === undefined
                  ? {}
                  : { remainingGames: matchup.away.remainingGames }),
                ...(matchup.away.categoryTotals.length === 0
                  ? {}
                  : {
                      categories: yield* categoryValueRows(
                        context,
                        tokens,
                        statRefs,
                        labelledCategories(matchup.away.categoryTotals, scoringNames, new Set()),
                        matchupValueMissing,
                      ),
                    }),
              },
              ...(matchup.status === undefined ? {} : { status: matchup.status }),
              ...(matchup.isPlayoffs === undefined ? {} : { isPlayoffs: matchup.isPlayoffs }),
              ...(matchup.isConsolation === undefined
                ? {}
                : { isConsolation: matchup.isConsolation }),
              ...(matchup.isTied === undefined ? {} : { isTied: matchup.isTied }),
              ...(matchup.weekStart === undefined ? {} : { weekStart: matchup.weekStart }),
              ...(matchup.weekEnd === undefined ? {} : { weekEnd: matchup.weekEnd }),
              ...(categoryWinners.length === 0 ? {} : { categoryWinners }),
            };
          }),
        { concurrency: 1 },
      );
      const fingerprintValue = yield* queryFingerprint(
        `matchups|team=${input.team}|period=${String(input.period.week)}|order=provider`,
      );
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      const base: Omit<MatchupsData, "matchups" | "page"> = {
        status: "ok",
        team,
        period: input.period,
        schedule: matchupSchedule(context.provider, outcome.value),
        coverage: [
          leagueCoverage(leagueOutcome, fetchedAt),
          coverage("matchups", "matchups", fetchedAt, input.period),
        ],
        failures: leagueFailure(leagueOutcome),
        budget: queryBudget,
      };
      return yield* fitPage({
        schema: MatchupsSchema,
        rows: matchups,
        offset,
        limit: input.limit ?? 25,
        resource: "matchups",
        groups: undefined,
        remedy: "Request a smaller limit.",
        build: (pageRows, page) => ({ ...base, matchups: [...pageRows], page }),
        makeNext: (nextOffset) =>
          tokens.sealCursor({ userId, fingerprint: fingerprintValue, offset: nextOffset, now }),
        recordLabel: (row) => row.home.team,
      });
    });

    const getTransactions = Effect.fn("FantasyQueries.getTransactions")(function* (
      userId: UserId,
      input: GetTransactionsInput,
    ) {
      const since = input.since === undefined ? undefined : DateTime.formatIso(input.since);
      const until = input.until === undefined ? undefined : DateTime.formatIso(input.until);
      if (since !== undefined && until !== undefined && since > until) {
        return yield* QuerySelectionInvalid.make({
          detail: "`since` must not be later than `until`.",
        });
      }
      const context = yield* loadContext(userId, input.team);
      const team = queryTeam(context.owned);
      const fetchedAt = yield* DateTime.now;
      const scope = input.scope ?? "league";
      const outcome = yield* readOutcome(
        context,
        "transactions",
        context.provider.readTransactions({
          ...providerIdentity(context),
          providerLeagueKey: context.owned.team.providerLeagueKey,
          providerTeamKey: scope === "team" ? context.owned.team.providerTeamKey : undefined,
          limit: 50,
        }),
      );
      if (outcome._tag !== "ok") {
        return transactionsWithoutData(team, fetchedAt, outcome);
      }
      const fetched = outcome.value;
      const filtered = fetched.filter(
        (transaction) =>
          (since === undefined || transaction.occurredAt >= since) &&
          (until === undefined || transaction.occurredAt <= until),
      );
      const window: TransactionWindow = {
        fetched: fetched.length,
        truncated: fetched.length >= 50,
        ...(fetched[0] === undefined ? {} : { latest: fetched[0].occurredAt }),
        ...(fetched.at(-1) === undefined ? {} : { earliest: fetched.at(-1)?.occurredAt }),
      };
      const exhausted =
        since !== undefined &&
        window.truncated &&
        window.earliest !== undefined &&
        since < window.earliest;
      const coverageEntries = [
        exhausted
          ? degradedCoverage(
              "transactions",
              "transactions",
              fetchedAt,
              "The requested range starts before the most recent transaction window the provider returns; older moves are not included.",
            )
          : coverage("transactions", "transactions", fetchedAt),
      ];
      const leagueKey = context.owned.team.providerLeagueKey;
      const teamKeys = [
        ...new Set(
          filtered.flatMap((transaction) => [
            ...transaction.teams.map((transactionTeam) => transactionTeam.providerTeamKey),
            ...transaction.players.flatMap((player) =>
              [player.movement.from, player.movement.to].flatMap((movementTeam) =>
                movementTeam === undefined ? [] : [movementTeam.providerTeamKey],
              ),
            ),
            ...transaction.picks.flatMap((pick) =>
              [pick.from, pick.to, pick.original].flatMap((pickTeam) =>
                pickTeam === undefined ? [] : [pickTeam.providerTeamKey],
              ),
            ),
            ...(transaction.parties?.entries ?? []).map((party) => party.team.providerTeamKey),
          ]),
        ),
      ];
      const playerKeys = filtered.flatMap((transaction) =>
        transaction.players.map((player) => player.providerPlayerKey),
      );
      const teamRefs = yield* tokens.sealCounterpartyRefs({ userId, leagueKey, teamKeys });
      const playerRefs = yield* tokens.sealPlayerRefs({ userId, leagueKey, playerKeys });
      const teamRefByKey = new Map(
        teamKeys.map((key, index) => [key, EffectArray.getUnsafe(teamRefs, index)] as const),
      );
      const teamRef = (providerTeamKey: string): CounterpartyRef => {
        const ref = teamRefByKey.get(providerTeamKey);
        if (ref === undefined) {
          throw new Error("Every transaction team key must seal a counterparty reference.");
        }
        return ref;
      };
      const transactionTeamView = (
        transactionTeam: ProviderTransactionTeam,
      ): { team: CounterpartyRef; name?: string } => ({
        team: teamRef(transactionTeam.providerTeamKey),
        ...(transactionTeam.name === undefined ? {} : { name: transactionTeam.name }),
      });
      let playerOffset = 0;
      const transactions = filtered.map((transaction) => {
        const players = EffectArray.map(
          EffectArray.zip(
            transaction.players,
            playerRefs.slice(playerOffset, playerOffset + transaction.players.length),
          ),
          ([player, ref]) => ({
            player: ref,
            movement: {
              kind: player.movement.kind,
              from:
                player.movement.from === undefined
                  ? null
                  : transactionTeamView(player.movement.from),
              to: player.movement.to === undefined ? null : transactionTeamView(player.movement.to),
            },
            ...(player.name === undefined ? {} : { name: player.name }),
            ...(player.primaryPosition === undefined
              ? {}
              : { primaryPosition: player.primaryPosition }),
            ...(player.displayPosition === undefined
              ? {}
              : { displayPosition: player.displayPosition }),
            ...(player.eligiblePositions === undefined
              ? {}
              : { eligiblePositions: [...player.eligiblePositions] }),
            ...(player.proTeam === undefined ? {} : { proTeam: player.proTeam }),
          }),
        );
        playerOffset += transaction.players.length;
        return {
          occurredAt: transaction.occurredAt,
          type: transaction.type,
          ...(transaction.status === undefined ? {} : { status: transaction.status }),
          completeness:
            transaction.incomplete === undefined
              ? { status: "complete" as const }
              : {
                  status: "incomplete" as const,
                  code: transaction.incomplete.code,
                  detail: transaction.incomplete.detail,
                },
          ...(transaction.parties === undefined
            ? {}
            : {
                parties: {
                  source: transaction.parties.source,
                  entries: transaction.parties.entries.map((party) => ({
                    role: party.role,
                    ...transactionTeamView(party.team),
                  })),
                },
              }),
          teams: transaction.teams.map(transactionTeamView),
          picks: transaction.picks.map((pick) => ({
            round: pick.round,
            from: pick.from === undefined ? null : transactionTeamView(pick.from),
            to: pick.to === undefined ? null : transactionTeamView(pick.to),
            original: pick.original === undefined ? null : transactionTeamView(pick.original),
          })),
          players,
        };
      });
      const fingerprintValue = yield* queryFingerprint(
        `transactions|team=${input.team}|scope=${scope}|since=${since ?? ""}|until=${until ?? ""}|order=provider`,
      );
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      const base: Omit<TransactionsData, "transactions" | "page"> = {
        status: "ok",
        team,
        window,
        coverage: coverageEntries,
        failures: exhausted
          ? [
              {
                code: "transaction_window_truncated",
                resource: "transactions",
                message:
                  "The provider returns only its most recent transaction window, so this date range may omit older moves.",
              },
            ]
          : [],
        budget: queryBudget,
      };
      return yield* fitPage({
        schema: TransactionsSchema,
        rows: transactions,
        offset,
        limit: input.limit ?? 25,
        resource: "transactions",
        groups: undefined,
        remedy: "Narrow the `since`/`until` range or set `scope` to `team`, then request again.",
        build: (pageRows, page) => ({ ...base, transactions: [...pageRows], page }),
        makeNext: (nextOffset) =>
          tokens.sealCursor({ userId, fingerprint: fingerprintValue, offset: nextOffset, now }),
        recordLabel: (row) => row.occurredAt,
      });
    });

    const getTeamSummary = Effect.fn("FantasyQueries.getTeamSummary")(function* (
      userId: UserId,
      input: GetTeamSummaryInput,
    ) {
      const context = yield* loadContext(userId, input.team);
      const team = queryTeam(context.owned);
      const fetchedAt = yield* DateTime.now;
      const groups = [...new Set(input.groups ?? defaultSummaryGroups)];
      if (groups.length === 0) {
        return yield* QuerySelectionInvalid.make({
          detail:
            "Select at least one summary group: league, standings, categories, matchup, or roster.",
        });
      }
      const includes = (group: SummaryGroup): boolean => groups.includes(group);
      const coverageEntries: QueryCoverage[] = [];
      const failures: QueryFailure[] = [];
      const statRefs = new Map<number, StatRef>();

      const leagueOutcome = yield* readLeague(context);
      const league = leagueOutcome._tag === "ok" ? leagueOutcome.value : undefined;
      const leagueSection: TeamSummaryData["league"] = !includes("league")
        ? undefined
        : leagueOutcome._tag === "ok"
          ? { status: "available", ...leagueOverview(leagueOutcome.value) }
          : leagueOutcome._tag === "unsupported"
            ? { status: "unsupported", detail: leagueOutcome.detail }
            : { status: "degraded", detail: leagueOutcome.failure.message };
      coverageEntries.push(
        leagueOutcome._tag === "ok"
          ? coverage("league", "league_settings", fetchedAt)
          : leagueOutcome._tag === "unsupported"
            ? unsupportedCoverage("league", "league_settings", fetchedAt, leagueOutcome.detail)
            : degradedCoverage(
                "league",
                "league_settings",
                fetchedAt,
                leagueOutcome.failure.message,
              ),
      );
      if (leagueOutcome._tag === "failed") {
        failures.push(leagueOutcome.failure);
      }

      const standingsNeeded = includes("standings") || includes("categories");
      const standingsOutcome = standingsNeeded
        ? yield* readOutcome(
            context,
            "standings",
            context.provider.readStandings({
              ...providerIdentity(context),
              providerLeagueKey: context.owned.team.providerLeagueKey,
            }),
          )
        : undefined;
      const scoringNames = categoryNames(league);
      const standingTable =
        standingsOutcome?._tag === "ok"
          ? yield* standingRows(
              context,
              tokens,
              standingsOutcome.value,
              league === undefined ? undefined : scoringNames,
            )
          : { rows: [] as ReadonlyArray<StandingRow>, omittedCategoryCount: 0 };
      const rows = standingTable.rows;
      const current = rows.find((row) => row.current);
      if (standingsOutcome !== undefined) {
        coverageEntries.push(
          standingsOutcome._tag === "ok"
            ? coverage("standings", "standings", fetchedAt)
            : standingsOutcome._tag === "unsupported"
              ? unsupportedCoverage("standings", "standings", fetchedAt, standingsOutcome.detail)
              : degradedCoverage(
                  "standings",
                  "standings",
                  fetchedAt,
                  standingsOutcome.failure.message,
                ),
        );
        if (standingsOutcome._tag === "failed") {
          failures.push(standingsOutcome.failure);
        }
      }
      const standingsDetail =
        standingsOutcome === undefined
          ? "The standings group was not requested."
          : standingsOutcome._tag === "ok"
            ? "The provider standings did not include this team."
            : standingsOutcome._tag === "failed"
              ? standingsOutcome.failure.message
              : standingsOutcome.detail;
      const standingSection: TeamSummaryData["standing"] = !includes("standings")
        ? undefined
        : current === undefined
          ? { status: "unsupported", detail: standingsDetail }
          : {
              status: "available",
              rank: current.rank,
              ...(current.playoffSeed === undefined ? {} : { playoffSeed: current.playoffSeed }),
              points: current.points,
              gamesBack: current.gamesBack,
              pointsBack: current.pointsBack,
              pointsFor: current.pointsFor,
              pointsAgainst: current.pointsAgainst,
              ...(current.streak === undefined ? {} : { streak: current.streak }),
            };
      const recordSection: TeamSummaryData["record"] = !includes("standings")
        ? undefined
        : current?.record === undefined
          ? {
              status: "unsupported",
              detail:
                current === undefined
                  ? standingsDetail
                  : "This league format publishes a rank and season points but no win–loss record.",
            }
          : { status: "available", ...current.record };
      const unlabelledDetail =
        "The league scoring categories could not be read, so standings categories cannot be labelled.";
      const categoryTotals: TeamSummaryData["categoryTotals"] = !includes("categories")
        ? undefined
        : current === undefined || !hasPublishedCategoryValue(current.categories ?? [])
          ? {
              status: "unsupported",
              detail:
                current === undefined
                  ? standingsDetail
                  : league === undefined
                    ? unlabelledDetail
                    : "The provider published no season category totals for this league format.",
            }
          : {
              status: "available",
              values: [...(current.categories ?? [])],
              omittedCategories: omittedCategories(standingTable.omittedCategoryCount),
            };
      const categoryPoints: TeamSummaryData["categoryPoints"] = !includes("categories")
        ? undefined
        : current === undefined || !hasPublishedCategoryValue(current.categoryPoints ?? [])
          ? {
              status: "unsupported",
              detail:
                current === undefined
                  ? standingsDetail
                  : league === undefined
                    ? unlabelledDetail
                    : league.format === "rotisserie"
                      ? rotisseriePointsMissing
                      : "The provider publishes rotisserie category points only for rotisserie leagues.",
            }
          : {
              status: "available",
              values: [...(current.categoryPoints ?? [])],
              omittedCategories: omittedCategories(standingTable.omittedCategoryCount),
            };
      const standingsSection: TeamSummaryData["standings"] = !includes("standings")
        ? undefined
        : standingsOutcome?._tag === "ok"
          ? {
              status: "available",
              format: league === undefined ? "unknown" : league.format,
              teams: rows.map((row) => ({
                team: row.team,
                name: row.name,
                current: row.current,
                rank: row.rank,
                ...(row.record === undefined
                  ? {}
                  : {
                      wins: row.record.wins,
                      losses: row.record.losses,
                      ties: row.record.ties,
                      percentage: row.record.percentage,
                    }),
                points: row.points,
                gamesBack: row.gamesBack,
                pointsBack: row.pointsBack,
              })),
            }
          : { status: "unsupported", detail: standingsDetail };

      const window = league?.periodWindow;
      const period = currentPeriod(window);
      const readRoster = (
        requested: QueryPeriod | undefined,
      ): Effect.Effect<ReadOutcome<ProviderRoster>> =>
        readOutcome(
          context,
          "roster",
          context.provider.readRoster({
            ...providerIdentity(context),
            providerTeamKey: context.owned.team.providerTeamKey,
            period: providerRosterPeriod(requested),
          }),
        );
      let rosterOutcome: ReadOutcome<ProviderRoster> | undefined;
      if (includes("roster")) {
        rosterOutcome = yield* readRoster(period);
        if (
          rosterOutcome._tag === "failed" &&
          rosterOutcome.failure.code === "period_unavailable"
        ) {
          rosterOutcome = yield* readRoster(undefined);
        }
        if (rosterOutcome._tag === "ok") {
          coverageEntries.push(
            rosterOutcome.value.coverage.type === "week"
              ? coverage("roster", "roster", fetchedAt, {
                  week: rosterOutcome.value.coverage.week,
                })
              : coverage(
                  "roster",
                  "roster",
                  fetchedAt,
                  undefined,
                  `Date-scoped roster for ${rosterOutcome.value.coverage.date}`,
                ),
          );
        } else {
          coverageEntries.push(
            rosterOutcome._tag === "unsupported"
              ? unsupportedCoverage("roster", "roster", fetchedAt, rosterOutcome.detail)
              : degradedCoverage("roster", "roster", fetchedAt, rosterOutcome.failure.message),
          );
          if (rosterOutcome._tag === "failed") {
            failures.push(rosterOutcome.failure);
          }
        }
      }
      const rosterPlayers = rosterOutcome?._tag === "ok" ? rosterOutcome.value.players : [];
      const rosterRefs = yield* tokens.sealPlayerRefs({
        userId,
        leagueKey: context.owned.team.providerLeagueKey,
        playerKeys: rosterPlayers.map((player) => player.providerPlayerKey),
      });
      const rosterRows: ReadonlyArray<TeamSummaryData["roster"][number]> =
        rosterOutcome?._tag !== "ok"
          ? []
          : EffectArray.map(EffectArray.zip(rosterPlayers, rosterRefs), ([player, ref]) => ({
              player: ref,
              name: player.name,
              slot: player.slot,
              primaryPosition: player.primaryPosition,
              proTeam: player.proTeamAbbreviation ?? null,
              injury: {
                reported: player.injuryCode !== undefined || player.injuryDetail !== undefined,
                ...(player.injuryCode === undefined ? {} : { code: player.injuryCode }),
              },
            }));
      const rosterPeriod =
        rosterOutcome?._tag === "ok" && rosterOutcome.value.coverage.type === "week"
          ? { week: rosterOutcome.value.coverage.week }
          : undefined;

      const matchupOutcome =
        !includes("matchup") || period === undefined
          ? undefined
          : yield* readOutcome(
              context,
              "matchups",
              context.provider.readMatchups({
                ...providerIdentity(context),
                providerLeagueKey: context.owned.team.providerLeagueKey,
                period,
              }),
            );
      const findOwnMatchup = (
        entries: ReadonlyArray<ProviderMatchup> | undefined,
      ): ProviderMatchup | undefined =>
        entries?.find(
          (entry) =>
            entry.home.providerTeamKey === context.owned.team.providerTeamKey ||
            entry.away.providerTeamKey === context.owned.team.providerTeamKey,
        );
      const ownSide = (matchup: ProviderMatchup): ProviderTeamScore =>
        matchup.home.providerTeamKey === context.owned.team.providerTeamKey
          ? matchup.home
          : matchup.away;
      const opponentSide = (matchup: ProviderMatchup): ProviderTeamScore =>
        matchup.home.providerTeamKey === context.owned.team.providerTeamKey
          ? matchup.away
          : matchup.home;
      const currentMatchup =
        matchupOutcome?._tag === "ok" ? findOwnMatchup(matchupOutcome.value) : undefined;
      let matchupSection: TeamSummaryData["matchup"];
      if (!includes("matchup")) {
        matchupSection = undefined;
      } else if (period === undefined) {
        matchupSection = {
          status: "unsupported",
          detail:
            league === undefined
              ? "The league's current scoring week could not be read."
              : "This league format publishes no scoring-week matchups.",
        };
      } else if (matchupOutcome === undefined || matchupOutcome._tag !== "ok") {
        matchupSection = {
          status: "unsupported",
          detail:
            matchupOutcome === undefined
              ? "The current matchup was not read."
              : matchupOutcome._tag === "failed"
                ? matchupOutcome.failure.message
                : matchupOutcome.detail,
        };
        if (matchupOutcome?._tag === "failed") {
          failures.push(matchupOutcome.failure);
        }
      } else if (currentMatchup === undefined) {
        matchupSection = {
          status: "unsupported",
          detail: "The provider returned no matchup for this team in the current week.",
        };
      } else {
        const own = ownSide(currentMatchup);
        const opponent = opponentSide(currentMatchup);
        const opponentRef = yield* counterpartyRef(context, tokens, opponent.providerTeamKey);
        matchupSection = {
          status: "available",
          period: currentMatchup.period,
          opponent: { team: opponentRef, name: opponent.name },
          points: own.points,
          opponentPoints: opponent.points,
          projectedPoints: own.projectedPoints,
          opponentProjectedPoints: opponent.projectedPoints,
          ...(own.remainingGames === undefined ? {} : { remainingGames: own.remainingGames }),
          ...(opponent.remainingGames === undefined
            ? {}
            : { opponentRemainingGames: opponent.remainingGames }),
          ...(includes("categories") && own.categoryTotals.length > 0
            ? {
                categories: yield* categoryValueRows(
                  context,
                  tokens,
                  statRefs,
                  labelledCategories(own.categoryTotals, scoringNames, new Set()),
                  matchupValueMissing,
                ),
              }
            : {}),
          ...(includes("categories") && opponent.categoryTotals.length > 0
            ? {
                opponentCategories: yield* categoryValueRows(
                  context,
                  tokens,
                  statRefs,
                  labelledCategories(opponent.categoryTotals, scoringNames, new Set()),
                  matchupValueMissing,
                ),
              }
            : {}),
          ...(currentMatchup.status === undefined ? {} : { statusLabel: currentMatchup.status }),
          ...(currentMatchup.isPlayoffs === undefined
            ? {}
            : { isPlayoffs: currentMatchup.isPlayoffs }),
        };
      }
      if (matchupSection !== undefined) {
        coverageEntries.push(
          matchupSection.status === "available"
            ? coverage("matchups", "matchups", fetchedAt, period)
            : unsupportedCoverage("matchups", "matchups", fetchedAt, matchupSection.detail),
        );
      }

      const scheduleWeek = (
        period: QueryPeriod,
        current: boolean,
        remaining: ProviderRemainingGames,
      ): typeof SummaryScheduleWeek.Type => ({
        period,
        current,
        completed: remaining.completed,
        live: remaining.live,
        remaining: remaining.remaining,
      });
      const currentRemaining =
        currentMatchup === undefined ? undefined : ownSide(currentMatchup).remainingGames;
      let scheduleSection: TeamSummaryData["schedule"];
      if (!includes("matchup")) {
        scheduleSection = undefined;
      } else if (period === undefined) {
        scheduleSection = {
          status: "unsupported",
          detail: "This league format publishes no scoring-week schedule.",
        };
      } else if (currentRemaining === undefined) {
        scheduleSection = {
          status: "unsupported",
          detail: limitation(context.provider, "team_remaining_games"),
        };
      } else {
        const nextPeriod =
          league?.periodWindow === undefined || period.week >= league.periodWindow.end
            ? undefined
            : { week: period.week + 1 };
        const nextOutcome =
          nextPeriod === undefined
            ? undefined
            : yield* readOutcome(
                context,
                "matchups",
                context.provider.readMatchups({
                  ...providerIdentity(context),
                  providerLeagueKey: context.owned.team.providerLeagueKey,
                  period: nextPeriod,
                }),
              );
        const nextMatchup =
          nextOutcome?._tag === "ok" ? findOwnMatchup(nextOutcome.value) : undefined;
        const nextRemaining =
          nextMatchup === undefined ? undefined : ownSide(nextMatchup).remainingGames;
        const nextWeek =
          nextPeriod !== undefined && nextRemaining !== undefined
            ? [scheduleWeek(nextPeriod, false, nextRemaining)]
            : [];
        scheduleSection = {
          status: "available",
          unit: "fantasy_team_player_games",
          weeks: [scheduleWeek(period, true, currentRemaining), ...nextWeek],
          ...(nextPeriod === undefined
            ? { detail: "This is the final scoring week of the season." }
            : nextWeek.length === 0
              ? { detail: "The provider did not publish remaining games for the next week." }
              : {}),
        };
      }
      if (scheduleSection !== undefined) {
        coverageEntries.push(
          scheduleSection.status === "available"
            ? coverage("schedule", "matchups", fetchedAt, period)
            : unsupportedCoverage("schedule", "matchups", fetchedAt, scheduleSection.detail),
        );
      }

      const available =
        (includes("league") && leagueOutcome._tag === "ok") ||
        (standingsNeeded && standingsOutcome?._tag === "ok") ||
        (includes("roster") && rosterOutcome?._tag === "ok") ||
        (includes("matchup") && matchupSection?.status === "available");
      const status: QueryStatus = available ? "ok" : failures.length > 0 ? "failed" : "unsupported";
      const fingerprintValue = yield* queryFingerprint(
        [
          "team_summary",
          `team=${input.team}`,
          `groups=${[...groups].sort().join(",")}`,
          `period=${rosterPeriod === undefined ? "date" : String(rosterPeriod.week)}`,
          "order=slot,player,rank",
        ].join("|"),
      );
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      const base: Omit<TeamSummaryData, "roster" | "page"> = {
        status,
        team,
        ...(rosterPeriod === undefined ? {} : { period: rosterPeriod }),
        ...(leagueSection === undefined ? {} : { league: leagueSection }),
        ...(standingSection === undefined ? {} : { standing: standingSection }),
        ...(recordSection === undefined ? {} : { record: recordSection }),
        ...(categoryTotals === undefined ? {} : { categoryTotals }),
        ...(categoryPoints === undefined ? {} : { categoryPoints }),
        ...(standingsSection === undefined ? {} : { standings: standingsSection }),
        ...(matchupSection === undefined ? {} : { matchup: matchupSection }),
        ...(scheduleSection === undefined ? {} : { schedule: scheduleSection }),
        ...(includes("roster")
          ? {
              probableStarters: {
                status: "unsupported" as const,
                detail: limitation(context.provider, "probable_starters"),
              },
            }
          : {}),
        coverage: coverageEntries,
        failures,
        budget: queryBudget,
      };
      return yield* fitPage({
        schema: TeamSummarySchema,
        rows: includes("roster") ? rosterRows : [],
        offset,
        limit: input.limit ?? 50,
        resource: "team_summary.roster",
        groups: summaryGroups,
        remedy:
          "Request fewer summary groups so the roster page fits. The roster pages with the returned cursor; available groups are league, standings, categories, matchup, and roster.",
        build: (pageRows, page) => ({ ...base, roster: [...pageRows], page }),
        makeNext: (nextOffset) =>
          tokens.sealCursor({ userId, fingerprint: fingerprintValue, offset: nextOffset, now }),
        recordLabel: () => undefined,
      });
    });

    return FantasyQueries.of({
      listTeams,
      getCalendar,
      getLeague,
      getRosters,
      searchPlayers,
      getPlayers,
      getMatchups,
      getTransactions,
      getTeamSummary,
    });
  }),
);

function statRefFor(
  context: TeamContext,
  tokens: QueryTokens["Service"],
  cache: Map<number, StatRef>,
  statId: number,
): Effect.Effect<StatRef> {
  return Effect.gen(function* () {
    const existing = cache.get(statId);
    if (existing !== undefined) {
      return existing;
    }
    const ref = yield* tokens.statRef({
      leagueKey: context.owned.team.providerLeagueKey,
      statId,
    });
    cache.set(statId, ref);
    return ref;
  });
}

const seasonTotalMissing = "The provider published no season total for this category.";
const rotisseriePointsMissing = "The provider published no rotisserie points for this category.";
const matchupValueMissing =
  "The provider published no value for this category in the scoring week.";

type LabelledStat = {
  readonly statId: number;
  readonly name: string;
  readonly value: number | null;
};

function categoryNames(league: ProviderLeagueSettings | undefined): ReadonlyMap<number, string> {
  return new Map(
    (league?.statCategories ?? []).map((category): [number, string] => [
      category.statId,
      category.name,
    ]),
  );
}

function categoryValueRows(
  context: TeamContext,
  tokens: QueryTokens["Service"],
  cache: Map<number, StatRef>,
  stats: ReadonlyArray<LabelledStat>,
  missingDetail: string,
): Effect.Effect<ReadonlyArray<CategoryValue>> {
  return Effect.forEach(
    stats,
    (entry) =>
      statRefFor(context, tokens, cache, entry.statId).pipe(
        Effect.map((stat): CategoryValue =>
          entry.value === null
            ? { stat, name: entry.name, status: "not_published", detail: missingDetail }
            : { stat, name: entry.name, status: "published", value: entry.value },
        ),
      ),
    { concurrency: 1 },
  );
}

function categoryAvailability(
  rows: ReadonlyArray<StandingRow>,
  select: (row: StandingRow) => ReadonlyArray<CategoryValue>,
  detail: string,
): { readonly status: "available" } | { readonly status: "unsupported"; readonly detail: string } {
  return rows.some((row) => select(row).some((entry) => entry.status === "published"))
    ? { status: "available" }
    : { status: "unsupported", detail };
}

function hasPublishedCategoryValue(values: ReadonlyArray<CategoryValue>): boolean {
  return values.some((entry) => entry.status === "published");
}

function omittedCategories(count: number): { readonly count: number; readonly detail: string } {
  return {
    count,
    detail:
      count === 0
        ? "Every category the provider published has a league scoring definition."
        : `${String(count)} provider stat ids in the standings have no league scoring definition and are omitted because they cannot be named.`,
  };
}

function standingsData(
  outcome: ReadOutcome<ProviderStandings>,
  rows: ReadonlyArray<StandingRow>,
  omittedCategoryCount: number,
  format: ProviderLeagueSettings["format"],
  presentation: StandingDetail,
): NonNullable<LeagueData["standings"]> {
  if (outcome._tag !== "ok") {
    return {
      status: "unsupported",
      detail: outcome._tag === "failed" ? outcome.failure.message : outcome.detail,
    };
  }
  const detailNote =
    presentation === "compact"
      ? "The compact form carries every team's rank, points, and record. Ask for `standingsDetail: detailed` to add per-category season totals and rotisserie points; that form pages teams."
      : "Per-category totals and points are included, so this form pages teams; request the `standings` group alone for the most rows per page.";
  if (presentation === "compact") {
    return {
      status: "available",
      format,
      presentation,
      detailNote,
      teams: [...rows],
    };
  }
  return {
    status: "available",
    format,
    presentation,
    detailNote,
    categoryTotals: categoryAvailability(
      rows,
      (row) => row.categories ?? [],
      "The provider published no season category totals for this league format.",
    ),
    categoryPoints: categoryAvailability(
      rows,
      (row) => row.categoryPoints ?? [],
      format === "rotisserie"
        ? rotisseriePointsMissing
        : "The provider publishes rotisserie category points only for rotisserie leagues.",
    ),
    omittedCategories: omittedCategories(omittedCategoryCount),
    teams: [...rows],
  };
}

function standingRows(
  context: TeamContext,
  tokens: QueryTokens["Service"],
  standings: ProviderStandings,
  scoring: ReadonlyMap<number, string> | undefined,
): Effect.Effect<{
  readonly rows: ReadonlyArray<StandingRow>;
  readonly omittedCategoryCount: number;
}> {
  return Effect.gen(function* () {
    const refs = yield* tokens.sealCounterpartyRefs({
      userId: context.userId,
      leagueKey: context.owned.team.providerLeagueKey,
      teamKeys: standings.teams.map((standing) => standing.providerTeamKey),
    });
    const statRefs = new Map<number, StatRef>();
    const omitted = new Set<number>();
    const rows = yield* Effect.forEach(
      EffectArray.zip(standings.teams, refs),
      ([standing, team]) =>
        Effect.gen(function* () {
          return {
            team,
            name: standing.name,
            current: standing.providerTeamKey === context.owned.team.providerTeamKey,
            rank: standing.rank,
            ...(standing.playoffSeed === null ? {} : { playoffSeed: standing.playoffSeed }),
            ...(standing.record === undefined ? {} : { record: standing.record }),
            gamesBack: standing.gamesBack,
            pointsBack: standing.pointsBack,
            points: standing.points,
            pointsFor: standing.pointsFor,
            pointsAgainst: standing.pointsAgainst,
            ...(standing.streak === undefined ? {} : { streak: standing.streak }),
            ...(scoring === undefined
              ? {}
              : {
                  categories: yield* categoryValueRows(
                    context,
                    tokens,
                    statRefs,
                    labelledCategories(standing.categoryTotals, scoring, omitted),
                    seasonTotalMissing,
                  ),
                  categoryPoints: yield* categoryValueRows(
                    context,
                    tokens,
                    statRefs,
                    labelledCategories(standing.categoryPoints, scoring, omitted),
                    rotisseriePointsMissing,
                  ),
                }),
          };
        }),
      { concurrency: 1 },
    );
    return { rows, omittedCategoryCount: omitted.size };
  });
}

function labelledCategories(
  stats: ReadonlyArray<ProviderStatValue>,
  scoring: ReadonlyMap<number, string>,
  omitted: Set<number>,
): ReadonlyArray<LabelledStat> {
  const labelled: Array<LabelledStat> = [];
  for (const entry of stats) {
    const name = scoring.get(entry.statId);
    if (name === undefined) {
      omitted.add(entry.statId);
      continue;
    }
    labelled.push({ statId: entry.statId, name, value: entry.value });
  }
  return labelled;
}

function draftPickRows(
  context: TeamContext,
  tokens: QueryTokens["Service"],
  picks: ReadonlyArray<ProviderDraftPick>,
  leagueTeams: ReadonlyArray<ProviderLeagueTeam>,
): Effect.Effect<ReadonlyArray<DraftPick>> {
  return Effect.gen(function* () {
    const leagueKey = context.owned.team.providerLeagueKey;
    const teamKeys = [...new Set(picks.map((pick) => pick.providerTeamKey))];
    const teamRefs = yield* tokens.sealCounterpartyRefs({
      userId: context.userId,
      leagueKey,
      teamKeys,
    });
    const playerRefs = yield* tokens.sealPlayerRefs({
      userId: context.userId,
      leagueKey,
      playerKeys: picks.map((pick) => pick.providerPlayerKey),
    });
    const teamRefByKey = new Map(
      teamKeys.map((key, index) => [key, EffectArray.getUnsafe(teamRefs, index)] as const),
    );
    const teamNameByKey = new Map(leagueTeams.map((team) => [team.providerTeamKey, team.name]));
    return picks.map((pick, index) => {
      const team = teamRefByKey.get(pick.providerTeamKey);
      if (team === undefined) {
        throw new Error("Every draft pick team key must seal a counterparty reference.");
      }
      const teamName = teamNameByKey.get(pick.providerTeamKey);
      return {
        round: pick.round,
        pick: pick.pick,
        team,
        ...(teamName === undefined ? {} : { teamName }),
        player: EffectArray.getUnsafe(playerRefs, index),
      };
    });
  });
}

function draftHistoryData(
  outcome: ReadOutcome<ReadonlyArray<ProviderDraftPick>>,
  picks: ReadonlyArray<DraftPick>,
  draftStatus: string | undefined,
): NonNullable<LeagueData["draftHistory"]> {
  if (outcome._tag !== "ok") {
    return {
      status: "unsupported",
      detail: outcome._tag === "failed" ? outcome.failure.message : outcome.detail,
    };
  }
  return {
    status: "available",
    ...(draftStatus === undefined ? {} : { draftStatus }),
    detailNote:
      "These are the picks the provider publishes for this league's draft. This is draft history, not current or future pick ownership: the provider publishes no pick-ownership read, and a traded pick appears on the trade transaction that moved it.",
    picks: [...picks],
  };
}

function queryTeam(owned: OwnedTeam): QueryTeam {
  const team = owned.team;
  return {
    id: team.id,
    name: team.name,
    provider: team.provider,
    league: team.league,
    sport: team.sport,
    season: team.season,
  };
}

function coverage(
  resource: string,
  source: string,
  fetchedAt: DateTime.Utc,
  period?: QueryPeriod,
  detail?: string,
): QueryCoverage {
  return {
    resource,
    status: "available",
    source,
    fetchedAt,
    ...(period === undefined ? {} : { period }),
    ...(detail === undefined ? {} : { detail }),
  };
}

function unsupportedCoverage(
  resource: string,
  source: string,
  fetchedAt: DateTime.Utc,
  detail?: string,
): QueryCoverage {
  return {
    resource,
    status: "unsupported",
    source,
    fetchedAt,
    ...(detail === undefined ? {} : { detail }),
  };
}

function degradedCoverage(
  resource: string,
  source: string,
  fetchedAt: DateTime.Utc,
  detail: string,
): QueryCoverage {
  return { resource, status: "degraded", source, fetchedAt, detail };
}

function leagueCoverage(
  outcome: ReadOutcome<ProviderLeagueSettings>,
  fetchedAt: DateTime.Utc,
): QueryCoverage {
  switch (outcome._tag) {
    case "ok":
      return coverage("league", "league_settings", fetchedAt);
    case "unsupported":
      return unsupportedCoverage("league", "league_settings", fetchedAt);
    case "failed":
      return degradedCoverage("league", "league_settings", fetchedAt, outcome.failure.message);
  }
}

function leagueFailure(outcome: ReadOutcome<ProviderLeagueSettings>): QueryFailure[] {
  return outcome._tag === "failed" ? [outcome.failure] : [];
}

function emptyPage(): QueryPage {
  return { returned: 0, complete: true, remaining: 0 };
}

function calendarWithoutWeekWindow(
  provider: TeamContext["provider"],
  team: QueryTeam,
  fetchedAt: DateTime.Utc,
  outcome: ReadOutcome<ProviderLeagueSettings>,
): CalendarData {
  const failed = outcome._tag === "failed";
  return {
    status: failed ? "failed" : "unsupported",
    team,
    periods: [],
    ...(outcome._tag === "ok"
      ? {
          dates: {
            ...(outcome.value.startDate === undefined ? {} : { start: outcome.value.startDate }),
            ...(outcome.value.endDate === undefined ? {} : { end: outcome.value.endDate }),
          },
        }
      : {}),
    historical: {
      status: "unsupported",
      detail: limitation(provider, "historical_seasons"),
    },
    coverage: [
      leagueCoverage(outcome, fetchedAt),
      ...(outcome._tag === "ok"
        ? [
            {
              resource: "calendar",
              status: "unsupported" as const,
              source: "league_settings",
              fetchedAt,
              detail:
                "The provider reported no scoring-week window for this league, so week-scoped periods are unsupported.",
            },
          ]
        : []),
    ],
    failures: leagueFailure(outcome),
    page: emptyPage(),
    budget: queryBudget,
  };
}

function leagueWithoutData(
  team: QueryTeam,
  groups: ReadonlyArray<LeagueGroup>,
  fetchedAt: DateTime.Utc,
  outcome: ReadOutcome<ProviderLeagueSettings>,
): LeagueData {
  return {
    status: outcome._tag === "unsupported" ? "unsupported" : "failed",
    team,
    scoring: [],
    ...(groups.includes("standings")
      ? {
          standings: {
            status: "unsupported" as const,
            detail:
              outcome._tag === "failed"
                ? outcome.failure.message
                : "The provider did not publish league settings, so standings could not be read.",
          },
        }
      : {}),
    ...(groups.includes("draft_history")
      ? {
          draftHistory: {
            status: "unsupported" as const,
            detail:
              outcome._tag === "failed"
                ? outcome.failure.message
                : "The provider did not publish league settings, so draft history could not be read.",
          },
        }
      : {}),
    coverage: [
      leagueCoverage(outcome, fetchedAt),
      ...(groups.includes("standings")
        ? [unsupportedCoverage("standings", "standings", fetchedAt)]
        : []),
      ...(groups.includes("draft_history")
        ? [unsupportedCoverage("draft_history", "draft_results", fetchedAt)]
        : []),
    ],
    failures: leagueFailure(outcome),
    page: emptyPage(),
    budget: queryBudget,
  };
}

function rosterWithoutData(
  provider: TeamContext["provider"],
  team: QueryTeam,
  period: QueryPeriod | undefined,
  fetchedAt: DateTime.Utc,
  outcome: ReadOutcome<ProviderRoster>,
  league: ReadOutcome<ProviderLeagueSettings>,
): RosterData {
  return {
    status: outcome._tag === "unsupported" ? "unsupported" : "failed",
    team,
    ...(period === undefined ? {} : { period }),
    playerSchedule: {
      status: "unsupported",
      detail: limitation(provider, "player_schedule"),
    },
    players: [],
    coverage: [
      leagueCoverage(league, fetchedAt),
      outcome._tag === "ok"
        ? coverage("roster", "roster", fetchedAt)
        : unsupportedCoverage("roster", "roster", fetchedAt),
    ],
    failures: [...leagueFailure(league), ...(outcome._tag === "failed" ? [outcome.failure] : [])],
    page: emptyPage(),
    budget: queryBudget,
  };
}

function searchWithoutData(
  team: QueryTeam,
  fetchedAt: DateTime.Utc,
  outcome: ReadOutcome<unknown>,
): SearchPlayersData {
  return {
    status: outcome._tag === "unsupported" ? "unsupported" : "failed",
    team,
    players: [],
    coverage: [
      outcome._tag === "ok"
        ? coverage("players", "player_search", fetchedAt)
        : unsupportedCoverage("players", "player_search", fetchedAt),
    ],
    failures: outcome._tag === "failed" ? [outcome.failure] : [],
    page: emptyPage(),
    budget: queryBudget,
  };
}

function matchupSchedule(
  provider: TeamContext["provider"],
  entries: ReadonlyArray<ProviderMatchup>,
): MatchupsData["schedule"] {
  const supported = entries.some(
    (matchup) =>
      matchup.home.remainingGames !== undefined || matchup.away.remainingGames !== undefined,
  );
  if (supported) {
    return {
      status: "available",
      unit: "fantasy_team_player_games",
      detail:
        "Remaining games are a provider-published fantasy-team total of player-games for the scoring week, not a per-player count.",
    };
  }
  return {
    status: "unsupported",
    detail: limitation(provider, "team_remaining_games"),
  };
}

function matchupsUnavailable(
  team: QueryTeam,
  period: QueryPeriod,
  fetchedAt: DateTime.Utc,
  league: ReadOutcome<ProviderLeagueSettings>,
  detail: string,
): MatchupsData {
  return {
    status: "unsupported",
    team,
    period,
    matchups: [],
    schedule: { status: "unsupported", detail },
    coverage: [
      leagueCoverage(league, fetchedAt),
      unsupportedCoverage("matchups", "matchups", fetchedAt, detail),
    ],
    failures: leagueFailure(league),
    page: emptyPage(),
    budget: queryBudget,
  };
}

function matchupsWithoutData(
  team: QueryTeam,
  period: QueryPeriod,
  fetchedAt: DateTime.Utc,
  outcome: ReadOutcome<unknown>,
): MatchupsData {
  return {
    status: outcome._tag === "unsupported" ? "unsupported" : "failed",
    team,
    period,
    matchups: [],
    schedule: {
      status: "unsupported",
      detail:
        outcome._tag === "unsupported"
          ? outcome.detail
          : "The provider did not return matchup data for the scoring week.",
    },
    coverage: [
      outcome._tag === "ok"
        ? coverage("matchups", "matchups", fetchedAt, period)
        : unsupportedCoverage("matchups", "matchups", fetchedAt),
    ],
    failures: outcome._tag === "failed" ? [outcome.failure] : [],
    page: emptyPage(),
    budget: queryBudget,
  };
}

function transactionsWithoutData(
  team: QueryTeam,
  fetchedAt: DateTime.Utc,
  outcome: ReadOutcome<unknown>,
): TransactionsData {
  return {
    status: outcome._tag === "unsupported" ? "unsupported" : "failed",
    team,
    transactions: [],
    window: { fetched: 0, truncated: false },
    coverage: [
      outcome._tag === "ok"
        ? coverage("transactions", "transactions", fetchedAt)
        : unsupportedCoverage("transactions", "transactions", fetchedAt),
    ],
    failures: outcome._tag === "failed" ? [outcome.failure] : [],
    page: emptyPage(),
    budget: queryBudget,
  };
}

function withinPeriodWindow(
  window: ProviderPeriodWindow | undefined,
  period: QueryPeriod,
): boolean | undefined {
  return window === undefined
    ? undefined
    : period.week >= window.start && period.week <= window.end;
}

function currentPeriod(window: ProviderPeriodWindow | undefined): QueryPeriod | undefined {
  return window !== undefined && window.current >= window.start && window.current <= window.end
    ? { week: window.current }
    : undefined;
}

function providerRosterPeriod(period: QueryPeriod | undefined): ProviderRosterCoverage | undefined {
  return period === undefined ? undefined : { type: "week", week: period.week };
}

function normalizeStatPeriod(period: StatPeriod | undefined): ProviderStatPeriod {
  if (period === undefined || period.kind === "season") {
    return { kind: "season" };
  }
  if (period.kind === "preset") {
    return { kind: "preset", preset: period.preset };
  }
  if (period.kind === "range") {
    return { kind: "range", start: period.start, end: period.end };
  }
  return { kind: "week", week: period.week };
}

function statPeriodKey(period: ProviderStatPeriod): string {
  switch (period.kind) {
    case "season":
      return "season";
    case "week":
      return `week:${String(period.week)}`;
    case "preset":
      return `preset:${period.preset}`;
    case "range":
      return `range:${period.start}..${period.end}`;
  }
}

function periodSupportOf(context: TeamContext, sport: FantasySport): PlayersData["periodSupport"] {
  const support = context.provider.capabilities.statPeriods[sport];
  return {
    sport,
    kinds: support.kinds,
    presets: [...support.presets],
    maximumRangeDays: support.maximumRangeDays,
    detail: support.detail,
  };
}

function statBasisDetail(basis: ProviderStatBasis): string {
  switch (basis.type) {
    case "week":
      return `Actual statistics use the week basis for week ${String(basis.week)}.`;
    case "season":
      return "Actual statistics use the season basis.";
    case "date_range":
      return `Actual statistics use the date_range basis: ${String(basis.days)} daily reads summed from ${basis.start} to ${basis.end}.`;
  }
}

function periodKindRefusal(period: ProviderStatPeriod): string {
  return `The provider cannot serve the requested \`period\` for kind \`${period.kind}\`.`;
}

function leagueOverview(league: ProviderLeagueSettings): NonNullable<LeagueData["overview"]> {
  return {
    name: league.name,
    teamCount: league.teamCount,
    scoringType: league.scoringType,
    ...(league.scoringLabel === undefined ? {} : { scoringLabel: league.scoringLabel }),
    ...(league.periodWindow === undefined
      ? {}
      : {
          currentWeek: league.periodWindow.current,
          startWeek: league.periodWindow.start,
          endWeek: league.periodWindow.end,
        }),
    ...(league.startDate === undefined ? {} : { startDate: league.startDate }),
    ...(league.endDate === undefined ? {} : { endDate: league.endDate }),
    ...(league.weeklyDeadline === undefined ? {} : { weeklyDeadline: league.weeklyDeadline }),
    waiver: {
      ...(league.waiverType === undefined ? {} : { type: league.waiverType }),
      ...(league.waiverRule === undefined ? {} : { rule: league.waiverRule }),
      ...(league.usesFaab === undefined ? {} : { usesFaab: league.usesFaab }),
    },
  };
}

function scoringCategories(
  context: TeamContext,
  tokens: QueryTokens["Service"],
  league: ProviderLeagueSettings,
): Effect.Effect<ReadonlyArray<NonNullable<LeagueData["scoring"]>[number]>> {
  return Effect.gen(function* () {
    const modifiers = new Map(
      league.statModifiers.map((modifier) => [modifier.statId, modifier.points]),
    );
    const result: Array<NonNullable<LeagueData["scoring"]>[number]> = [];
    for (const category of league.statCategories.toSorted(
      (left, right) => left.statId - right.statId,
    )) {
      result.push({
        stat: yield* tokens.statRef({
          leagueKey: context.owned.team.providerLeagueKey,
          statId: category.statId,
        }),
        name: category.name,
        abbreviation: category.abbreviation,
        group: category.group,
        enabled: category.enabled,
        positionTypes: category.positionTypes,
        points: modifiers.get(category.statId) ?? null,
      });
    }
    return result;
  });
}

function rosterRules(league: ProviderLeagueSettings): NonNullable<LeagueData["rosterRules"]> {
  const positions = league.rosterPositions.map((position) => ({
    position: position.position,
    kind: position.kind === "starting" ? ("starter" as const) : position.kind,
    count: position.count,
  }));
  return {
    positions,
    starterCount: positions
      .filter((position) => position.kind === "starter")
      .reduce((total, position) => total + position.count, 0),
    benchCount: positions
      .filter((position) => position.kind === "bench")
      .reduce((total, position) => total + position.count, 0),
    reserveCount: positions
      .filter((position) => position.kind === "reserve")
      .reduce((total, position) => total + position.count, 0),
  };
}

type PlayerIdentityView = {
  readonly name: string;
  readonly displayPosition: string;
  readonly primaryPosition?: string;
};

type TransactionIdentity = {
  readonly identity: PlayerIdentityView;
  readonly eligiblePositions: ReadonlyArray<string> | undefined;
};

function playerIdentity(
  source:
    | {
        readonly name?: string | undefined;
        readonly primaryPosition?: string | undefined;
        readonly displayPosition?: string | undefined;
      }
    | undefined,
): PlayerIdentityView | undefined {
  if (source?.name === undefined || source.displayPosition === undefined) {
    return undefined;
  }
  return {
    name: source.name,
    displayPosition: source.displayPosition,
    ...(source.primaryPosition === undefined ? {} : { primaryPosition: source.primaryPosition }),
  };
}

function injuryOf(player: ProviderRosterPlayer): {
  reported: boolean;
  code?: string;
  detail?: string;
} {
  return {
    reported: player.injuryCode !== undefined || player.injuryDetail !== undefined,
    ...(player.injuryCode === undefined ? {} : { code: player.injuryCode }),
    ...(player.injuryDetail === undefined ? {} : { detail: player.injuryDetail }),
  };
}

function rosterPlayer(
  context: TeamContext,
  tokens: QueryTokens["Service"],
  player: ProviderRosterPlayer,
  detail: RosterDetail,
): Effect.Effect<RosterPlayerView> {
  return tokens
    .sealPlayerRef({
      userId: context.userId,
      leagueKey: context.owned.team.providerLeagueKey,
      playerKey: player.providerPlayerKey,
    })
    .pipe(
      Effect.map((ref) => ({
        player: ref,
        name: player.name,
        slot: player.slot,
        primaryPosition: player.primaryPosition,
        displayPosition: player.displayPosition,
        proTeam: player.proTeamAbbreviation ?? null,
        eligiblePositions: player.eligiblePositions,
        editable: player.isEditable,
        injury: injuryOf(player),
        ...(detail === "full"
          ? {
              byeWeek: player.byeWeek,
              undroppable: player.undroppable,
            }
          : {}),
      })),
    );
}

function counterpartyRef(
  context: TeamContext,
  tokens: QueryTokens["Service"],
  providerTeamKey: string,
): Effect.Effect<CounterpartyRef> {
  return tokens.sealCounterpartyRef({
    userId: context.userId,
    leagueKey: context.owned.team.providerLeagueKey,
    teamKey: providerTeamKey,
  });
}

type StatRefResolution =
  | { readonly _tag: "resolved"; readonly statId: number }
  | { readonly _tag: "unknown" }
  | { readonly _tag: "unavailable"; readonly detail: string };

function providerOrdered(
  provider: TeamContext["provider"],
  sort: NonNullable<SearchPlayersInput["sort"]>,
): boolean {
  return provider.capabilities.playerSearch.providerOrderedSorts.includes(sort);
}

function limitation(provider: TeamContext["provider"], subject: ProviderLimitationSubject): string {
  return (
    provider.capabilities.limitations.find((entry) => entry.subject === subject)?.detail ??
    "This provider does not publish data for this field."
  );
}

function comparePlayers(
  left: {
    readonly name: string;
    readonly primaryPosition: string;
    readonly percentOwned: number | null;
  },
  right: {
    readonly name: string;
    readonly primaryPosition: string;
    readonly percentOwned: number | null;
  },
  sort: NonNullable<SearchPlayersInput["sort"]>,
): number {
  switch (sort) {
    case "name":
      return left.name.localeCompare(right.name);
    case "position":
      return (
        left.primaryPosition.localeCompare(right.primaryPosition) ||
        left.name.localeCompare(right.name)
      );
    case "ownership":
      return (
        (right.percentOwned ?? -1) - (left.percentOwned ?? -1) ||
        left.name.localeCompare(right.name)
      );
    case "actual_rank":
    case "overall_rank":
    case "stat":
      return 0;
  }
}

function periodMismatchDetail(
  requested: ProviderRosterCoverage,
  covered: ProviderRosterCoverage | null,
): string {
  const wanted =
    requested.type === "week" ? `week ${String(requested.week)}` : `date ${requested.date}`;
  if (covered === null) {
    return `The provider did not report the requested ${wanted} for this read.`;
  }
  const actual =
    covered.type === "week" ? `week ${String(covered.week)}` : `the roster for ${covered.date}`;
  return `The provider returned ${actual} instead of the requested ${wanted}.`;
}

function dictionaryEntry(
  statId: number,
  stat: StatRef,
  league: ProviderLeagueSettings | undefined,
): PlayersData["dictionary"][number] {
  const category = league?.statCategories.find((candidate) => candidate.statId === statId);
  return {
    stat,
    name: category?.name ?? null,
    abbreviation: category?.abbreviation ?? null,
    group: category?.group ?? null,
    unit: "provider_reported",
  };
}

function queryFingerprint(value: string): Effect.Effect<string> {
  return Effect.promise(() =>
    crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(value))
      .then((digest) =>
        [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
      ),
  );
}
