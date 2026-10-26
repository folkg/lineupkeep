import { Array as EffectArray, DateTime, Effect, Layer } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import { Connections } from "#contexts/connections/Connections.ts";
import { FantasyQueries } from "#contexts/connections/FantasyQueries.ts";
import type {
  ProviderLeagueSettings,
  ProviderPeriodWindow,
  ProviderPlayerDetail,
  ProviderPlayerStatGroup,
  ProviderReadFailure,
  ProviderRoster,
  ProviderRosterPlayer,
} from "#contexts/connections/Provider.ts";
import { ProviderGateway } from "#contexts/connections/Provider.ts";
import type {
  CalendarData,
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
  SearchPlayersData,
  SearchPlayersInput,
  TransactionsData,
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

type ReadOutcome<A> =
  | { readonly _tag: "ok"; readonly value: A }
  | { readonly _tag: "unsupported"; readonly detail: string }
  | { readonly _tag: "failed"; readonly failure: QueryFailure };

export const FantasyQueriesLive = Layer.effect(
  FantasyQueries,
  Effect.gen(function* () {
    const connections = yield* Connections;
    const repository = yield* QueryRepository;
    const provider = yield* ProviderGateway;
    const encryption = yield* ConnectionCredentialEncryption;
    const tokens = yield* QueryTokens;

    const loadContext = (
      userId: UserId,
      teamId: OwnedTeam["team"]["id"],
    ): Effect.Effect<TeamContext, QueryError> =>
      loadTeamContext(repository, encryption, userId, teamId);

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
                  message:
                    error.coveredWeek === null
                      ? "The provider did not report a weekly period for this read."
                      : `The provider returned week ${String(error.coveredWeek)} instead of the requested week ${String(error.requestedWeek)}.`,
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
          provider.readLeague({
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
          provider.readTransactions({
            ...providerIdentity(context),
            providerLeagueKey: context.owned.team.providerLeagueKey,
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
        return calendarWithoutWeekWindow(team, fetchedAt, outcome);
      }
      const league = outcome.value;
      const window = league.periodWindow;
      if (window === undefined) {
        return calendarWithoutWeekWindow(team, fetchedAt, outcome);
      }
      if (window.endWeek < window.startWeek) {
        return calendarWithoutWeekWindow(team, fetchedAt, {
          _tag: "failed",
          failure: {
            code: "provider_invalid_response",
            resource: "league",
            message: "The provider league period range is invalid.",
          },
        });
      }
      const periods = Array.from({ length: window.endWeek - window.startWeek + 1 }, (_, index) => {
        const week = window.startWeek + index;
        return { week, isCurrent: week === window.currentWeek };
      });
      const fingerprintValue = yield* queryFingerprint(`calendar|team=${input.team}|order=week`);
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      const base = {
        status: "ok" as const,
        team,
        window: {
          currentWeek: window.currentWeek,
          startWeek: window.startWeek,
          endWeek: window.endWeek,
        },
        dates: {
          ...(league.startDate === undefined ? {} : { start: league.startDate }),
          ...(league.endDate === undefined ? {} : { end: league.endDate }),
        },
        lockContext: {
          status: "unverified" as const,
          ...(league.weeklyDeadline === undefined ? {} : { weeklyDeadline: league.weeklyDeadline }),
          detail:
            "Yahoo's exact fantasy-day rollover and per-player lock timing are not verified. This reports the league's declared period range only.",
        },
        historical: {
          status: "unsupported" as const,
          detail: "Only the linked team's current season is validated for this provider.",
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
      const fetchedAt = yield* DateTime.now;
      const outcome = yield* readLeague(context);
      if (outcome._tag !== "ok") {
        return leagueWithoutData(team, groups, fetchedAt, outcome);
      }
      const league = outcome.value;
      const scoring = yield* scoringCategories(context, tokens, league);
      const fingerprintValue = yield* queryFingerprint(
        `league|team=${input.team}|groups=${[...groups].sort().join(",")}|order=stat_id`,
      );
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      const base: Omit<LeagueData, "scoring" | "page"> = {
        status: "ok",
        team,
        ...(groups.includes("overview") ? { overview: leagueOverview(league) } : {}),
        ...(groups.includes("roster_rules") ? { rosterRules: rosterRules(league) } : {}),
        ...(groups.includes("standings")
          ? {
              standings: {
                status: "unsupported" as const,
                detail: "League standings reads are not verified for this provider.",
              },
            }
          : {}),
        coverage: [
          coverage("league", "league_settings", fetchedAt),
          ...(groups.includes("scoring")
            ? [coverage("scoring", "league_settings", fetchedAt)]
            : []),
          ...(groups.includes("standings")
            ? [unsupportedCoverage("standings", "standings", fetchedAt)]
            : []),
        ],
        failures: [],
        budget: queryBudget,
      };
      return yield* fitPage({
        schema: LeagueSchema,
        rows: groups.includes("scoring") ? scoring : [],
        offset,
        limit: input.limit ?? 20,
        resource: "scoring",
        groups,
        build: (pageRows, page) => ({ ...base, scoring: [...pageRows], page }),
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
          provider.readRoster({
            ...providerIdentity(context),
            providerTeamKey: context.owned.team.providerTeamKey,
            period: requested,
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
        return rosterWithoutData(team, period, fetchedAt, rosterOutcome);
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
      const outcome = yield* readOutcome(
        context,
        "players",
        provider.searchPlayers({
          ...providerIdentity(context),
          providerLeagueKey: context.owned.team.providerLeagueKey,
          query,
          availability,
          sort,
          limit: 50,
        }),
      );
      if (outcome._tag !== "ok") {
        return searchWithoutData(team, fetchedAt, outcome);
      }
      const positions = new Set(input.positions ?? []);
      const filtered = outcome.value.players
        .filter((player) => availability === "all" || player.availability === availability)
        .filter(
          (player) =>
            positions.size === 0 ||
            positions.has(player.primaryPosition) ||
            positions.has(player.displayPosition) ||
            player.eligiblePositions.some((position) => positions.has(position)),
        )
        .toSorted((left, right) => comparePlayers(left, right, sort));
      const refs = yield* tokens.sealPlayerRefs({
        userId,
        leagueKey: context.owned.team.providerLeagueKey,
        playerKeys: filtered.map((player) => player.providerPlayerKey),
      });
      const players = EffectArray.map(EffectArray.zip(filtered, refs), ([player, playerRef]) => ({
        player: playerRef,
        name: player.name,
        primaryPosition: player.primaryPosition,
        displayPosition: player.displayPosition,
        eligiblePositions: player.eligiblePositions,
        availability: player.availability,
        percentOwned: player.percentOwned,
      }));
      const fingerprintValue = yield* queryFingerprint(
        [
          "search_players",
          `team=${input.team}`,
          `query=${query ?? ""}`,
          `positions=${[...positions].sort().join(",")}`,
          `availability=${availability}`,
          `sort=${sort}`,
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
        provider.readRoster({
          ...providerIdentity(context),
          providerTeamKey: context.owned.team.providerTeamKey,
          period: input.period,
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
      const requestedPeriod =
        input.period ??
        (roster?.coverage.type === "week" ? { week: roster.coverage.week } : undefined);
      let details: ReadonlyArray<ProviderPlayerDetail> = [];
      let detailsUnsupported: string | undefined;
      if (groups.includes("actual_stats")) {
        const detailsOutcome = yield* readOutcome(
          context,
          "players",
          provider.readPlayerDetails({
            ...providerIdentity(context),
            providerLeagueKey: leagueKey,
            providerPlayerKeys: valid.map((row) => row.providerPlayerKey),
            sport: context.owned.team.sport,
            period: requestedPeriod,
            currentWeek: league?.periodWindow?.currentWeek,
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
              basis === undefined ? undefined : `Actual statistics use the ${basis.type} basis.`,
            ),
          );
        } else {
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
                  : {
                      status: "available" as const,
                      basis: detail.actual.basis.type,
                      ...(detail.actual.basis.type === "week"
                        ? { period: { week: detail.actual.basis.week } }
                        : {}),
                      stats: yield* statValues(detail.actual.stats),
                    };
            const projections = !groups.includes("projections")
              ? undefined
              : {
                  status: "unsupported" as const,
                  detail: "This provider does not expose projected player statistics.",
                };
            const scoringContext = !groups.includes("scoring_context")
              ? undefined
              : yield* scoringFor(rosterPlayer);
            if (actualStats?.status === "available") {
              for (const stat of detail?.actual?.stats ?? []) {
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
      const weekBasis = details.flatMap((player) =>
        player.actual?.basis.type === "week" ? [player.actual.basis.week] : [],
      );
      const period = weekBasis.length === 0 ? undefined : { week: weekBasis[0] ?? 1 };
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
          `period=${input.period === undefined ? "" : String(input.period.week)}`,
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
        ...(period === undefined ? {} : { period }),
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
      const outcome = yield* readOutcome(
        context,
        "matchups",
        provider.readMatchups({
          ...providerIdentity(context),
          providerLeagueKey: context.owned.team.providerLeagueKey,
          period: input.period,
        }),
      );
      if (outcome._tag !== "ok") {
        return matchupsWithoutData(team, input.period, fetchedAt, outcome);
      }
      const matchups = yield* Effect.forEach(
        outcome.value,
        (matchup) =>
          Effect.gen(function* () {
            const home = yield* counterpartyRef(context, tokens, matchup.home.providerTeamKey);
            const away = yield* counterpartyRef(context, tokens, matchup.away.providerTeamKey);
            return {
              period: matchup.period,
              home: { team: home, name: matchup.home.name, points: matchup.home.points },
              away: { team: away, name: matchup.away.name, points: matchup.away.points },
              ...(matchup.status === undefined ? {} : { status: matchup.status }),
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
      const context = yield* loadContext(userId, input.team);
      const team = queryTeam(context.owned);
      const fetchedAt = yield* DateTime.now;
      const outcome = yield* readOutcome(
        context,
        "transactions",
        provider.readTransactions({
          ...providerIdentity(context),
          providerLeagueKey: context.owned.team.providerLeagueKey,
          limit: 50,
        }),
      );
      if (outcome._tag !== "ok") {
        return transactionsWithoutData(team, fetchedAt, outcome);
      }
      const leagueKey = context.owned.team.providerLeagueKey;
      const teamKeys = outcome.value.flatMap((transaction) =>
        transaction.teams.map((transactionTeam) => transactionTeam.providerTeamKey),
      );
      const playerKeys = outcome.value.flatMap((transaction) =>
        transaction.players.map((player) => player.providerPlayerKey),
      );
      const teamRefs = yield* tokens.sealCounterpartyRefs({ userId, leagueKey, teamKeys });
      const playerRefs = yield* tokens.sealPlayerRefs({ userId, leagueKey, playerKeys });
      let teamOffset = 0;
      let playerOffset = 0;
      const transactions = outcome.value.map((transaction) => {
        const teams = EffectArray.map(
          EffectArray.zip(
            transaction.teams,
            teamRefs.slice(teamOffset, teamOffset + transaction.teams.length),
          ),
          ([transactionTeam, ref]) => ({ team: ref, name: transactionTeam.name }),
        );
        teamOffset += transaction.teams.length;
        const players = EffectArray.map(
          EffectArray.zip(
            transaction.players,
            playerRefs.slice(playerOffset, playerOffset + transaction.players.length),
          ),
          ([player, ref]) => ({ player: ref, direction: player.direction }),
        );
        playerOffset += transaction.players.length;
        return {
          occurredAt: transaction.occurredAt,
          type: transaction.type,
          ...(transaction.status === undefined ? {} : { status: transaction.status }),
          teams,
          players,
        };
      });
      const fingerprintValue = yield* queryFingerprint(
        `transactions|team=${input.team}|order=provider`,
      );
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      const base: Omit<TransactionsData, "transactions" | "page"> = {
        status: "ok",
        team,
        coverage: [coverage("transactions", "transactions", fetchedAt)],
        failures: [],
        budget: queryBudget,
      };
      return yield* fitPage({
        schema: TransactionsSchema,
        rows: transactions,
        offset,
        limit: input.limit ?? 25,
        resource: "transactions",
        groups: undefined,
        build: (pageRows, page) => ({ ...base, transactions: [...pageRows], page }),
        makeNext: (nextOffset) =>
          tokens.sealCursor({ userId, fingerprint: fingerprintValue, offset: nextOffset, now }),
        recordLabel: (row) => row.occurredAt,
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
    });
  }),
);

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
): QueryCoverage {
  return { resource, status: "unsupported", source, fetchedAt };
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
      detail: "Only the linked team's current season is validated for this provider.",
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
            detail: "League standings reads are not verified for this provider.",
          },
        }
      : {}),
    coverage: [
      leagueCoverage(outcome, fetchedAt),
      ...(groups.includes("standings")
        ? [unsupportedCoverage("standings", "standings", fetchedAt)]
        : []),
    ],
    failures: leagueFailure(outcome),
    page: emptyPage(),
    budget: queryBudget,
  };
}

function rosterWithoutData(
  team: QueryTeam,
  period: QueryPeriod | undefined,
  fetchedAt: DateTime.Utc,
  outcome: ReadOutcome<ProviderRoster>,
): RosterData {
  return {
    status: outcome._tag === "unsupported" ? "unsupported" : "failed",
    team,
    ...(period === undefined ? {} : { period }),
    players: [],
    coverage: [
      outcome._tag === "ok"
        ? coverage("roster", "roster", fetchedAt)
        : unsupportedCoverage("roster", "roster", fetchedAt),
    ],
    failures: outcome._tag === "failed" ? [outcome.failure] : [],
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
    : period.week >= window.startWeek && period.week <= window.endWeek;
}

function currentPeriod(window: ProviderPeriodWindow | undefined): QueryPeriod | undefined {
  return window !== undefined &&
    window.currentWeek >= window.startWeek &&
    window.currentWeek <= window.endWeek
    ? { week: window.currentWeek }
    : undefined;
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
          currentWeek: league.periodWindow.currentWeek,
          startWeek: league.periodWindow.startWeek,
          endWeek: league.periodWindow.endWeek,
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
): Effect.Effect<LeagueData["scoring"]> {
  return Effect.gen(function* () {
    const modifiers = new Map(
      league.statModifiers.map((modifier) => [modifier.statId, modifier.points]),
    );
    const result: Array<LeagueData["scoring"][number]> = [];
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
    kind: position.isStarting
      ? ("starter" as const)
      : position.position === "BN" || position.position === "BENCH"
        ? ("bench" as const)
        : ("reserve" as const),
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
        eligiblePositions: player.eligiblePositions,
        editable: player.isEditable,
        injury: injuryOf(player),
        ...(detail === "full"
          ? {
              byeWeek: player.byeWeek,
              undroppable: player.undroppable,
              isFlex: player.isFlex,
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
  sort: "name" | "position" | "ownership",
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
  }
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
