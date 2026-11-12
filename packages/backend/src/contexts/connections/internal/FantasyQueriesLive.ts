import { Array as EffectArray, DateTime, Effect, Layer, Option, Ref } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import { providerSessionReconnectDetail } from "#contexts/connections/Connection.ts";
import { Connections } from "#contexts/connections/Connections.ts";
import { FantasyQueries } from "#contexts/connections/FantasyQueries.ts";
import type { FantasySport } from "#contexts/connections/FantasyTeam.ts";
import { GameSourceRegistry } from "#contexts/connections/GameSource.ts";
import { ProfessionalCalendar } from "#contexts/connections/ProfessionalCalendar.ts";
import { leagueOffNightDefinition } from "#contexts/connections/ProfessionalGame.ts";
import type { ProfessionalGame } from "#contexts/connections/ProfessionalGame.ts";
import type {
  ProviderAcquisitionUsage,
  ProviderDraftPick,
  ProviderLeagueSettings,
  ProviderLeagueTeam,
  ProviderPeriodWindow,
  ProviderPlayerDetail,
  ProviderPlayerStatGroup,
  ProviderPlayerWeekFact,
  PlayerWeekOpponent,
  ProviderReadFailure,
  ProviderRoster,
  ProviderRosterCoverage,
  RecentFormWindow,
  ProviderMatchup,
  ProviderRemainingGames,
  ProviderRosterPlayer,
  ProviderRosterSchedule,
  ProviderSchedulePeriod,
  ProviderScheduledGame,
  ProviderStartingLineup,
  ProviderStandings,
  ProviderStatBasis,
  ProviderStatPeriod,
  ProviderStatValue,
  ProviderTeamScore,
  ProviderTransaction,
  ProviderTransactionTeam,
} from "#contexts/connections/Provider.ts";
import type { ProviderLimitationSubject } from "#contexts/connections/Provider.ts";
import { sessionEvidenceOf } from "#contexts/connections/Provider.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";
import type {
  AcquisitionLimits,
  AcquisitionUsage,
  CalendarData,
  DraftPick,
  GamesWindowInput,
  GetCalendarInput,
  GetLeagueInput,
  GetMatchupsInput,
  GetPlayersInput,
  GetRostersInput,
  GetTransactionsInput,
  LeagueData,
  LeagueGroup,
  LeagueRosterData,
  ListTeamsInput,
  MatchupsData,
  PlayersData,
  PlayerDraft,
  PlayerGameDays,
  PlayerGameWeeks,
  PlayerGroup,
  RosterData,
  RosterPlayer as RosterPlayerView,
  RosterResult,
  RosterDetail,
  CalendarTeamGames,
  PlayerWeek,
  CategoryRole,
  CategoryValue,
  SearchPlayersData,
  SearchPlayersInput,
  TransactionsData,
  TransactionWindow,
  GetTeamSummaryInput,
  StandingRow,
  StandingDetail,
  SummaryGroup,
  SummarySchedulePlayer,
  SummaryScheduleWeek,
  SummaryIllegalSlot,
  SummaryRosterPlayer,
  SummaryMatchupCategory,
  SummaryScheduleWindow,
  TeamSummaryData,
} from "#contexts/connections/QueryResults.ts";
import {
  CalendarData as CalendarSchema,
  LeagueData as LeagueSchema,
  ListTeamsData,
  MatchupsData as MatchupsSchema,
  PlayersData as PlayersSchema,
  LeagueRosterData as LeagueRosterSchema,
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
  type PlayerRef,
  type QueryTeam,
  type StartingStatus,
  type StatWindow,
  QueryPersistenceFailed,
  QuerySelectionInvalid,
  type StatRef,
  type TeamOwnerNote,
} from "#contexts/connections/QueryValues.ts";
import { rosterOccupancy, rosterRuleOf } from "#contexts/connections/RosterSlots.ts";
import {
  describeStatWindow,
  nearestStatWindow,
  sameStatWindow,
  statWindowKey,
} from "#contexts/connections/StatWindow.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import {
  countGamesForTeam,
  gameDatesForTeam,
  gamesForTeam,
  isLeagueOffNight,
  leagueGamesByDate,
} from "./LeagueSchedule.ts";
import { uniqueProviderTeamKeys } from "./ProfessionalTeamIdentity.ts";
import { ProviderOpponentFactStale, readProviderOpponent } from "./ProviderOpponentFacts.ts";
import { fitPage, playerListBudget, queryBudget, summaryBudget } from "./QueryBudget.ts";
import { loadTeamContext, ownerNoteOf, providerIdentity } from "./QueryContext.ts";
import type { TeamContext } from "./QueryContext.ts";
import { QueryRepository } from "./QueryRepository.ts";
import type { OwnedTeam } from "./QueryRepository.ts";
import { QueryTokens } from "./QueryTokens.ts";
import { ScheduleObservationRepository } from "./ScheduleObservationRepository.ts";

const defaultLeagueGroups: ReadonlyArray<LeagueGroup> = ["overview", "scoring", "roster_rules"];
const defaultPlayerGroups: ReadonlyArray<PlayerGroup> = ["identity", "availability", "eligibility"];
const transactionReadPageSize = 50;
const transactionReadMaximumPages = 10;
const maximumSeasonDates = 366;
const summaryGroups: ReadonlyArray<SummaryGroup> = [
  "league",
  "standings",
  "categories",
  "matchup",
  "schedule",
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

type FailureOutcome = Extract<ReadOutcome<never>, { readonly _tag: "unsupported" | "failed" }>;

type PoolGames =
  | {
      readonly status: "available";
      readonly basis: "date";
      readonly window: SummaryScheduleWindow;
      readonly games: ReadonlyArray<ProfessionalGame>;
      readonly observedAt: DateTime.Utc;
      readonly unresolvedTeamCount: number;
    }
  | {
      readonly status: "available";
      readonly basis: "week";
      readonly weeks: { readonly first: number; readonly last: number };
      readonly opponents: ReadonlyMap<string, ReadonlyMap<number, PlayerWeekOpponent>>;
      readonly observedAt: DateTime.Utc;
    }
  | { readonly status: "unavailable"; readonly detail: string };

export const FantasyQueriesLive = Layer.effect(
  FantasyQueries,
  Effect.gen(function* () {
    const connections = yield* Connections;
    const repository = yield* QueryRepository;
    const registry = yield* ProviderRegistry;
    const encryption = yield* ConnectionCredentialEncryption;
    const tokens = yield* QueryTokens;
    const scheduleObservations = yield* ScheduleObservationRepository;
    const calendar = yield* ProfessionalCalendar;
    const gameSources = yield* GameSourceRegistry;

    const loadContext = (
      userId: UserId,
      teamId: OwnedTeam["team"]["id"],
    ): Effect.Effect<TeamContext, QueryError> =>
      loadTeamContext(repository, encryption, registry, userId, teamId);

    const failureOutcome = (
      context: TeamContext,
      resource: string,
      error: ProviderReadFailure,
    ): Effect.Effect<FailureOutcome> => {
      switch (error._tag) {
        case "provider.operation_unsupported":
          return Effect.succeed({ _tag: "unsupported", detail: error.reason });
        case "provider.session_rejected":
          return Ref.set(context.sessionRejected, true).pipe(
            Effect.andThen(
              repository.recordSessionRejected(
                context.userId,
                context.owned,
                sessionEvidenceOf(error),
              ),
            ),
            Effect.as<FailureOutcome>({
              _tag: "failed",
              failure: {
                code: "provider_session_rejected",
                resource,
                message: providerSessionReconnectDetail,
              },
            }),
          );
        case "provider.request_failed":
          return Effect.succeed<FailureOutcome>({
            _tag: "failed",
            failure: {
              code: "provider_unavailable",
              resource,
              message: "Your league could not be reached.",
            },
          });
        case "provider.response_invalid":
          return Effect.succeed<FailureOutcome>({
            _tag: "failed",
            failure: {
              code: "provider_invalid_response",
              resource,
              message:
                error.field === undefined
                  ? "Your league returned data that could not be verified for this request."
                  : `Your league returned data that could not be verified (field \`${error.field}\`).`,
            },
          });
        case "provider.period_mismatch":
          return Effect.succeed<FailureOutcome>({
            _tag: "failed",
            failure: {
              code: "period_unavailable",
              resource,
              message: periodMismatchDetail(error.requested, error.covered),
            },
          });
        case "provider.period_unsupported":
          return Effect.succeed<FailureOutcome>({
            _tag: "failed",
            failure: {
              code: "period_unsupported",
              resource,
              message: `${error.reason} ${error.remedy}`,
            },
          });
      }
    };

    const staleOutcome = (
      context: TeamContext,
      resource: string,
      error: ProviderOpponentFactStale,
    ): Effect.Effect<ReadOutcome<never>> =>
      Effect.gen(function* () {
        const providerOutcome = yield* failureOutcome(context, resource, error.cause);
        const reason =
          providerOutcome._tag === "unsupported"
            ? providerOutcome.detail
            : providerOutcome.failure.message;
        const previous =
          error.previousObservedAt === undefined
            ? "it has no earlier observation"
            : `its last observation was ${DateTime.formatIso(error.previousObservedAt)}`;
        return {
          _tag: "failed",
          failure: {
            code: "schedule_fact_stale",
            resource,
            message: `Your league opponents for ${error.dates.join(", ")} are past their maximum age and were not served; ${previous}. The re-read failed: ${reason}`,
          },
        };
      });

    const readOutcome = <A>(
      context: TeamContext,
      resource: string,
      program: Effect.Effect<
        A,
        ProviderReadFailure | ProviderOpponentFactStale | QueryPersistenceFailed
      >,
    ): Effect.Effect<ReadOutcome<A>, QueryPersistenceFailed> =>
      Effect.gen(function* () {
        if (yield* Ref.get(context.sessionRejected)) {
          return {
            _tag: "failed",
            failure: {
              code: "provider_session_rejected",
              resource,
              message: providerSessionReconnectDetail,
            },
          };
        }
        return yield* Effect.matchEffect(program, {
          onSuccess: (value) =>
            proveSession(context).pipe(Effect.as<ReadOutcome<A>>({ _tag: "ok", value })),
          onFailure: (error) => {
            if (error._tag === "query.persistence_failed") {
              return Effect.fail(error);
            }
            if (error._tag === "provider_opponent.fact_stale") {
              return staleOutcome(context, resource, error);
            }
            return failureOutcome(context, resource, error);
          },
        });
      });

    const proveSession = (context: TeamContext): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (yield* Ref.getAndSet(context.sessionProven, true)) {
          return;
        }
        yield* repository
          .recordSessionProven(context.userId, context.owned)
          .pipe(
            Effect.catch((error: QueryPersistenceFailed) =>
              Effect.annotateCurrentSpan("query.session_proven_write_failed", error._tag),
            ),
          );
      });

    const readLeague = (
      context: TeamContext,
    ): Effect.Effect<ReadOutcome<ProviderLeagueSettings>, QueryPersistenceFailed> =>
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
            message: "Your league season does not match the linked team.",
          },
        };
      });

    const readPoolGamesForWindow = (
      context: TeamContext,
      requested: GamesWindowInput,
      leagueOutcome: ReadOutcome<ProviderLeagueSettings> | undefined,
      playerKeys: ReadonlyArray<string>,
      weekFacts: ReadonlyMap<string, ProviderPlayerWeekFact>,
      weekFactsWeek: number | undefined,
    ): Effect.Effect<PoolGames, QuerySelectionInvalid | QueryPersistenceFailed> =>
      Effect.gen(function* () {
        const hasGameSource = gameSources.sourceFor(context.owned.team.league) !== undefined;
        if ("kind" in requested) {
          if (requested.kind === "current") {
            return hasGameSource
              ? yield* readPoolGames(context, leagueOutcome)
              : yield* readPoolWeekGames(
                  context,
                  leagueOutcome,
                  1,
                  playerKeys,
                  weekFacts,
                  weekFactsWeek,
                );
          }
          if (hasGameSource) {
            return yield* QuerySelectionInvalid.make({
              detail:
                'This league has a dated professional schedule, so ask for games with `{kind: "current"}` or `{start, end}` dates.',
            });
          }
          return yield* readPoolWeekGames(
            context,
            leagueOutcome,
            requested.weeks,
            playerKeys,
            weekFacts,
            weekFactsWeek,
          );
        }
        if (!hasGameSource) {
          return yield* QuerySelectionInvalid.make({
            detail:
              'This league counts games by scoring week, so a date window cannot answer for it. Pass `gamesWindow: {kind: "next_weeks", weeks: 4}` for several weeks, or omit it for this week\'s `week`.',
          });
        }
        const from = calendarDate(requested.start);
        const to = calendarDate(requested.end);
        const dates = from === undefined || to === undefined ? undefined : calendarDates(from, to);
        if (dates === undefined) {
          return {
            status: "unavailable" as const,
            detail:
              "The game window is not a pair of calendar dates in order, so no window bounds the pool's games. Pass `gamesWindow` with `start` on or before `end`.",
          };
        }
        if (dates.length > maximumSeasonDates) {
          return yield* QuerySelectionInvalid.make({
            detail: `The game window covers ${String(dates.length)} dates, and a window cannot exceed one season (${String(maximumSeasonDates)} dates). Ask for a narrower window.`,
          });
        }
        return yield* readPoolGamesOverWindow(context, {
          start: requested.start,
          end: requested.end,
          source: "requested",
        });
      });

    const readPoolWeekGames = (
      context: TeamContext,
      leagueOutcome: ReadOutcome<ProviderLeagueSettings> | undefined,
      requestedWeeks: number,
      playerKeys: ReadonlyArray<string>,
      weekFacts: ReadonlyMap<string, ProviderPlayerWeekFact>,
      weekFactsWeek: number | undefined,
    ): Effect.Effect<PoolGames, QuerySelectionInvalid | QueryPersistenceFailed> =>
      Effect.gen(function* () {
        if (leagueOutcome === undefined || leagueOutcome._tag !== "ok") {
          return {
            status: "unavailable" as const,
            detail:
              "The league settings could not be read, so no scoring week bounds the pool's games.",
          };
        }
        const periodWindow = leagueOutcome.value.periodWindow;
        const current = currentPeriod(periodWindow);
        if (periodWindow === undefined || current === undefined) {
          return {
            status: "unavailable" as const,
            detail: "This league publishes no current scoring week, so a week window has no start.",
          };
        }
        const last = current.week + requestedWeeks - 1;
        if (last > periodWindow.end) {
          const most = periodWindow.end - current.week + 1;
          return yield* QuerySelectionInvalid.make({
            detail: `This league's season ends at week ${String(periodWindow.end)}, and ${String(requestedWeeks)} weeks from week ${String(current.week)} reaches week ${String(last)}. Ask for at most ${String(most)} weeks.`,
          });
        }
        const opponents = new Map<string, Map<number, PlayerWeekOpponent>>();
        const record = (
          providerPlayerKey: string,
          week: number,
          opponent: PlayerWeekOpponent | undefined,
        ): void => {
          if (opponent === undefined) {
            return;
          }
          const byWeek = opponents.get(providerPlayerKey) ?? new Map<number, PlayerWeekOpponent>();
          byWeek.set(week, opponent);
          opponents.set(providerPlayerKey, byWeek);
        };
        const weeks = Array.from({ length: requestedWeeks }, (_, index) => current.week + index);
        if (weekFactsWeek !== undefined && weeks.includes(weekFactsWeek)) {
          for (const providerPlayerKey of playerKeys) {
            const fact = weekFacts.get(providerPlayerKey);
            if (fact?.plays === true) {
              record(providerPlayerKey, weekFactsWeek, fact.opponent);
            }
          }
        }
        for (const week of weeks) {
          if (week === weekFactsWeek) {
            continue;
          }
          const outcome = yield* readOutcome(
            context,
            "player_weeks",
            context.provider.readPlayerWeekOpponents({
              ...providerIdentity(context),
              providerLeagueKey: context.owned.team.providerLeagueKey,
              providerPlayerKeys: playerKeys,
              week: { week },
            }),
          );
          if (outcome._tag === "unsupported") {
            return { status: "unavailable" as const, detail: outcome.detail };
          }
          if (outcome._tag === "failed") {
            return { status: "unavailable" as const, detail: outcome.failure.message };
          }
          for (const fact of outcome.value) {
            if (fact.plays) {
              record(fact.providerPlayerKey, fact.week, fact.opponent);
            }
          }
        }
        return {
          status: "available" as const,
          basis: "week" as const,
          weeks: { first: current.week, last },
          opponents,
          observedAt: yield* DateTime.now,
        };
      });

    const readPoolGamesOverWindow = (
      context: TeamContext,
      window: SummaryScheduleWindow,
    ): Effect.Effect<PoolGames, QueryPersistenceFailed> =>
      Effect.gen(function* () {
        const professionalGames = yield* readProfessionalScheduleGames({
          calendar,
          league: context.owned.team.league,
          from: window.start,
          to: window.end,
        });
        return professionalGames.status === "available"
          ? {
              status: "available" as const,
              basis: "date" as const,
              window,
              games: professionalGames.games,
              observedAt: professionalGames.observedAt,
              unresolvedTeamCount: professionalGames.unresolvedTeamCount,
            }
          : { status: "unavailable" as const, detail: professionalGames.detail };
      });

    const readPoolGames = (
      context: TeamContext,
      leagueOutcome: ReadOutcome<ProviderLeagueSettings> | undefined,
    ): Effect.Effect<PoolGames, QueryPersistenceFailed> =>
      Effect.gen(function* () {
        if (leagueOutcome === undefined || leagueOutcome._tag !== "ok") {
          return {
            status: "unavailable" as const,
            detail:
              "The league settings could not be read, so no scoring window bounds the pool's games.",
          };
        }
        const league = leagueOutcome.value;
        const period = currentPeriod(league.periodWindow);
        let weekDates: { readonly start: string; readonly end: string } | undefined;
        if (period !== undefined) {
          const matchupOutcome = yield* readOutcome(
            context,
            "matchups",
            context.provider.readMatchups({
              ...providerIdentity(context),
              providerLeagueKey: context.owned.team.providerLeagueKey,
              period,
            }),
          );
          if (matchupOutcome._tag === "ok") {
            weekDates = publishedWeekWindow(undefined, matchupOutcome.value);
          }
        }
        const window = searchGamesWindow({ league, period, weekDates });
        if (window === undefined) {
          return {
            status: "unavailable" as const,
            detail:
              "Your league publishes neither a scoring period nor a current date for this league, so no window bounds the pool's games.",
          };
        }
        return yield* readPoolGamesOverWindow(context, window);
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
                : "Your league reported no league scoring categories.",
          };
        }
        const categoryCache = new Map<number, StatRef>();
        const configured = configuredCategories(outcome.value);
        for (const category of configured.filter((entry) => entry.scoring === "scoring")) {
          const ref = yield* statRefFor(context, tokens, categoryCache, category.statId);
          if (ref === stat) {
            return { _tag: "resolved" as const, statId: category.statId };
          }
        }
        for (const category of configured.filter((entry) => entry.scoring === "informational")) {
          const ref = yield* statRefFor(context, tokens, categoryCache, category.statId);
          if (ref === stat) {
            return { _tag: "informational" as const, name: category.name };
          }
        }
        return { _tag: "unknown" as const };
      });

    const draftProvenance = (
      context: TeamContext,
      fetchedAt: DateTime.Utc,
      playerKeys: ReadonlyArray<string>,
      resource: string,
    ): Effect.Effect<DraftProvenanceRead, QueryPersistenceFailed> =>
      Effect.gen(function* () {
        if (playerKeys.length === 0) {
          return { lookup: () => notPublishedDraft };
        }
        const outcome = yield* readOutcome(
          context,
          "draft_results",
          context.provider.readDraftResults({
            ...providerIdentity(context),
            providerLeagueKey: context.owned.team.providerLeagueKey,
          }),
        );
        if (outcome._tag === "unsupported") {
          return {
            lookup: () => notPublishedDraft,
            coverage: unsupportedCoverage(resource, "draft_results", fetchedAt, outcome.detail),
          };
        }
        if (outcome._tag === "failed") {
          return {
            lookup: () => notPublishedDraft,
            coverage: degradedCoverage(
              resource,
              "draft_results",
              fetchedAt,
              outcome.failure.message,
            ),
            failures: [outcome.failure],
          };
        }
        if (outcome.value.length === 0) {
          return {
            lookup: () => notPublishedDraft,
            coverage: unsupportedCoverage(
              resource,
              "draft_results",
              fetchedAt,
              "Your league published no draft picks, so no player's draft provenance is known.",
            ),
          };
        }
        const teamsOutcome = yield* readOutcome(
          context,
          "league_teams",
          context.provider.readLeagueTeams({
            ...providerIdentity(context),
            providerLeagueKey: context.owned.team.providerLeagueKey,
          }),
        );
        const teamNameByKey = new Map(
          teamsOutcome._tag === "ok"
            ? teamsOutcome.value.map((team) => [team.providerTeamKey, team.name] as const)
            : [],
        );
        const teamKeys = [...new Set(outcome.value.map((pick) => pick.providerTeamKey))];
        const teamRefs = yield* tokens.sealCounterpartyRefs({
          userId: context.userId,
          leagueKey: context.owned.team.providerLeagueKey,
          teamKeys,
        });
        const teamRefByKey = new Map(
          teamKeys.map((key, index) => [key, EffectArray.getUnsafe(teamRefs, index)] as const),
        );
        const picks = new Map(outcome.value.map((pick) => [pick.providerPlayerKey, pick] as const));
        const draftSeason = context.owned.team.season;
        return {
          lookup: (providerPlayerKey: string) => {
            const pick = picks.get(providerPlayerKey);
            if (pick === undefined) {
              return { status: "undrafted" as const };
            }
            const team = teamRefByKey.get(pick.providerTeamKey);
            if (team === undefined) {
              throw new Error("Every draft pick team key must seal a counterparty reference.");
            }
            const name = teamNameByKey.get(pick.providerTeamKey);
            return {
              status: "drafted" as const,
              draftRound: pick.round,
              overallPick: pick.pick,
              draftedBy: { team, ...(name === undefined ? {} : { name }) },
              draftSeason,
            };
          },
          coverage: coverage(
            resource,
            "draft_results",
            fetchedAt,
            undefined,
            teamsOutcome._tag === "ok"
              ? "Draft provenance comes from one draft-history read and one league-teams read for the whole response, not one read per player."
              : "Draft provenance comes from one draft-history read for the whole response, not one read per player; the league's team names could not be read.",
          ),
          ...(teamsOutcome._tag === "failed" ? { failures: [teamsOutcome.failure] } : {}),
        };
      });

    const transactionIdentityIndex = (
      context: TeamContext,
      fetchedAt: DateTime.Utc,
      coverageEntries: Array<QueryCoverage>,
      unresolvedKeys: ReadonlyArray<string>,
    ): Effect.Effect<ReadonlyMap<string, TransactionIdentity>, QueryPersistenceFailed> =>
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

    const calendarSchedulePeriod = (
      context: TeamContext,
      league: ProviderLeagueSettings,
      period: QueryPeriod,
      failures: QueryFailure[],
    ): Effect.Effect<ProviderSchedulePeriod | undefined, QueryPersistenceFailed> =>
      Effect.gen(function* () {
        if (league.rosterCoverage === "week") {
          return { type: "week" as const, week: period.week };
        }
        const matchupOutcome = yield* readOutcome(
          context,
          "matchups",
          context.provider.readMatchups({
            ...providerIdentity(context),
            providerLeagueKey: context.owned.team.providerLeagueKey,
            period,
          }),
        );
        if (matchupOutcome._tag === "failed") {
          failures.push(matchupOutcome.failure);
        }
        if (matchupOutcome._tag !== "ok") {
          return undefined;
        }
        const dates = publishedWeekWindow(undefined, matchupOutcome.value);
        return dates === undefined ? undefined : { type: "date" as const, ...dates };
      });

    const calendarGames = (
      context: TeamContext,
      league: ProviderLeagueSettings,
      input: GetCalendarInput,
      failures: QueryFailure[],
    ): Effect.Effect<NonNullable<CalendarData["games"]>, QueryPersistenceFailed> =>
      Effect.gen(function* () {
        const period = input.period;
        if (period === undefined) {
          throw new Error("Calendar games are read only for a requested period");
        }
        const schedulePeriod = yield* calendarSchedulePeriod(context, league, period, failures);
        if (schedulePeriod === undefined) {
          return { status: "unsupported" as const, reason: "not_published" as const };
        }
        const outcome = yield* readOutcome(
          context,
          "roster_schedule",
          readProviderOpponent({
            store: scheduleObservations,
            provider: context.provider,
            material: providerIdentity(context),
            teamId: context.owned.team.id,
            sport: context.owned.team.sport,
            providerTeamKey: context.owned.team.providerTeamKey,
            period: schedulePeriod,
          }),
        );
        if (outcome._tag === "failed") {
          failures.push(outcome.failure);
        }
        if (outcome._tag !== "ok") {
          return { status: "unsupported" as const, reason: "unavailable" as const };
        }
        return {
          status: "available" as const,
          period,
          observedAt: outcome.value.observedAt,
          ...calendarTeams(outcome.value.schedule, input.proTeams),
        };
      });

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
        return calendarWithoutWeekWindow(team, fetchedAt, outcome);
      }
      const league = outcome.value;
      const window = league.periodWindow;
      if (window === undefined) {
        return calendarWithoutWeekWindow(team, fetchedAt, outcome);
      }
      if (window.end < window.start) {
        return calendarWithoutWeekWindow(team, fetchedAt, {
          _tag: "failed",
          failure: {
            code: "provider_invalid_response",
            resource: "league",
            message: "Your league period range is invalid.",
          },
        });
      }
      const periods = Array.from({ length: window.end - window.start + 1 }, (_, index) => {
        const week = window.start + index;
        return { week, isCurrent: week === window.current };
      });
      if (input.period !== undefined && withinPeriodWindow(window, input.period) === false) {
        return yield* QuerySelectionInvalid.make({
          detail: "The requested period is outside the linked league's season.",
        });
      }
      const failures: QueryFailure[] = [];
      const games =
        input.period === undefined
          ? undefined
          : yield* calendarGames(context, league, input, failures);
      const fingerprintValue = yield* queryFingerprint(
        [
          "calendar",
          `team=${input.team}`,
          `period=${input.period === undefined ? "" : String(input.period.week)}`,
          `proTeams=${[...(input.proTeams ?? [])].sort().join(",")}`,
          "order=week",
        ].join("|"),
      );
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      const base = {
        status: "ok" as const,
        team,
        week: leagueWeek(league),
        dates: {
          ...(league.startDate === undefined ? {} : { start: league.startDate }),
          ...(league.endDate === undefined ? {} : { end: league.endDate }),
        },
        ...(games === undefined ? {} : { games }),
        coverage: [coverage("league", "league_settings", fetchedAt)],
        failures,
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
      const includeScoring = groups.includes("scoring");
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
      const categoryLabelsByStat = categoryLabels(league);
      const standingTable =
        standingsOutcome?._tag === "ok"
          ? yield* standingRows(
              context,
              tokens,
              standingsOutcome.value,
              presentation === "compact" ? undefined : categoryLabelsByStat,
              acquisitionLimitValues(league),
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
        week: leagueWeek(league),
        ...(groups.includes("overview") ? { overview: leagueOverview(league) } : {}),
        ...(groups.includes("roster_rules") ? { rosterRules: rosterRules(league) } : {}),
        ...(league.playerSearch === undefined
          ? {}
          : {
              playerSearch: {
                status: league.playerSearch.status,
                sorts: [...league.playerSearch.sorts],
                windows: [...league.playerSearch.windows],
                games:
                  gameSources.sourceFor(context.owned.team.league) === undefined
                    ? {
                        status: "scoring_week" as const,
                        detail:
                          'This league counts games by scoring week. Ask `search_players` with `gamesWindow: {kind: "current"}` or `{kind: "next_weeks", weeks: N}`; it refuses a date window.',
                      }
                    : {
                        status: "date_window" as const,
                        detail:
                          'This league has a dated professional schedule. Ask `search_players` with `gamesWindow: {kind: "current"}` or `{start, end}` dates; it refuses a week window.',
                      },
                detail: league.playerSearch.detail,
              },
            }),
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
                    acquisitionLimitsOf(league),
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
              acquisitionLimitsOf(league),
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
                  acquisitionLimitsOf(league),
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

    const getLeagueRosters = (
      userId: UserId,
      context: TeamContext,
      input: GetRostersInput,
    ): Effect.Effect<RosterResult, QueryError> =>
      Effect.gen(function* () {
        const team = queryTeam(context.owned);
        const detail: RosterDetail = input.detail ?? "compact";
        const fetchedAt = yield* DateTime.now;
        if (input.period !== undefined) {
          return yield* QuerySelectionInvalid.make({
            detail:
              'A `scope: "league"` roster read returns your league\'s current coverage for every team. Your league publishes no league-wide roster for a selected week, and Lineupgrade will not read the teams one at a time, so omit `period` or use `scope: "team"` for one linked team\'s exact week.',
          });
        }
        const leagueKey = context.owned.team.providerLeagueKey;
        const outcome = yield* readOutcome(
          context,
          "roster",
          context.provider.readLeagueRosters({
            ...providerIdentity(context),
            providerLeagueKey: leagueKey,
          }),
        );
        if (outcome._tag !== "ok") {
          return leagueRostersWithoutData(team, fetchedAt, outcome);
        }
        const ownedKeys = yield* repository.readLeagueOwnedTeamKeys({
          userId,
          provider: context.owned.connection.provider,
          providerLeagueKey: leagueKey,
        });
        const rosters = outcome.value;
        const teamRefs = yield* tokens.sealCounterpartyRefs({
          userId,
          leagueKey,
          teamKeys: rosters.map((roster) => roster.providerTeamKey),
        });
        const playerRefs = yield* tokens.sealPlayerRefs({
          userId,
          leagueKey,
          playerKeys: rosters.flatMap((roster) =>
            roster.players.map((player) => player.providerPlayerKey),
          ),
        });
        const owned = new Set(ownedKeys);
        const batchCoverage = rosters[0]?.coverage;
        if (batchCoverage === undefined) {
          throw new Error("A league roster read returns at least one team roster.");
        }
        const projectedRanks = new Map<string, number | null>();
        const weekFailures: QueryFailure[] = [];
        if (
          batchCoverage.type === "week" &&
          context.provider.capabilities.projections.sports.includes(context.owned.team.sport)
        ) {
          const weekOutcome = yield* readOutcome(
            context,
            "player_weeks",
            context.provider.readPlayerWeeks({
              ...providerIdentity(context),
              providerLeagueKey: leagueKey,
              providerPlayerKeys: rosters.flatMap((roster) =>
                roster.players.map((player) => player.providerPlayerKey),
              ),
              week: { week: batchCoverage.week },
            }),
          );
          if (weekOutcome._tag === "ok") {
            for (const fact of weekOutcome.value) {
              projectedRanks.set(fact.providerPlayerKey, fact.projectedRank ?? null);
            }
          } else if (weekOutcome._tag === "failed") {
            weekFailures.push(weekOutcome.failure);
          }
        }
        let playerIndex = 0;
        const teams = rosters.map((roster, index) => ({
          team: EffectArray.getUnsafe(teamRefs, index),
          name: roster.name,
          owned: owned.has(roster.providerTeamKey),
          players: roster.players.map((player) => {
            const ref = EffectArray.getUnsafe(playerRefs, playerIndex);
            playerIndex += 1;
            return rosterRow(
              player,
              ref,
              detail,
              rosterWeek(player, roster.coverage, projectedRanks.get(player.providerPlayerKey)),
              "not_requested",
            );
          }),
        }));
        const rosterCoverage =
          batchCoverage.type === "week"
            ? coverage("roster", "league_rosters", fetchedAt, { week: batchCoverage.week })
            : coverage(
                "roster",
                "league_rosters",
                fetchedAt,
                undefined,
                `Date-scoped league rosters for ${batchCoverage.date}`,
              );
        const fingerprintValue = yield* queryFingerprint(
          `rosters|scope=league|team=${input.team}|detail=${detail}|order=team_key`,
        );
        const now = yield* DateTime.now;
        const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
        const pageSize = input.limit ?? 50;
        const base: Omit<LeagueRosterData, "teams" | "page"> = {
          status: "ok",
          scope: "league",
          team,
          ...(batchCoverage.type === "week" ? { period: { week: batchCoverage.week } } : {}),
          coverage: [rosterCoverage],
          failures: [],
          budget: playerListBudget,
        };
        return yield* fitPage({
          schema: LeagueRosterSchema,
          rows: teams,
          offset,
          limit: pageSize,
          pageSize,
          total: teams.length,
          budget: playerListBudget,
          resource: "roster.teams",
          groups: [detail],
          remedy:
            "Request fewer teams with `limit`, or use `detail: compact`. A league page keeps every team's roster whole.",
          build: (pageRows, page) => ({ ...base, teams: [...pageRows], page }),
          makeNext: (nextOffset) =>
            tokens.sealCursor({ userId, fingerprint: fingerprintValue, offset: nextOffset, now }),
          recordLabel: (row) => row.team,
        });
      });

    const getRosters = Effect.fn("FantasyQueries.getRosters")(function* (
      userId: UserId,
      input: GetRostersInput,
    ) {
      const context = yield* loadContext(userId, input.team);
      if ((input.scope ?? "team") === "league") {
        return yield* getLeagueRosters(userId, context, input);
      }
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
      ): Effect.Effect<ReadOutcome<ProviderRoster>, QueryPersistenceFailed> =>
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
          team,
          period,
          fetchedAt,
          rosterOutcome,
          leagueOutcome,
          detail === "full" ? ownerNoteOf(context.owned.team) : undefined,
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
      const currentWeek = window?.current;
      const weekFailures: QueryFailure[] = [];
      const projectedRanks = new Map<string, number | null>();
      if (
        roster.coverage.type === "week" &&
        roster.coverage.week === currentWeek &&
        context.provider.capabilities.projections.sports.includes(context.owned.team.sport)
      ) {
        const weekOutcome = yield* readOutcome(
          context,
          "player_weeks",
          context.provider.readPlayerWeeks({
            ...providerIdentity(context),
            providerLeagueKey: context.owned.team.providerLeagueKey,
            providerPlayerKeys: roster.players.map((player) => player.providerPlayerKey),
            week: { week: roster.coverage.week },
          }),
        );
        if (weekOutcome._tag === "ok") {
          for (const fact of weekOutcome.value) {
            projectedRanks.set(fact.providerPlayerKey, fact.projectedRank ?? null);
          }
        } else if (weekOutcome._tag === "failed") {
          weekFailures.push(weekOutcome.failure);
        }
      }
      const players = yield* Effect.forEach(
        roster.players,
        (player) =>
          rosterPlayer(
            context,
            tokens,
            player,
            detail,
            rosterWeek(player, roster.coverage, projectedRanks.get(player.providerPlayerKey)),
            startingStatusOf(player.startingLineup),
          ),
        { concurrency: 1 },
      );
      const fingerprintValue = yield* queryFingerprint(
        `rosters|team=${input.team}|period=${periodKey}|detail=${detail}|order=slot,player`,
      );
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      const base: Omit<RosterData, "players" | "page"> = {
        status: "ok",
        scope: "team",
        team,
        ...(roster.coverage.type === "week" ? { period: { week: roster.coverage.week } } : {}),
        coverage: [leagueCoverage(leagueOutcome, fetchedAt), rosterCoverage],
        ...(detail === "full" ? { ownerNote: ownerNoteOf(context.owned.team) } : {}),
        failures: [...leagueFailure(leagueOutcome), ...weekFailures],
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
      const requestedWindow: ProviderStatPeriod | undefined =
        input.window === undefined ? undefined : normalizeStatPeriod(input.window);
      const playerSearch = context.provider.capabilities.playerSearch;
      if (!playerSearch.sorts.includes(sort)) {
        return yield* QuerySelectionInvalid.make({
          detail: `Your league does not accept the \`${sort}\` player sort. Choose one of: ${playerSearch.sorts.join(", ")}.`,
        });
      }
      if (requestedWindow?.kind === "week" && !playerSearch.weeklyOrderingValues) {
        return yield* QuerySelectionInvalid.make({
          detail:
            "Your league's player search publishes no weekly rank or stat value, so a weekly ordering cannot be shown in the rows. Use a season window, or sort by name, position, or ownership.",
        });
      }
      let leagueOutcome: ReadOutcome<ProviderLeagueSettings> | undefined;
      let formWindow: RecentFormWindow | undefined;
      if (sort === "recent_rank") {
        leagueOutcome = yield* readLeague(context);
        if (leagueOutcome._tag !== "ok") {
          return searchWithoutData(team, fetchedAt, leagueOutcome);
        }
        const leagueSearch = leagueOutcome.value.playerSearch;
        if (leagueSearch === undefined || leagueSearch.status === "unverified") {
          return yield* QuerySelectionInvalid.make({
            detail:
              leagueSearch?.detail ??
              "This league's recent-form windows could not be verified, so they cannot order the pool. Order by ownership, a season rank, or a season stat instead.",
          });
        }
        if (!leagueSearch.sorts.includes("recent_rank")) {
          return yield* QuerySelectionInvalid.make({
            detail: `${leagueSearch.detail} Order the pool by ownership, a season rank, or a season stat instead.`,
          });
        }
        if (requestedWindow === undefined) {
          return yield* QuerySelectionInvalid.make({
            detail: `A recent-form ordering needs a window. ${leagueSearch.detail}`,
          });
        }
        if (requestedWindow.kind !== "last_days" && requestedWindow.kind !== "last_weeks") {
          return yield* QuerySelectionInvalid.make({
            detail: `Recent form is ordered over the last N days or weeks, not ${describeStatWindow(requestedWindow)}. ${leagueSearch.detail} The season rank order is \`actual_rank\`.`,
          });
        }
        formWindow = leagueSearch.windows.find((window) => sameStatWindow(window, requestedWindow));
        if (formWindow === undefined) {
          const nearest = nearestStatWindow(requestedWindow, leagueSearch.windows);
          return yield* QuerySelectionInvalid.make({
            detail: `${leagueSearch.detail}${
              nearest === undefined
                ? " Order the pool by ownership, a season rank, or a season stat instead."
                : ` The nearest window is ${describeStatWindow(nearest)}; ask for it.`
            }`,
          });
        }
      } else if (requestedWindow !== undefined && requestedWindow.kind !== "season") {
        const weekly = requestedWindow.kind === "week" && sort === "stat";
        if (!weekly) {
          return yield* QuerySelectionInvalid.make({
            detail:
              sort === "stat"
                ? "A stat ordering reads a season value or a completed scoring week; a recent window orders the pool by recent rank instead."
                : "Recent windows order the pool by recent rank. Use sort `recent_rank` with that window, or omit `window`.",
          });
        }
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
      const positions = new Set(input.positions ?? []);
      const orderingPositions =
        sort === "recent_rank" ? providerPositionCodes(positions) : undefined;
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
        if (resolved._tag === "informational") {
          return yield* QuerySelectionInvalid.make({
            detail: `${resolved.name} is informational for this league: your league publishes it but the league does not score it, so it cannot order a scored search. Sort by one of this league's scoring categories, or by name, position, ownership, or your league rank.`,
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
          sport: context.owned.team.sport,
          season: context.owned.team.season,
          query,
          availability,
          sort,
          statId,
          statType: requestedWindow?.kind === "week" ? "week" : "season",
          window: formWindow,
          positions: orderingPositions,
          limit: 50,
        }),
      );
      if (outcome._tag !== "ok") {
        return searchWithoutData(team, fetchedAt, outcome);
      }
      leagueOutcome = leagueOutcome ?? (yield* readLeague(context));
      const league = leagueOutcome._tag === "ok" ? leagueOutcome.value : undefined;
      const requestedGamesWindow = input.gamesWindow;
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
      const failures: QueryFailure[] = [];
      const draft = yield* draftProvenance(
        context,
        fetchedAt,
        ordered.map((player) => player.providerPlayerKey),
        "players",
      );
      for (const failure of draft.failures ?? []) {
        failures.push(failure);
      }
      const currentWeek =
        league?.rosterCoverage === "week" ? currentPeriod(league.periodWindow) : undefined;
      const weekFacts = new Map<string, ProviderPlayerWeekFact>();
      let weekFactsWeek: number | undefined;
      if (currentWeek !== undefined) {
        const weekOutcome = yield* readOutcome(
          context,
          "player_weeks",
          context.provider.readPlayerWeeks({
            ...providerIdentity(context),
            providerLeagueKey: context.owned.team.providerLeagueKey,
            providerPlayerKeys: ordered.map((player) => player.providerPlayerKey),
            week: currentWeek,
          }),
        );
        if (weekOutcome._tag === "ok") {
          weekFactsWeek = currentWeek.week;
          for (const fact of weekOutcome.value) {
            weekFacts.set(fact.providerPlayerKey, fact);
          }
        } else if (weekOutcome._tag === "failed") {
          failures.push(weekOutcome.failure);
        }
      }
      const poolGames =
        requestedGamesWindow === undefined
          ? undefined
          : yield* readPoolGamesForWindow(
              context,
              requestedGamesWindow,
              leagueOutcome,
              ordered.map((player) => player.providerPlayerKey),
              weekFacts,
              weekFactsWeek,
            );
      const publishesProjections = context.provider.capabilities.projections.sports.includes(
        context.owned.team.sport,
      );
      const missingProTeamKeys = ordered.flatMap((player) =>
        player.proTeamKey === undefined && player.proTeam !== undefined ? [player.proTeam] : [],
      );
      const proTeamIdentities =
        missingProTeamKeys.length === 0
          ? []
          : yield* scheduleObservations.readProviderTeamIdentities({
              sport: context.owned.team.sport,
              identifiers: missingProTeamKeys,
            });
      const proTeamKeyByAbbreviation = uniqueProviderTeamKeys(proTeamIdentities);
      const poolProTeamKey = (player: (typeof ordered)[number]): string | undefined =>
        player.proTeamKey ??
        (player.proTeam === undefined ? undefined : proTeamKeyByAbbreviation.get(player.proTeam));
      const refs = yield* tokens.sealPlayerRefs({
        userId,
        leagueKey: context.owned.team.providerLeagueKey,
        playerKeys: ordered.map((player) => player.providerPlayerKey),
      });
      const players = EffectArray.map(EffectArray.zip(ordered, refs), ([player, playerRef]) => {
        const proTeamKey = poolProTeamKey(player);
        const week = weekFacts.get(player.providerPlayerKey);
        return {
          player: playerRef,
          name: player.name,
          draft: draft.lookup(player.providerPlayerKey),
          primaryPosition: player.primaryPosition,
          displayPosition: player.displayPosition,
          proTeam: player.proTeam ?? null,
          ...(poolGames?.status !== "available"
            ? {}
            : poolGames.basis === "date"
              ? { gameDays: poolGameDays(poolGames, proTeamKey) }
              : { gameWeeks: poolGameWeeks(poolGames, player.providerPlayerKey) }),
          ...(week === undefined
            ? {}
            : {
                week: poolWeek(
                  week,
                  publishesProjections ? (week.projectedRank ?? null) : undefined,
                ),
              }),
          eligiblePositions: player.eligiblePositions,
          availability: player.availability,
          status: {
            value: player.status.value,
            ...(player.status.code === undefined ? {} : { code: player.status.code }),
            ...(player.status.detail === undefined ? {} : { detail: player.status.detail }),
            observedAt: fetchedAt,
          },
          percentOwned: player.percentOwned,
          percentOwnedDelta: player.percentOwnedDelta,
          percentStarted: player.percentStarted,
          percentStartedChange: player.percentStartedChange,
          actualRank: player.actualRank,
          overallRank: player.overallRank,
          ...(sort === "recent_rank" && player.recentRank !== undefined
            ? { recentRank: player.recentRank }
            : {}),
          transactionTrend: player.transactionTrend,
          ...(sort === "stat" ? { statValue: player.statValue } : {}),
        };
      });
      const fingerprintValue = yield* queryFingerprint(
        [
          "search_players",
          `team=${input.team}`,
          `query=${query ?? ""}`,
          `positions=${[...positions].sort().join(",")}`,
          `availability=${availability}`,
          `sort=${sort}`,
          `stat=${input.stat ?? ""}`,
          `window=${requestedWindow === undefined ? "season" : statWindowKey(requestedWindow)}`,
          `gamesWindow=${gamesWindowKey(requestedGamesWindow)}`,
          "order=provider",
        ].join("|"),
      );
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      const base: Omit<SearchPlayersData, "players" | "page"> = {
        status: "ok",
        team,
        coverage: [
          coverage("players", "player_search", fetchedAt),
          ...(draft.coverage === undefined ? [] : [draft.coverage]),
          ...(poolGames?.status === "available"
            ? [
                coverage(
                  "players",
                  poolGames.basis === "date" ? "professional_games" : "provider_opponent",
                  poolGames.observedAt,
                  undefined,
                  poolGames.basis === "date"
                    ? "Game days in the requested window, from the league's professional games."
                    : "Game weeks in the requested window, from the league's own opponent facts.",
                ),
              ]
            : []),
        ],
        ...(poolGames === undefined
          ? {}
          : {
              gamesWindow:
                poolGames.status !== "available"
                  ? { status: "unsupported", detail: poolGames.detail }
                  : poolGames.basis === "date"
                    ? {
                        status: "available",
                        basis: "date",
                        window: poolGames.window,
                        observedAt: poolGames.observedAt,
                      }
                    : {
                        status: "available",
                        basis: "week",
                        weeks: poolGames.weeks,
                        observedAt: poolGames.observedAt,
                      },
            }),
        failures,
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
      const failures: QueryFailure[] = resolved.flatMap((row, index) =>
        row.providerPlayerKey === undefined
          ? [
              {
                code: "invalid_player_reference",
                resource: row.ref,
                message: `The player reference at input position ${String(index + 1)} is invalid for this team and owner.`,
              },
            ]
          : [],
      );
      const coverageEntries: QueryCoverage[] = [];
      const draft = yield* draftProvenance(
        context,
        fetchedAt,
        groups.includes("identity") ? valid.map((row) => row.providerPlayerKey) : [],
        "players",
      );
      if (draft.coverage !== undefined) {
        coverageEntries.push(draft.coverage);
      }
      for (const failure of draft.failures ?? []) {
        failures.push(failure);
      }
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
      const rosterByKey = new Map(
        (roster?.players ?? []).map((player) => [player.providerPlayerKey, player]),
      );
      const requestedPeriod = normalizeStatPeriod(input.period);
      const includesActualStats = groups.includes("actual_stats");
      const detailKeys = includesActualStats
        ? valid.map((row) => row.providerPlayerKey)
        : groups.includes("availability")
          ? valid
              .filter((row) => !rosterByKey.has(row.providerPlayerKey))
              .map((row) => row.providerPlayerKey)
          : [];
      let details: ReadonlyArray<ProviderPlayerDetail> = [];
      let detailsUnsupported: string | undefined;
      if (includesActualStats || detailKeys.length > 0) {
        const detailsOutcome = yield* readOutcome(
          context,
          "players",
          context.provider.readPlayerDetails({
            ...providerIdentity(context),
            providerLeagueKey: leagueKey,
            providerPlayerKeys: detailKeys,
            sport: context.owned.team.sport,
            period: requestedPeriod,
            currentPeriod: league?.periodWindow?.current,
            seasonStart: league?.startDate,
            seasonEnd: league?.endDate,
          }),
        );
        if (detailsOutcome._tag === "ok") {
          details = detailsOutcome.value;
          const basis = includesActualStats
            ? details.find((player) => player.actual !== undefined)?.actual?.basis
            : undefined;
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
            includesActualStats &&
            detailsOutcome._tag === "failed" &&
            detailsOutcome.failure.code === "period_unsupported"
          ) {
            return yield* QuerySelectionInvalid.make({
              detail: `${periodKindRefusal(requestedPeriod)} ${detailsOutcome.failure.message}`,
            });
          }
          if (includesActualStats) {
            detailsUnsupported =
              detailsOutcome._tag === "unsupported"
                ? detailsOutcome.detail
                : detailsOutcome.failure.message;
          }
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
                    detail: `Summed from ${String(group.basis.days)} daily reads; categories in \`notAggregated\` are not summed.`,
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
          const relevant = configuredCategories(league).filter(
            (category) =>
              category.scoring === "scoring" &&
              (positionType === undefined ||
                category.positionTypes.length === 0 ||
                category.positionTypes.includes(positionType)),
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
      const projectionsSupported = context.provider.capabilities.projections.sports.includes(
        context.owned.team.sport,
      );
      const projectionWeek =
        league?.rosterCoverage === "week" ? league.periodWindow?.current : undefined;
      const weekFacts = new Map<string, ProviderPlayerWeekFact>();
      let projectionUnavailable = false;
      if (
        groups.includes("projections") &&
        projectionsSupported &&
        projectionWeek !== undefined &&
        valid.length > 0
      ) {
        const weekOutcome = yield* readOutcome(
          context,
          "player_weeks",
          context.provider.readPlayerWeeks({
            ...providerIdentity(context),
            providerLeagueKey: leagueKey,
            providerPlayerKeys: valid.map((row) => row.providerPlayerKey),
            week: { week: projectionWeek },
          }),
        );
        if (weekOutcome._tag === "ok") {
          for (const fact of weekOutcome.value) {
            weekFacts.set(fact.providerPlayerKey, fact);
          }
        } else {
          projectionUnavailable = true;
          if (weekOutcome._tag === "failed") {
            failures.push(weekOutcome.failure);
          }
        }
      }
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
                  : { rosterStatus: detail.rosterStatus, injury: injuryOfDetail(detail) };
            if (groups.includes("availability") && availability === undefined) {
              failures.push({
                code: "player_availability_unavailable",
                resource: row.ref,
                message:
                  "Your league returned no roster or selected-player status for this player.",
              });
            }
            const actualStats = !groups.includes("actual_stats")
              ? undefined
              : detailsUnsupported !== undefined
                ? { status: "unsupported" as const, detail: detailsUnsupported }
                : detail?.actual === undefined
                  ? {
                      status: "unsupported" as const,
                      detail: "Your league reported no actual statistics for this player.",
                    }
                  : yield* statGroup(detail.actual);
            const projections = !groups.includes("projections")
              ? undefined
              : projectionsSupported && projectionWeek !== undefined && !projectionUnavailable
                ? {
                    status: "available" as const,
                    basis: "week" as const,
                    period: { week: projectionWeek },
                    rank: weekFacts.get(row.providerPlayerKey)?.projectedRank ?? null,
                  }
                : { status: "unsupported" as const, reason: "not_published" as const };
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
                message: "Your league did not return identity data for this player.",
              });
            }
            return {
              player: row.ref,
              ...(identity === undefined
                ? {}
                : { identity: { ...identity, draft: draft.lookup(row.providerPlayerKey) } }),
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
          `period=${statWindowKey(requestedPeriod)}`,
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
        limit: input.limit ?? input.players.length,
        resource: "players",
        groups,
        remedy: "Select fewer player groups or fewer player references.",
        build: (pageRows, page) => ({ ...base, players: [...pageRows], page }),
        makeNext: (nextOffset) =>
          tokens.sealCursor({ userId, fingerprint: fingerprintValue, offset: nextOffset, now }),
        recordLabel: (row) => row.player,
        budget: playerListBudget,
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
      const categoryLabelsByStat = categoryLabels(
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
                        labelledCategories(
                          matchup.home.categoryTotals,
                          categoryLabelsByStat,
                          new Set(),
                        ),
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
                        labelledCategories(
                          matchup.away.categoryTotals,
                          categoryLabelsByStat,
                          new Set(),
                        ),
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
      const bounded = since !== undefined || until !== undefined;
      const fetchedTransactions: ProviderTransaction[] = [];
      let pageOffset = 0;
      let pageCount = 0;
      let windowTruncated = false;
      let pageFailure: FailureOutcome | undefined;
      for (;;) {
        const outcome = yield* readOutcome(
          context,
          "transactions",
          context.provider.readTransactions({
            ...providerIdentity(context),
            providerLeagueKey: context.owned.team.providerLeagueKey,
            providerTeamKey: scope === "team" ? context.owned.team.providerTeamKey : undefined,
            limit: transactionReadPageSize,
            offset: pageOffset,
          }),
        );
        if (outcome._tag !== "ok") {
          if (fetchedTransactions.length === 0) {
            return transactionsWithoutData(team, fetchedAt, outcome);
          }
          pageFailure = outcome;
          windowTruncated = true;
          break;
        }
        const page = outcome.value;
        for (const transaction of page) {
          fetchedTransactions.push(transaction);
        }
        pageCount += 1;
        const oldest = fetchedTransactions.at(-1)?.occurredAt;
        const reachedBound =
          oldest !== undefined &&
          (since !== undefined ? oldest <= since : until !== undefined ? oldest <= until : false);
        const fullPage = page.length === transactionReadPageSize;
        if (!bounded) {
          windowTruncated = fullPage;
          break;
        }
        if (!fullPage || reachedBound) {
          break;
        }
        if (pageCount >= transactionReadMaximumPages) {
          windowTruncated = true;
          break;
        }
        pageOffset += page.length;
      }
      const filtered = fetchedTransactions.filter(
        (transaction) =>
          (since === undefined || transaction.occurredAt >= since) &&
          (until === undefined || transaction.occurredAt <= until),
      );
      const window: TransactionWindow = {
        fetched: fetchedTransactions.length,
        truncated: windowTruncated,
        ...(fetchedTransactions[0] === undefined
          ? {}
          : { latest: fetchedTransactions[0].occurredAt }),
        ...(fetchedTransactions.at(-1) === undefined
          ? {}
          : { earliest: fetchedTransactions.at(-1)?.occurredAt }),
      };
      const beforeHistory =
        since !== undefined && window.earliest !== undefined && since < window.earliest;
      const coverageEntries = [
        windowTruncated
          ? degradedCoverage(
              "transactions",
              "transactions",
              fetchedAt,
              "The bounded transaction read reached its history limit before the requested range began; older moves are not included.",
            )
          : beforeHistory
            ? degradedCoverage(
                "transactions",
                "transactions",
                fetchedAt,
                `Your league publishes no transaction older than ${String(window.earliest)}, so the requested range is not complete.`,
              )
            : coverage("transactions", "transactions", fetchedAt),
        ...(pageFailure === undefined
          ? []
          : [
              pageFailure._tag === "failed"
                ? degradedCoverage(
                    "transactions",
                    "transactions",
                    fetchedAt,
                    pageFailure.failure.message,
                  )
                : unsupportedCoverage("transactions", "transactions", fetchedAt),
            ]),
      ];
      const windowFailure: QueryFailure | undefined = windowTruncated
        ? {
            code: "transaction_window_truncated",
            resource: "transactions",
            message:
              "Your league has more transaction history than this bounded read fetches, so this date range may omit older moves.",
          }
        : beforeHistory
          ? {
              code: "transaction_history_starts_after_range",
              resource: "transactions",
              message: `Your league publishes no transaction older than ${String(window.earliest)}, so this range starts before the available history.`,
            }
          : undefined;
      const failures: QueryFailure[] = [
        ...(pageFailure?._tag === "failed" ? [pageFailure.failure] : []),
        ...(windowFailure === undefined ? [] : [windowFailure]),
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
        failures,
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
      const agentNotes = yield* repository.recentAgentNotes(userId, input.team);
      const fetchedAt = yield* DateTime.now;
      const groups = [...new Set(input.groups ?? defaultSummaryGroups)];
      if (groups.length === 0) {
        return yield* QuerySelectionInvalid.make({
          detail:
            "Select at least one summary group: league, standings, categories, matchup, schedule, or roster.",
        });
      }
      const includes = (group: SummaryGroup): boolean => groups.includes(group);
      if (input.window !== undefined && input.days !== undefined) {
        return yield* QuerySelectionInvalid.make({
          detail: "Pass `window` or `days` for the schedule, not both.",
        });
      }
      const requestedDates =
        input.window === undefined
          ? undefined
          : scheduleWindowDates(input.window.start, input.window.end);
      if (input.window !== undefined && requestedDates === undefined) {
        return yield* QuerySelectionInvalid.make({
          detail:
            "`window` needs real `YYYY-MM-DD` dates in order, with `start` on or before `end`.",
        });
      }
      const coverageEntries: QueryCoverage[] = [];
      const failures: QueryFailure[] = [];
      const statRefs = new Map<number, StatRef>();

      const leagueOutcome = yield* readLeague(context);
      const league = leagueOutcome._tag === "ok" ? leagueOutcome.value : undefined;
      const leagueSection: TeamSummaryData["league"] = !includes("league")
        ? undefined
        : leagueOutcome._tag === "ok"
          ? { status: "available", ...leagueFacts(leagueOutcome.value) }
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
      const categoryLabelsByStat = categoryLabels(league);
      const standingTable =
        standingsOutcome?._tag === "ok"
          ? yield* standingRows(
              context,
              tokens,
              standingsOutcome.value,
              league === undefined ? undefined : categoryLabelsByStat,
              acquisitionLimitValues(league),
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
            ? "Your league standings did not include this team."
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
                    : "Your league published no season category totals for this league format.",
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
                      : "Your league publishes rotisserie category points only for rotisserie leagues.",
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
                ...(row.gamesBack === null ? {} : { gamesBack: row.gamesBack }),
                ...(row.pointsBack === null ? {} : { pointsBack: row.pointsBack }),
              })),
            }
          : { status: "unsupported", detail: standingsDetail };
      const acquisitionUsageSection: TeamSummaryData["acquisitionUsage"] = !includes("standings")
        ? undefined
        : current === undefined || standingsOutcome?._tag !== "ok"
          ? { status: "unsupported", detail: standingsDetail }
          : league === undefined
            ? {
                status: "unsupported",
                detail:
                  "The league settings could not be read, so the acquisition limits and any remaining count cannot be verified.",
              }
            : {
                status: "available",
                limits: acquisitionLimitsOf(league),
                usage: current.acquisitionUsage,
                gamesPlayedUsage: {
                  status: "not_published",
                  detail: limitation(context.provider, "per_team_games_played"),
                },
              };

      const window = league?.periodWindow;
      const period = currentPeriod(window);
      const hasProfessionalGameSource =
        gameSources.sourceFor(context.owned.team.league) !== undefined;
      const readRoster = (
        requested: QueryPeriod | undefined,
      ): Effect.Effect<ReadOutcome<ProviderRoster>, QueryPersistenceFailed> =>
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
      if (includes("roster") || (includes("schedule") && hasProfessionalGameSource)) {
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
      const draft = yield* draftProvenance(
        context,
        fetchedAt,
        includes("roster") ? rosterPlayers.map((player) => player.providerPlayerKey) : [],
        "roster",
      );
      if (draft.coverage !== undefined) {
        coverageEntries.push(draft.coverage);
      }
      for (const failure of draft.failures ?? []) {
        failures.push(failure);
      }
      const rosterRefs = yield* tokens.sealPlayerRefs({
        userId,
        leagueKey: context.owned.team.providerLeagueKey,
        playerKeys: rosterPlayers.map((player) => player.providerPlayerKey),
      });
      const rosterCoverage =
        rosterOutcome?._tag === "ok" ? rosterOutcome.value.coverage : undefined;
      const rosterPeriod =
        includes("roster") && rosterCoverage?.type === "week"
          ? { week: rosterCoverage.week }
          : undefined;
      const rosterProjectionByKey = new Map<string, number>();
      if (
        includes("roster") &&
        rosterPeriod !== undefined &&
        period !== undefined &&
        rosterPeriod.week === period.week &&
        context.provider.capabilities.projections.sports.includes(context.owned.team.sport)
      ) {
        const weekOutcome = yield* readOutcome(
          context,
          "player_weeks",
          context.provider.readPlayerWeeks({
            ...providerIdentity(context),
            providerLeagueKey: context.owned.team.providerLeagueKey,
            providerPlayerKeys: rosterPlayers.map((player) => player.providerPlayerKey),
            week: rosterPeriod,
          }),
        );
        if (weekOutcome._tag === "ok") {
          for (const fact of weekOutcome.value) {
            if (fact.projectedRank !== undefined) {
              rosterProjectionByKey.set(fact.providerPlayerKey, fact.projectedRank);
            }
          }
        }
      }
      const rosterRowByKey = new Map<string, SummaryRosterPlayer>();
      for (const [player, ref] of EffectArray.zip(rosterPlayers, rosterRefs)) {
        const week =
          rosterCoverage === undefined
            ? undefined
            : rosterWeek(
                player,
                rosterCoverage,
                rosterProjectionByKey.get(player.providerPlayerKey),
              );
        rosterRowByKey.set(player.providerPlayerKey, {
          player: ref,
          name: player.name,
          draft: draft.lookup(player.providerPlayerKey),
          slot: player.slot,
          primaryPosition: player.primaryPosition,
          eligiblePositions: player.eligiblePositions,
          proTeam: player.proTeamAbbreviation ?? null,
          ...(week === undefined ? {} : { week }),
          injury: {
            reported: player.injuryCode !== undefined || player.injuryDetail !== undefined,
            ...(player.injuryCode === undefined ? {} : { code: player.injuryCode }),
          },
          startingStatus: startingStatusOf(player.startingLineup),
        });
      }

      const matchupOutcome =
        (!includes("matchup") && !includes("schedule")) || period === undefined
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
          detail: "Your league returned no matchup for this team in the current week.",
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
          ...(includes("categories") &&
          (own.categoryTotals.length > 0 || opponent.categoryTotals.length > 0)
            ? {
                categories: yield* summaryMatchupCategories(
                  context,
                  tokens,
                  statRefs,
                  own.categoryTotals,
                  opponent.categoryTotals,
                  categoryLabelsByStat,
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

      const windowDates = publishedWeekWindow(
        currentMatchup,
        matchupOutcome?._tag === "ok" ? matchupOutcome.value : undefined,
      );
      const scheduleWindowResolution: ScheduleWindowResolution = !includes("schedule")
        ? { status: "unavailable", detail: "The schedule group was not requested." }
        : league === undefined
          ? { status: "unavailable", detail: leagueUnavailableDetail(leagueOutcome) }
          : resolveScheduleWindow({
              league,
              period,
              requestedDates,
              days: input.days,
              weekDates: windowDates,
              hasProfessionalGameSource,
            });
      const schedulePeriod =
        scheduleWindowResolution.status === "resolved"
          ? scheduleWindowResolution.period
          : undefined;
      const scheduleWindow =
        scheduleWindowResolution.status === "resolved"
          ? scheduleWindowResolution.window
          : undefined;
      const requestedScheduleDates =
        scheduleWindow === undefined
          ? undefined
          : scheduleWindowDates(scheduleWindow.start, scheduleWindow.end);
      const providerDateBound = context.provider.capabilities.scheduleRead.maximumDates;
      const providerScheduleBoundDetail =
        !hasProfessionalGameSource &&
        requestedScheduleDates !== undefined &&
        requestedScheduleDates.length > providerDateBound
          ? `One read of this league's roster schedule covers at most ${String(providerDateBound)} dates, and this window covers ${String(requestedScheduleDates.length)}. Ask for a narrower window or use \`days\`.`
          : undefined;
      const scheduleOutcome =
        !includes("schedule") ||
        schedulePeriod === undefined ||
        hasProfessionalGameSource ||
        providerScheduleBoundDetail !== undefined
          ? undefined
          : yield* readOutcome(
              context,
              "schedule",
              readProviderOpponent({
                store: scheduleObservations,
                provider: context.provider,
                material: providerIdentity(context),
                teamId: context.owned.team.id,
                sport: context.owned.team.sport,
                providerTeamKey: context.owned.team.providerTeamKey,
                period: schedulePeriod,
              }),
            );
      const gamesRemainingSources = new Set<GamesRemainingSource>();
      const schedulePlayerByKey = new Map<string, SummarySchedulePlayer>();
      let scheduleSection: TeamSummaryData["schedule"];
      if (!includes("schedule")) {
        scheduleSection = undefined;
      } else if (scheduleWindowResolution.status === "unavailable") {
        scheduleSection = {
          status: "unsupported",
          detail: scheduleWindowResolution.detail,
        };
      } else if (providerScheduleBoundDetail !== undefined) {
        scheduleSection = { status: "unsupported", detail: providerScheduleBoundDetail };
      } else if (hasProfessionalGameSource) {
        const professional = yield* professionalScheduleSection({
          calendar,
          league: context.owned.team.league,
          sport: context.owned.team.sport,
          rosterPlayers,
          rosterRefs,
          rosterRowByKey,
          window: scheduleWindow,
          period,
          store: scheduleObservations,
        });
        scheduleSection = professional.section;
        for (const [providerPlayerKey, row] of professional.players) {
          schedulePlayerByKey.set(providerPlayerKey, row);
        }
        if (professional.section.status === "available") {
          coverageEntries.push(
            coverage(
              "schedule",
              "professional_games",
              professional.section.observedAt,
              undefined,
              "Games and opponents from the league's professional schedule.",
            ),
          );
        }
      } else if (schedulePeriod === undefined || scheduleOutcome === undefined) {
        scheduleSection = {
          status: "unsupported",
          detail: "Your league did not return a schedule for this window.",
        };
      } else if (scheduleOutcome._tag !== "ok") {
        scheduleSection = {
          status: "unsupported",
          detail:
            scheduleOutcome._tag === "failed"
              ? scheduleOutcome.failure.message
              : scheduleOutcome.detail,
        };
        if (scheduleOutcome._tag === "failed") {
          failures.push(scheduleOutcome.failure);
        }
      } else {
        const schedule = scheduleOutcome.value.schedule;
        const professionalWindow = scheduleWindow ?? windowDates;
        const professionalGames: ProfessionalScheduleGames =
          professionalWindow === undefined
            ? {
                status: "unavailable",
                detail:
                  "Your league publishes no date window for this schedule, so the league's games cannot be placed on its dates.",
              }
            : yield* readProfessionalScheduleGames({
                calendar,
                league: context.owned.team.league,
                from: professionalWindow.start,
                to: professionalWindow.end,
              });
        const scheduleDates =
          scheduleWindow === undefined ? undefined : scheduleDateCounts(schedule);
        const leagueByDate =
          professionalGames.status === "available"
            ? leagueGamesByDate(professionalGames.games)
            : undefined;
        const offNightByDate = new Map<string, boolean>();
        if (
          leagueByDate !== undefined &&
          professionalGames.status === "available" &&
          scheduleDates !== undefined
        ) {
          for (const entry of scheduleDates) {
            offNightByDate.set(
              entry.date,
              isLeagueOffNight({
                teamsPlaying: leagueByDate.get(entry.date)?.teamsPlaying ?? 0,
                teamCount: professionalGames.teamCount,
              }),
            );
          }
        }
        let providerFallbackForMissingGame = 0;
        const scheduleRefs = yield* tokens.sealPlayerRefs({
          userId,
          leagueKey: context.owned.team.providerLeagueKey,
          playerKeys: schedule.players.map((player) => player.providerPlayerKey),
        });
        for (const [player, sealedRef] of EffectArray.zip(schedule.players, scheduleRefs)) {
          const rosterRow = rosterRowByKey.get(player.providerPlayerKey);
          const providerGames = providerGamesInWindow(player.games, scheduleWindow);
          const professionalCount =
            professionalGames.status === "available" && player.proTeamKey !== undefined
              ? countGamesForTeam(professionalGames.games, player.proTeamKey)
              : undefined;
          const gamesRemaining: SummarySchedulePlayer["gamesRemaining"] =
            professionalCount === undefined
              ? {
                  status: "available",
                  count: providerGames.length,
                  source: "provider_opponent",
                }
              : professionalCount > 0
                ? {
                    status: "available",
                    count: professionalCount,
                    source: "professional_games",
                  }
                : providerGames.length > 0
                  ? {
                      status: "available",
                      count: providerGames.length,
                      source: "provider_opponent",
                    }
                  : {
                      status: "available",
                      count: 0,
                      source: "professional_games",
                    };
          gamesRemainingSources.add(gamesRemaining.source);
          if (
            professionalCount !== undefined &&
            professionalCount === 0 &&
            providerGames.length > 0
          ) {
            providerFallbackForMissingGame += 1;
          }
          schedulePlayerByKey.set(player.providerPlayerKey, {
            player: rosterRow?.player ?? sealedRef,
            name: rosterRow?.name ?? player.name,
            proTeam: rosterRow?.proTeam ?? player.proTeamAbbreviation ?? null,
            status: providerGames.length === 0 ? "no_games" : "scheduled",
            gameCount: providerGames.length,
            games: scheduledGames(providerGames, offNightByDate),
            gamesRemaining,
          });
        }
        scheduleSection = {
          status: "available",
          coverage: scheduleWindowResolution.coverage,
          ...(period === undefined ? {} : { period }),
          ...(scheduleWindow === undefined ? {} : { window: scheduleWindow }),
          observedAt: scheduleOutcome.value.observedAt,
          ...(scheduleDates === undefined
            ? {}
            : {
                dates: scheduleDates.map((entry) => {
                  const league = leagueByDate?.get(entry.date);
                  const offNight = offNightByDate.get(entry.date);
                  return {
                    date: entry.date,
                    rosterGames: entry.rosterGames,
                    ...(offNight === undefined
                      ? {}
                      : {
                          leagueGames: league?.games ?? 0,
                          teamsPlaying: league?.teamsPlaying ?? 0,
                          offNight,
                        }),
                  };
                }),
              }),
          offNights:
            offNightByDate.size > 0
              ? {
                  status: "available",
                  definition: leagueOffNightDefinition,
                  sport: "hockey",
                }
              : {
                  status: "unsupported",
                  detail: offNightsUnavailableDetail({
                    professionalGames,
                    scheduleWindow,
                    coverage: scheduleWindowResolution.coverage,
                  }),
                },
          gamesRemaining: gamesRemainingState({
            sources: gamesRemainingSources,
            professionalGames,
            window:
              professionalWindow === undefined
                ? undefined
                : (scheduleWindow ?? {
                    start: professionalWindow.start,
                    end: professionalWindow.end,
                    source: "period",
                  }),
            providerObservedAt: scheduleOutcome.value.observedAt,
            providerFallbackForMissingGame,
          }),
          players: [],
          detail: schedulePeriodDetail({
            coverage: scheduleWindowResolution.coverage,
            period,
            window: scheduleWindow,
            dates: schedule.dates,
            maximumDates: context.provider.capabilities.scheduleRead.maximumDates,
          }),
        };
        coverageEntries.push(
          scheduleWindow === undefined
            ? coverage("schedule", "roster_schedule", fetchedAt, period)
            : coverage(
                "schedule",
                "roster_schedule",
                fetchedAt,
                undefined,
                `Dated roster reads for ${schedule.dates.join(", ")}`,
              ),
        );
        if (professionalGames.status === "available") {
          coverageEntries.push(
            coverage(
              "schedule",
              "professional_games",
              professionalGames.observedAt,
              undefined,
              "Games remaining and off nights counted from the league's professional games.",
            ),
          );
        }
      }
      if (scheduleSection?.status === "unsupported") {
        coverageEntries.push(
          unsupportedCoverage(
            "schedule",
            hasProfessionalGameSource ? "professional_games" : "roster_schedule",
            fetchedAt,
            scheduleSection.detail,
          ),
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
      let remainingGamesSection: TeamSummaryData["remainingPlayerGames"];
      if (!includes("matchup")) {
        remainingGamesSection = undefined;
      } else if (period === undefined) {
        remainingGamesSection = {
          status: "unsupported",
          detail: "This league format publishes no scoring-week schedule.",
        };
      } else if (currentRemaining === undefined) {
        remainingGamesSection = {
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
        remainingGamesSection = {
          status: "available",
          unit: "fantasy_team_player_games",
          weeks: [scheduleWeek(period, true, currentRemaining), ...nextWeek],
          ...(nextPeriod === undefined
            ? { detail: "This is the final scoring week of the season." }
            : nextWeek.length === 0
              ? { detail: "Your league did not publish remaining games for the next week." }
              : {}),
        };
      }
      if (remainingGamesSection !== undefined) {
        coverageEntries.push(
          remainingGamesSection.status === "available"
            ? coverage("remaining_player_games", "matchups", fetchedAt, period)
            : unsupportedCoverage(
                "remaining_player_games",
                "matchups",
                fetchedAt,
                remainingGamesSection.detail,
              ),
        );
      }

      const available =
        (includes("league") && leagueOutcome._tag === "ok") ||
        (standingsNeeded && standingsOutcome?._tag === "ok") ||
        (includes("roster") && rosterOutcome?._tag === "ok") ||
        (includes("schedule") && scheduleSection?.status === "available") ||
        (includes("matchup") && matchupSection?.status === "available");
      const status: QueryStatus = available ? "ok" : failures.length > 0 ? "failed" : "unsupported";
      const fingerprintValue = yield* queryFingerprint(
        [
          "team_summary",
          `team=${input.team}`,
          `groups=${[...groups].sort().join(",")}`,
          `period=${rosterPeriod === undefined ? "date" : String(rosterPeriod.week)}`,
          `window=${input.window === undefined ? "period" : `${input.window.start}..${input.window.end}`}`,
          `days=${input.days === undefined ? "default" : String(input.days)}`,
          "order=slot,player,rank",
        ].join("|"),
      );
      const now = yield* DateTime.now;
      const offset = yield* openOffset(userId, fingerprintValue, input.cursor, now);
      const rosterSummary =
        !includes("roster") || rosterOutcome?._tag !== "ok" || league === undefined
          ? undefined
          : rosterOccupancy({
              rule: rosterRuleOf(league.rosterConstraints, league.rosterPositions),
              players: rosterPlayers.map((player) => ({
                key: player.providerPlayerKey,
                name: player.name,
                slot: player.slot.status === "verified" ? player.slot.slot : undefined,
                positions: player.eligiblePositions,
              })),
            });
      const illegalSlots: ReadonlyArray<SummaryIllegalSlot> = (
        rosterSummary?.illegal ?? []
      ).flatMap((occupant) => {
        const row = rosterRowByKey.get(occupant.key);
        return row === undefined
          ? []
          : [
              {
                player: row.player,
                name: occupant.name,
                slot: occupant.slot,
                eligiblePositions: occupant.positions,
                detail: occupant.detail,
              },
            ];
      });
      const base: Omit<TeamSummaryData, "roster" | "page" | "schedule"> = {
        status,
        team,
        ...(rosterPeriod === undefined ? {} : { period: rosterPeriod }),
        ...(leagueSection === undefined ? {} : { league: leagueSection }),
        ...(standingSection === undefined ? {} : { standing: standingSection }),
        ...(recordSection === undefined ? {} : { record: recordSection }),
        ...(categoryTotals === undefined ? {} : { categoryTotals }),
        ...(categoryPoints === undefined ? {} : { categoryPoints }),
        ...(standingsSection === undefined ? {} : { standings: standingsSection }),
        ...(acquisitionUsageSection === undefined
          ? {}
          : { acquisitionUsage: acquisitionUsageSection }),
        ...(matchupSection === undefined ? {} : { matchup: matchupSection }),
        ...(remainingGamesSection === undefined
          ? {}
          : { remainingPlayerGames: remainingGamesSection }),
        ...(includes("roster")
          ? {
              illegalSlots,
              ...(rosterSummary === undefined
                ? {}
                : {
                    rosterPlaces: {
                      maximum: rosterSummary.maximum,
                      occupied: rosterSummary.occupied,
                      reserved: rosterSummary.reserved,
                      remaining: rosterSummary.maximum - rosterSummary.occupied,
                    },
                  }),
            }
          : {}),
        ownerNote: ownerNoteOf(context.owned.team),
        agentNotes,
        coverage: coverageEntries,
        failures,
        budget: summaryBudget,
      };
      const playerRows: ReadonlyArray<{
        readonly roster: SummaryRosterPlayer | undefined;
        readonly schedule: SummarySchedulePlayer | undefined;
      }> = [
        ...rosterPlayers.map((player) => ({
          roster: rosterRowByKey.get(player.providerPlayerKey),
          schedule: schedulePlayerByKey.get(player.providerPlayerKey),
        })),
        ...[...schedulePlayerByKey]
          .filter(([providerPlayerKey]) => !rosterRowByKey.has(providerPlayerKey))
          .map(([, row]) => ({ roster: undefined, schedule: row })),
      ];
      const sectionCandidates: Array<readonly [string, unknown]> = Object.entries(base).filter(
        ([name]) =>
          name !== "status" &&
          name !== "team" &&
          name !== "coverage" &&
          name !== "failures" &&
          name !== "budget",
      );
      if (includes("roster")) {
        sectionCandidates.push(["roster", playerRows[0]?.roster]);
      }
      if (scheduleSection !== undefined) {
        sectionCandidates.push(["schedule", scheduleSection]);
      }
      const largestSection = largestSectionBytes(sectionCandidates);
      return yield* fitPage({
        schema: TeamSummarySchema,
        rows: playerRows,
        offset,
        limit: input.limit ?? 50,
        budget: summaryBudget,
        ...(includes("roster")
          ? {
              resource: "team_summary.roster",
              groups: summaryGroups,
              remedy: `Request fewer summary groups so the selected sections and one roster page fit, or drop \`roster\` entirely and page it with \`get_rosters\`. ${largestSection} The roster pages with the returned cursor, and the available groups are league, standings, categories, matchup, schedule, and roster.`,
            }
          : {
              resource: "team_summary",
              groups: summaryGroups,
              remedy: `No roster page was requested, so the selected sections alone exceed the result budget. ${largestSection} Request fewer groups (currently ${groups.join(", ")}); available groups are league, standings, categories, matchup, schedule, and roster.`,
            }),
        build: (pageRows, page) => ({
          ...base,
          ...(includes("roster")
            ? {
                roster: pageRows.flatMap((row) => (row.roster === undefined ? [] : [row.roster])),
              }
            : {}),
          ...(scheduleSection === undefined
            ? {}
            : {
                schedule:
                  scheduleSection.status === "available"
                    ? {
                        ...scheduleSection,
                        players: pageRows.flatMap((row) =>
                          row.schedule === undefined ? [] : [row.schedule],
                        ),
                      }
                    : scheduleSection,
              }),
          page,
        }),
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

const seasonTotalMissing = "Your league published no season total for this category.";
const rotisseriePointsMissing = "Your league published no rotisserie points for this category.";
const matchupValueMissing = "Your league published no value for this category in the scoring week.";

type LabelledStat = {
  readonly statId: number;
  readonly name: string;
  readonly scoring: CategoryRole;
  readonly value: number | null;
};

type CategoryLabels = ReadonlyMap<
  number,
  { readonly name: string; readonly scoring: CategoryRole }
>;

function categoryLabels(league: ProviderLeagueSettings | undefined): CategoryLabels {
  return new Map(
    (league === undefined ? [] : configuredCategories(league)).map(
      (category): [number, { readonly name: string; readonly scoring: CategoryRole }] => [
        category.statId,
        { name: category.name, scoring: category.scoring },
      ],
    ),
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
        Effect.map((stat): CategoryValue => ({
          stat,
          name: entry.name,
          ...(entry.scoring === "informational" ? { scoring: "informational" as const } : {}),
          ...(entry.value === null
            ? { value: null, detail: missingDetail }
            : { value: entry.value }),
        })),
      ),
    { concurrency: 1 },
  );
}

function summaryMatchupCategories(
  context: TeamContext,
  tokens: QueryTokens["Service"],
  cache: Map<number, StatRef>,
  own: ReadonlyArray<ProviderStatValue>,
  opponent: ReadonlyArray<ProviderStatValue>,
  labels: CategoryLabels,
  missingDetail: string,
): Effect.Effect<ReadonlyArray<SummaryMatchupCategory>> {
  const omitted = new Set<number>();
  const ownByStat = new Map(
    labelledCategories(own, labels, omitted).map((entry) => [entry.statId, entry] as const),
  );
  const opponentByStat = new Map(
    labelledCategories(opponent, labels, omitted).map((entry) => [entry.statId, entry] as const),
  );
  const statIds = [...new Set([...ownByStat.keys(), ...opponentByStat.keys()])];
  return Effect.forEach(
    statIds,
    (statId) =>
      Effect.gen(function* () {
        const entry = ownByStat.get(statId) ?? opponentByStat.get(statId);
        if (entry === undefined) {
          throw new Error("A paired matchup category must have at least one labelled side.");
        }
        const ownValue = ownByStat.get(statId)?.value ?? null;
        const opponentValue = opponentByStat.get(statId)?.value ?? null;
        return {
          stat: yield* statRefFor(context, tokens, cache, statId),
          name: entry.name,
          ...(entry.scoring === "informational" ? { scoring: "informational" as const } : {}),
          own: ownValue,
          opponent: opponentValue,
          ...(ownValue === null || opponentValue === null ? { detail: missingDetail } : {}),
        };
      }),
    { concurrency: 1 },
  );
}

function categoryAvailability(
  rows: ReadonlyArray<StandingRow>,
  select: (row: StandingRow) => ReadonlyArray<CategoryValue>,
  detail: string,
): { readonly status: "available" } | { readonly status: "unsupported"; readonly detail: string } {
  return rows.some((row) => select(row).some((entry) => entry.value !== null))
    ? { status: "available" }
    : { status: "unsupported", detail };
}

function hasPublishedCategoryValue(values: ReadonlyArray<CategoryValue>): boolean {
  return values.some((entry) => entry.value !== null);
}

function omittedCategories(count: number): { readonly count: number; readonly detail: string } {
  return {
    count,
    detail:
      count === 0
        ? "Every category your league published has a league scoring definition."
        : `${String(count)} stat ids in the standings have no league scoring definition and are omitted because they cannot be named.`,
  };
}

function standingsData(
  outcome: ReadOutcome<ProviderStandings>,
  rows: ReadonlyArray<StandingRow>,
  omittedCategoryCount: number,
  format: ProviderLeagueSettings["format"],
  presentation: StandingDetail,
  acquisitionLimits: AcquisitionLimits,
): NonNullable<LeagueData["standings"]> {
  if (outcome._tag !== "ok") {
    return {
      status: "unsupported",
      detail: outcome._tag === "failed" ? outcome.failure.message : outcome.detail,
    };
  }
  const detailNote =
    presentation === "compact"
      ? "Every team row carries rank, points, record, and acquisition usage. `standingsDetail: detailed` adds per-category totals and rotisserie points and pages teams. No per-team games-played count is published."
      : "Per-category totals and points are included, so this form pages teams; request `standings` alone for the most rows per page. No per-team games-played count is published.";
  if (presentation === "compact") {
    return {
      status: "available",
      format,
      presentation,
      detailNote,
      acquisitionLimits,
      teams: [...rows],
    };
  }
  return {
    status: "available",
    format,
    presentation,
    detailNote,
    acquisitionLimits,
    categoryTotals: categoryAvailability(
      rows,
      (row) => row.categories ?? [],
      "Your league published no season category totals for this league format.",
    ),
    categoryPoints: categoryAvailability(
      rows,
      (row) => row.categoryPoints ?? [],
      format === "rotisserie"
        ? rotisseriePointsMissing
        : "Your league publishes rotisserie category points only for rotisserie leagues.",
    ),
    omittedCategories: omittedCategories(omittedCategoryCount),
    teams: [...rows],
  };
}

function standingRows(
  context: TeamContext,
  tokens: QueryTokens["Service"],
  standings: ProviderStandings,
  scoring: CategoryLabels | undefined,
  acquisitionLimits: AcquisitionLimitValues | undefined,
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
            acquisitionUsage: acquisitionUsageOf(standing.acquisitionUsage, acquisitionLimits),
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
  categories: CategoryLabels,
  omitted: Set<number>,
): ReadonlyArray<LabelledStat> {
  const labelled: Array<LabelledStat> = [];
  const published = new Set<number>();
  for (const entry of stats) {
    const category = categories.get(entry.statId);
    if (category === undefined) {
      omitted.add(entry.statId);
      continue;
    }
    published.add(entry.statId);
    labelled.push({
      statId: entry.statId,
      name: category.name,
      scoring: category.scoring,
      value: entry.value,
    });
  }
  for (const [statId, category] of categories) {
    if (!published.has(statId)) {
      labelled.push({ statId, name: category.name, scoring: category.scoring, value: null });
    }
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
        ...(pick.name === undefined ? {} : { name: pick.name }),
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
      "These are the picks your league publishes for this league's draft. Each pick carries your league's inline player name where it publishes one, beside the private player reference. This is draft history, not current or future pick ownership: a traded pick appears on the trade transaction that moved it, and a team's tradeable rounds are checked when a trade proposes one.",
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
          week: leagueWeek(outcome.value),
          dates: {
            ...(outcome.value.startDate === undefined ? {} : { start: outcome.value.startDate }),
            ...(outcome.value.endDate === undefined ? {} : { end: outcome.value.endDate }),
          },
        }
      : {}),
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
                "Your league reported no scoring-week window for this league, so week-scoped periods are unsupported.",
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
                : "Your league did not publish league settings, so standings could not be read.",
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
                : "Your league did not publish league settings, so draft history could not be read.",
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

function leagueRostersWithoutData(
  team: QueryTeam,
  fetchedAt: DateTime.Utc,
  outcome: FailureOutcome,
): LeagueRosterData {
  return {
    status: outcome._tag === "unsupported" ? "unsupported" : "failed",
    scope: "league",
    team,
    teams: [],
    coverage: [
      outcome._tag === "unsupported"
        ? unsupportedCoverage("roster", "league_rosters", fetchedAt, outcome.detail)
        : degradedCoverage("roster", "league_rosters", fetchedAt, outcome.failure.message),
    ],
    failures: outcome._tag === "failed" ? [outcome.failure] : [],
    page: emptyPage(),
    budget: playerListBudget,
  };
}

function rosterWithoutData(
  team: QueryTeam,
  period: QueryPeriod | undefined,
  fetchedAt: DateTime.Utc,
  outcome: ReadOutcome<ProviderRoster>,
  league: ReadOutcome<ProviderLeagueSettings>,
  ownerNote: TeamOwnerNote | undefined,
): RosterData {
  return {
    status: outcome._tag === "unsupported" ? "unsupported" : "failed",
    scope: "team",
    team,
    ...(period === undefined ? {} : { period }),
    players: [],
    ...(ownerNote === undefined ? {} : { ownerNote }),
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

function publishedWeekWindow(
  own: ProviderMatchup | undefined,
  matchups: ReadonlyArray<ProviderMatchup> | undefined,
): { readonly start: string; readonly end: string } | undefined {
  for (const matchup of own === undefined ? (matchups ?? []) : [own, ...(matchups ?? [])]) {
    if (matchup.weekStart !== undefined && matchup.weekEnd !== undefined) {
      return { start: matchup.weekStart, end: matchup.weekEnd };
    }
  }
  return undefined;
}

type ScheduleWindowResolution =
  | {
      readonly status: "resolved";
      readonly coverage: ProviderLeagueSettings["rosterCoverage"];
      readonly period: ProviderSchedulePeriod;
      readonly window: SummaryScheduleWindow | undefined;
    }
  | { readonly status: "unavailable"; readonly detail: string };

const calendarDayMillis = 86_400_000;

function leagueWeek(league: ProviderLeagueSettings): NonNullable<LeagueData["week"]> {
  return league.periodWindow === undefined
    ? { status: "unsupported", reason: "not_published" }
    : {
        status: "available",
        current: league.periodWindow.current,
        start: league.periodWindow.start,
        end: league.periodWindow.end,
      };
}

function calendarTeams(
  schedule: ProviderRosterSchedule,
  requested: ReadonlyArray<string> | undefined,
): {
  readonly teams: ReadonlyArray<CalendarTeamGames>;
  readonly notCovered?: ReadonlyArray<string>;
} {
  const gamesByTeam = new Map<string, Map<string, ProviderScheduledGame>>();
  for (const player of schedule.players) {
    const proTeam = player.proTeamAbbreviation;
    if (proTeam === undefined) {
      continue;
    }
    const games = gamesByTeam.get(proTeam) ?? new Map<string, ProviderScheduledGame>();
    for (const game of player.games) {
      games.set(`${game.date ?? ""}|${game.opponent}|${String(game.home)}`, game);
    }
    gamesByTeam.set(proTeam, games);
  }
  const wanted = requested === undefined ? undefined : [...new Set(requested)];
  const covered = wanted ?? [...gamesByTeam.keys()].sort();
  const teams = covered.flatMap((proTeam) => {
    const games = gamesByTeam.get(proTeam);
    return games === undefined
      ? []
      : [
          {
            proTeam,
            plays: games.size > 0,
            games: [...games.values()].map((game) => ({
              ...(game.date === undefined ? {} : { date: game.date }),
              opponent: game.opponent,
              home: game.home,
            })),
          },
        ];
  });
  const notCovered = wanted?.filter((proTeam) => !gamesByTeam.has(proTeam)) ?? [];
  return { teams, ...(notCovered.length === 0 ? {} : { notCovered }) };
}

function leagueUnavailableDetail(league: ReadOutcome<ProviderLeagueSettings>): string {
  return league._tag === "failed"
    ? league.failure.message
    : league._tag === "unsupported"
      ? league.detail
      : "The league settings could not be read, so no scoring period or current date bounds the schedule.";
}

function resolveScheduleWindow(input: {
  readonly league: ProviderLeagueSettings;
  readonly period: QueryPeriod | undefined;
  readonly requestedDates: ReadonlyArray<string> | undefined;
  readonly days: number | undefined;
  readonly weekDates: { readonly start: string; readonly end: string } | undefined;
  readonly hasProfessionalGameSource: boolean;
}): ScheduleWindowResolution {
  if (input.league.rosterCoverage === "week" && !input.hasProfessionalGameSource) {
    if (input.requestedDates !== undefined || input.days !== undefined) {
      return {
        status: "unavailable",
        detail:
          "This league's coverage is a scoring week, so your league publishes one opponent for the week and no per-date schedule. Omit `window` and `days` to read the week.",
      };
    }
    return input.period === undefined
      ? {
          status: "unavailable",
          detail:
            "The league's current scoring week could not be read, so no week bounds the schedule. Pass `window` or `days` only for a league whose coverage is by date.",
        }
      : {
          status: "resolved",
          coverage: "week",
          period: { type: "week", week: input.period.week },
          window: undefined,
        };
  }
  if (input.requestedDates !== undefined) {
    return dateWindowResolution(input.requestedDates, "requested");
  }
  if (input.days !== undefined) {
    const anchor =
      input.league.currentDate === undefined ? undefined : calendarDate(input.league.currentDate);
    if (anchor === undefined) {
      return {
        status: "unavailable",
        detail:
          "Your league publishes no current date for this league, so a `days` window has no start. Pass `window` with explicit `start` and `end` dates.",
      };
    }
    return dateWindowResolution(
      calendarDates(anchor, DateTime.add(anchor, { days: input.days - 1 })),
      "requested",
    );
  }
  if (input.period !== undefined) {
    if (input.weekDates === undefined) {
      return {
        status: "unavailable",
        detail:
          "Your league publishes no date window for this scoring period, so the dates each player plays are not established. Pass `window` or `days` to choose one; it publishes a dated window only for a league whose scoring period it reports as a matchup week.",
      };
    }
    const dates = scheduleWindowDates(input.weekDates.start, input.weekDates.end);
    return dates === undefined
      ? {
          status: "unavailable",
          detail:
            "Your league's scoring-period window is not a pair of calendar dates, so no dates bound the schedule. Pass `window` with explicit `start` and `end` dates.",
        }
      : dateWindowResolution(dates, "period");
  }
  const anchor =
    input.league.currentDate === undefined ? undefined : calendarDate(input.league.currentDate);
  if (anchor === undefined) {
    return {
      status: "unavailable",
      detail:
        "Your league publishes neither a scoring period nor a current date for this league, so no window bounds the schedule. Pass `window` with explicit `start` and `end` dates, or `days` for a day count.",
    };
  }
  return dateWindowResolution(calendarDates(anchor, restOfWeekEnd(anchor)), "rest_of_week");
}

function searchGamesWindow(input: {
  readonly league: ProviderLeagueSettings;
  readonly period: QueryPeriod | undefined;
  readonly weekDates: { readonly start: string; readonly end: string } | undefined;
}): SummaryScheduleWindow | undefined {
  if (input.weekDates !== undefined) {
    return {
      start: input.weekDates.start,
      end: input.weekDates.end,
      source: input.period === undefined ? "rest_of_week" : "period",
    };
  }
  const anchor =
    input.league.currentDate === undefined ? undefined : calendarDate(input.league.currentDate);
  if (anchor === undefined) {
    return undefined;
  }
  return {
    start: DateTime.formatIsoDate(anchor),
    end: DateTime.formatIsoDate(restOfWeekEnd(anchor)),
    source: "rest_of_week",
  };
}

function dateWindowResolution(
  dates: ReadonlyArray<string> | undefined,
  source: SummaryScheduleWindow["source"],
): ScheduleWindowResolution {
  const start = dates?.[0];
  const end = dates?.at(-1);
  return start === undefined || end === undefined
    ? {
        status: "unavailable",
        detail:
          "The requested dates are not a calendar range in order, so no window bounds the schedule. Pass `window` with `start` on or before `end`.",
      }
    : {
        status: "resolved",
        coverage: "date",
        period: { type: "date", start, end },
        window: { start, end, source },
      };
}

function calendarDate(value: string): DateTime.Utc | undefined {
  const parsed = DateTime.make(`${value}T00:00:00.000Z`);
  return Option.isSome(parsed) && DateTime.formatIsoDate(parsed.value) === value
    ? parsed.value
    : undefined;
}

function calendarDates(start: DateTime.Utc, end: DateTime.Utc): ReadonlyArray<string> | undefined {
  const span = Math.floor(
    (DateTime.toEpochMillis(end) - DateTime.toEpochMillis(start)) / calendarDayMillis,
  );
  return span < 0
    ? undefined
    : globalThis.Array.from({ length: span + 1 }, (_, index) =>
        DateTime.formatIsoDate(DateTime.add(start, { days: index })),
      );
}

function scheduleWindowDates(start: string, end: string): ReadonlyArray<string> | undefined {
  const from = calendarDate(start);
  const to = calendarDate(end);
  return from === undefined || to === undefined ? undefined : calendarDates(from, to);
}

function restOfWeekEnd(date: DateTime.Utc): DateTime.Utc {
  const daysUntilSunday = (7 - DateTime.toPartsUtc(date).weekDay) % 7;
  return DateTime.add(date, { days: daysUntilSunday });
}

function schedulePeriodDetail(input: {
  readonly coverage: ProviderLeagueSettings["rosterCoverage"];
  readonly period: QueryPeriod | undefined;
  readonly window: SummaryScheduleWindow | undefined;
  readonly dates: ReadonlyArray<string>;
  readonly maximumDates: number;
}): string {
  if (input.coverage === "week") {
    return `Scoring week ${String(input.period?.week)} opponents only. Your league publishes no start time, no per-week game count, and no season-long schedule.`;
  }
  const bound = ` One read of this league's roster schedule covers at most ${String(input.maximumDates)} dates; ask for a narrower window or use \`days\`.`;
  const range = input.window === undefined ? "" : ` (${input.window.start} to ${input.window.end})`;
  const count = String(input.dates.length);
  switch (input.window?.source) {
    case "requested":
      return `Opponents on each of the ${count} dates of the requested window${range}. Your league publishes no start time or season-long schedule.${bound}`;
    case "rest_of_week":
      return `Opponents on each of the ${count} dates of the rest of your league's current week${range}. Your league publishes no start time or season-long schedule; pass \`window\` or \`days\` for other dates.${bound}`;
    case "period":
    case undefined:
      return `Opponents on each of the ${count} dates of scoring period ${String(input.period?.week)}${range}. Your league publishes no start time or season-long schedule.${bound}`;
  }
}

function largestSectionBytes(entries: ReadonlyArray<readonly [string, unknown]>): string {
  const measured = entries
    .flatMap(([name, value]) => {
      if (value === undefined) {
        return [];
      }
      const serialized = JSON.stringify(value);
      return [{ name, bytes: serialized.length }];
    })
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, 3);
  if (measured.length === 0) {
    return "No single section could be measured.";
  }
  const listed = measured
    .map(({ name, bytes }) => `\`${name}\` (about ${String(bytes)} bytes)`)
    .join(", ");
  return `The largest sections are ${listed} of this result, so dropping one of those frees the most space.`;
}

type GamesRemainingSource = "professional_games" | "provider_opponent";

type ProfessionalScheduleGames =
  | {
      readonly status: "available";
      readonly games: ReadonlyArray<ProfessionalGame>;
      readonly observedAt: DateTime.Utc;
      readonly teamCount: number;
      readonly unresolvedTeamCount: number;
    }
  | { readonly status: "unavailable"; readonly detail: string };

function poolGameDays(
  games: Extract<PoolGames, { readonly status: "available"; readonly basis: "date" }>,
  proTeamKey: string | undefined,
): PlayerGameDays {
  if (proTeamKey === undefined) {
    return {
      status: "unavailable",
      detail:
        "This row's professional team could not be resolved to a key, so its game days cannot be joined without guessing from an abbreviation.",
    };
  }
  const dates = gameDatesForTeam(games.games, proTeamKey);
  if (dates.length === 0 && games.unresolvedTeamCount > 0) {
    return {
      status: "unavailable",
      detail:
        "The league's professional games include a team with no key, so this player's team cannot be placed on a date without guessing.",
    };
  }
  return { status: "available", dates };
}

function poolGameWeeks(
  games: Extract<PoolGames, { readonly status: "available"; readonly basis: "week" }>,
  providerPlayerKey: string,
): PlayerGameWeeks {
  const byWeek = games.opponents.get(providerPlayerKey);
  return {
    status: "available",
    weeks:
      byWeek === undefined
        ? []
        : [...byWeek.entries()]
            .toSorted(([left], [right]) => left - right)
            .map(([week, opponent]) => ({
              week,
              opponent: opponent.opponent,
              home: opponent.home,
            })),
  };
}

function gamesWindowKey(window: GamesWindowInput | undefined): string {
  if (window === undefined) {
    return "";
  }
  if ("kind" in window) {
    return window.kind === "current" ? "current" : `next_weeks=${String(window.weeks)}`;
  }
  return `${window.start}..${window.end}`;
}

function readProfessionalScheduleGames(input: {
  readonly calendar: ProfessionalCalendar["Service"];
  readonly league: TeamContext["owned"]["team"]["league"];
  readonly from: string;
  readonly to: string;
}): Effect.Effect<ProfessionalScheduleGames, never> {
  return input.calendar
    .readGames({
      league: input.league,
      from: input.from,
      to: input.to,
      freshness: "calendar",
    })
    .pipe(
      Effect.map((window) => ({
        status: "available" as const,
        games: window.games.map((fact) => fact.game),
        observedAt: window.observedAt,
        teamCount: window.teamCount,
        unresolvedTeamCount: window.unresolvedTeams.length,
      })),
      Effect.catch((failure) =>
        Effect.succeed({
          status: "unavailable" as const,
          detail: professionalGamesUnavailableDetail(failure),
        }),
      ),
    );
}

function professionalGamesUnavailableDetail(failure: {
  readonly _tag: string;
  readonly reason?: string;
}): string {
  if (failure._tag === "professional_calendar.unavailable") {
    switch (failure.reason) {
      case "no_source":
        return "This league counts games by scoring week and publishes no professional-game calendar.";
      case "invalid_window":
      case "invalid_week":
        return "The schedule window is not a valid date range.";
      case undefined:
        return "The professional-game source did not accept this schedule window.";
    }
  }
  if (failure._tag === "professional_calendar.fact_stale") {
    return "The professional-game source could not be refreshed, and its previous observation is past its maximum age.";
  }
  return "The professional-game source could not be reached.";
}

type ProfessionalScheduleSection = {
  readonly section: NonNullable<TeamSummaryData["schedule"]>;
  readonly players: ReadonlyMap<string, SummarySchedulePlayer>;
};

type SummaryScheduledGameView = {
  readonly date: string;
  readonly opponent: string;
  readonly home: boolean;
  readonly offNight?: boolean;
};

function professionalScheduleSection(input: {
  readonly calendar: ProfessionalCalendar["Service"];
  readonly league: TeamContext["owned"]["team"]["league"];
  readonly sport: FantasySport;
  readonly rosterPlayers: ReadonlyArray<ProviderRosterPlayer>;
  readonly rosterRefs: ReadonlyArray<PlayerRef>;
  readonly rosterRowByKey: ReadonlyMap<string, SummaryRosterPlayer>;
  readonly window: SummaryScheduleWindow | undefined;
  readonly period: QueryPeriod | undefined;
  readonly store: ScheduleObservationRepository["Service"];
}): Effect.Effect<ProfessionalScheduleSection, QueryPersistenceFailed> {
  return Effect.gen(function* () {
    if (input.window === undefined) {
      return unsupportedProfessionalSchedule(
        "Your league publishes no date window for this schedule, so the league's games cannot be placed on its dates.",
      );
    }
    if (input.rosterPlayers.length === 0) {
      return unsupportedProfessionalSchedule(
        "Your league did not return a roster, so no player's professional games can be placed on its dates.",
      );
    }
    const games = yield* readProfessionalScheduleGames({
      calendar: input.calendar,
      league: input.league,
      from: input.window.start,
      to: input.window.end,
    });
    if (games.status === "unavailable") {
      return unsupportedProfessionalSchedule(games.detail);
    }
    const dates = scheduleWindowDates(input.window.start, input.window.end);
    if (dates === undefined) {
      return unsupportedProfessionalSchedule("The schedule window is not a valid date range.");
    }
    const abbreviations = input.rosterPlayers.flatMap((player) =>
      player.proTeamKey === undefined && player.proTeamAbbreviation !== undefined
        ? [player.proTeamAbbreviation]
        : [],
    );
    const identities =
      abbreviations.length === 0
        ? []
        : yield* input.store.readProviderTeamIdentities({
            sport: input.sport,
            identifiers: abbreviations,
          });
    const keyByAbbreviation = uniqueProviderTeamKeys(identities);
    const leagueByDate = leagueGamesByDate(games.games);
    const offNightByDate = new Map(
      dates.map((date): readonly [string, boolean] => [
        date,
        isLeagueOffNight({
          teamsPlaying: leagueByDate.get(date)?.teamsPlaying ?? 0,
          teamCount: games.teamCount,
        }),
      ]),
    );
    const players = new Map<string, SummarySchedulePlayer>();
    const rosterGamesByDate = new Map<string, number>();
    let unknownTeamRows = 0;
    for (const [player, sealedRef] of EffectArray.zip(input.rosterPlayers, input.rosterRefs)) {
      const rosterRow = input.rosterRowByKey.get(player.providerPlayerKey);
      const proTeamKey =
        player.proTeamKey ??
        (player.proTeamAbbreviation === undefined
          ? undefined
          : keyByAbbreviation.get(player.proTeamAbbreviation));
      const row = professionalScheduleRow({
        games: games.games,
        proTeamKey,
        offNightByDate,
      });
      if (row.status === "unknown") {
        unknownTeamRows += 1;
      }
      for (const game of row.games) {
        rosterGamesByDate.set(game.date, (rosterGamesByDate.get(game.date) ?? 0) + 1);
      }
      players.set(player.providerPlayerKey, {
        player: rosterRow?.player ?? sealedRef,
        name: rosterRow?.name ?? player.name,
        proTeam: rosterRow?.proTeam ?? player.proTeamAbbreviation ?? null,
        status: row.status,
        gameCount: row.games.length,
        games: row.games,
        gamesRemaining: row.gamesRemaining,
      });
    }
    return {
      section: {
        status: "available",
        coverage: "date",
        ...(input.period === undefined ? {} : { period: input.period }),
        window: input.window,
        observedAt: games.observedAt,
        dates: dates.map((date) => {
          const leagueDay = leagueByDate.get(date);
          return {
            date,
            rosterGames: rosterGamesByDate.get(date) ?? 0,
            leagueGames: leagueDay?.games ?? 0,
            teamsPlaying: leagueDay?.teamsPlaying ?? 0,
            offNight: offNightByDate.get(date) ?? false,
          };
        }),
        offNights: {
          status: "available",
          definition: leagueOffNightDefinition,
          sport: "hockey",
        },
        gamesRemaining: {
          status: "available",
          sources: ["professional_games"],
          window: input.window,
          observedAt: games.observedAt,
          ...(unknownTeamRows === 0
            ? {}
            : {
                detail:
                  "Some players' professional teams could not be identified, so those rows publish no games remaining.",
              }),
        },
        players: [],
        detail: professionalScheduleDetail({
          window: input.window,
          period: input.period,
          dates: dates.length,
          unknownTeamRows,
        }),
      },
      players,
    };
  });
}

function unsupportedProfessionalSchedule(detail: string): ProfessionalScheduleSection {
  return { section: { status: "unsupported", detail }, players: new Map() };
}

function professionalScheduleRow(input: {
  readonly games: ReadonlyArray<ProfessionalGame>;
  readonly proTeamKey: string | undefined;
  readonly offNightByDate: ReadonlyMap<string, boolean>;
}): {
  readonly status: SummarySchedulePlayer["status"];
  readonly games: ReadonlyArray<SummaryScheduledGameView>;
  readonly gamesRemaining: SummarySchedulePlayer["gamesRemaining"];
} {
  const proTeamKey = input.proTeamKey;
  if (proTeamKey === undefined) {
    return {
      status: "unknown",
      games: [],
      gamesRemaining: {
        status: "unavailable",
        detail:
          "This player's professional team could not be identified, so the league's games cannot be joined to this row.",
      },
    };
  }
  const teamGames = gamesForTeam(input.games, proTeamKey);
  return {
    status: teamGames.length === 0 ? "no_games" : "scheduled",
    games: teamGames.map((game) => {
      const home = game.home.providerTeamKey === proTeamKey;
      const opponent = home ? game.away : game.home;
      const offNight = input.offNightByDate.get(game.date);
      return {
        date: game.date,
        opponent: opponent.sourceTeamAbbreviation,
        home,
        ...(offNight === undefined ? {} : { offNight }),
      };
    }),
    gamesRemaining: {
      status: "available",
      count: teamGames.length,
      source: "professional_games",
    },
  };
}

function professionalScheduleDetail(input: {
  readonly window: SummaryScheduleWindow;
  readonly period: QueryPeriod | undefined;
  readonly dates: number;
  readonly unknownTeamRows: number;
}): string {
  const range = ` (${input.window.start} to ${input.window.end})`;
  const count = String(input.dates);
  const base = ((): string => {
    switch (input.window.source) {
      case "requested":
        return `Opponents on each of the ${count} dates of the requested window${range}, from your league's professional games.`;
      case "rest_of_week":
        return `Opponents on each of the ${count} dates of the rest of your league's current week${range}, from your league's professional games; pass \`window\` or \`days\` for other dates.`;
      case "period":
        return `Opponents on each of the ${count} dates of scoring period ${String(input.period?.week)}${range}, from your league's professional games.`;
    }
  })();
  return input.unknownTeamRows === 0
    ? base
    : `${base} ${unidentifiedTeamRowsDetail(input.unknownTeamRows)}`;
}

function unidentifiedTeamRowsDetail(count: number): string {
  return count === 1
    ? "1 roster row has no professional team that could be identified, so its games are unknown."
    : `${String(count)} roster rows have no professional team that could be identified, so their games are unknown.`;
}

function providerGamesInWindow(
  games: ReadonlyArray<ProviderScheduledGame>,
  window: SummaryScheduleWindow | undefined,
): ReadonlyArray<ProviderScheduledGame> {
  return window === undefined
    ? games
    : games.filter(
        (game) => game.date === undefined || (game.date >= window.start && game.date <= window.end),
      );
}

function offNightsUnavailableDetail(input: {
  readonly professionalGames: ProfessionalScheduleGames;
  readonly scheduleWindow: SummaryScheduleWindow | undefined;
  readonly coverage: "date" | "week";
}): string {
  if (input.coverage === "week") {
    return "A scoring-week league publishes one opponent for the week and no per-date schedule, so an off night cannot be placed on a date.";
  }
  if (input.professionalGames.status === "unavailable") {
    return `Off nights need the league's professional games, which are unavailable: ${input.professionalGames.detail}`;
  }
  return "The league's professional games were not observed for this window, so no date can be marked as an off night.";
}

function gamesRemainingState(input: {
  readonly sources: ReadonlySet<GamesRemainingSource>;
  readonly professionalGames: ProfessionalScheduleGames;
  readonly window: SummaryScheduleWindow | undefined;
  readonly providerObservedAt: DateTime.Utc;
  readonly providerFallbackForMissingGame: number;
}):
  | {
      readonly status: "available";
      readonly sources: ReadonlyArray<GamesRemainingSource>;
      readonly observedAt: DateTime.Utc;
      readonly detail?: string;
    }
  | { readonly status: "unsupported"; readonly detail: string } {
  if (input.sources.size === 0) {
    return {
      status: "unsupported",
      detail: "Your league returned no players whose games could be counted.",
    };
  }
  const detail =
    input.professionalGames.status === "unavailable"
      ? `The professional games are unavailable, so the counts come from your league's own opponent fact: ${input.professionalGames.detail}`
      : input.providerFallbackForMissingGame > 0
        ? "Some players' counts come from your league's own opponent fact because the professional games did not contain the game your league published."
        : input.sources.has("provider_opponent")
          ? "Some players' professional team keys were not resolved, so those counts come from your league's own opponent fact instead."
          : undefined;
  const observedAt =
    input.professionalGames.status === "available" && input.sources.has("professional_games")
      ? oldestInstant([
          input.professionalGames.observedAt,
          ...(input.sources.has("provider_opponent") ? [input.providerObservedAt] : []),
        ])
      : input.providerObservedAt;
  return {
    status: "available",
    sources: [...input.sources],
    ...(input.window === undefined ? {} : { window: input.window }),
    observedAt,
    ...(detail === undefined ? {} : { detail }),
  };
}

function oldestInstant(instants: ReadonlyArray<DateTime.Utc>): DateTime.Utc {
  const oldest = instants.reduce<DateTime.Utc | undefined>(
    (current, instant) =>
      current === undefined || DateTime.toEpochMillis(instant) < DateTime.toEpochMillis(current)
        ? instant
        : current,
    undefined,
  );
  if (oldest === undefined) {
    throw new Error("A games-remaining answer must observe at least one source");
  }
  return oldest;
}

function scheduledGames(
  games: ReadonlyArray<ProviderScheduledGame>,
  offNightByDate: ReadonlyMap<string, boolean>,
): ReadonlyArray<{
  readonly date?: string;
  readonly opponent: string;
  readonly home: boolean;
  readonly offNight?: boolean;
}> {
  return games.map((game) => {
    const offNight = game.date === undefined ? undefined : offNightByDate.get(game.date);
    return {
      ...(game.date === undefined ? {} : { date: game.date }),
      opponent: game.opponent,
      home: game.home,
      ...(offNight === undefined ? {} : { offNight }),
    };
  });
}

function scheduleDateCounts(
  schedule: ProviderRosterSchedule,
): ReadonlyArray<{ readonly date: string; readonly rosterGames: number }> {
  const counts = new Map<string, number>(schedule.dates.map((date) => [date, 0]));
  for (const player of schedule.players) {
    for (const game of player.games) {
      if (game.date === undefined) {
        continue;
      }
      counts.set(game.date, (counts.get(game.date) ?? 0) + 1);
    }
  }
  return schedule.dates.map((date) => ({ date, rosterGames: counts.get(date) ?? 0 }));
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
        "Remaining games are a fantasy-team total your league publishes for the scoring week, not a per-player count.",
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
          : "Your league did not return matchup data for the scoring week.",
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

function normalizeStatPeriod(period: StatWindow | undefined): ProviderStatPeriod {
  switch (period?.kind) {
    case undefined:
    case "week":
      return period === undefined ? { kind: "season" } : { kind: "week", week: period.week };
    case "season":
    case "last_days":
    case "last_weeks":
    case "range":
      return period;
  }
}

function periodSupportOf(context: TeamContext, sport: FantasySport): PlayersData["periodSupport"] {
  const support = context.provider.capabilities.statPeriods[sport];
  return {
    sport,
    kinds: support.kinds,
    maximumWindowDays: support.maximumWindowDays,
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
  return `Your league cannot serve the requested \`period\` for kind \`${period.kind}\`.`;
}

function leagueOverview(league: ProviderLeagueSettings): NonNullable<LeagueData["overview"]> {
  return { ...leagueFacts(league), transactionRules: leagueTransactionRules(league) };
}

function leagueFacts(
  league: ProviderLeagueSettings,
): Omit<NonNullable<LeagueData["overview"]>, "transactionRules"> {
  return {
    name: league.name,
    teamCount: league.teamCount,
    scoringType: league.scoringType,
    ...(league.scoringLabel === undefined ? {} : { scoringLabel: league.scoringLabel }),
    ...(league.startDate === undefined ? {} : { startDate: league.startDate }),
    ...(league.endDate === undefined ? {} : { endDate: league.endDate }),
  };
}

function leagueTransactionRules(
  league: ProviderLeagueSettings,
): NonNullable<LeagueData["overview"]>["transactionRules"] {
  return {
    waiver: {
      type: declared(league.waiverType),
      rule: declared(league.waiverRule),
      usesFaab: declared(league.usesFaab),
    },
    timing: {
      weeklyDeadline: declared(league.weeklyDeadline),
      rosterChange:
        league.rosterChange === undefined
          ? {
              status: "not_published",
              detail:
                "The league's published settings do not establish whether a roster move takes effect the same day, the next day, or at the league's weekly lock, so no rule is stated.",
            }
          : {
              status: "published",
              value: league.rosterChange.rule,
              source: [...league.rosterChange.source],
              detail: league.rosterChange.detail,
            },
      waiverDays: declared(league.waiverDays),
    },
    acquisitionLimits: {
      weekly: declared(league.maxWeeklyAcquisitions),
      season: declared(league.maxSeasonAcquisitions),
    },
    trades: {
      endDate: declared(league.tradeEndDate),
      ratification: declared(league.tradeRatification),
      objectionDays: declared(league.tradeObjectionDays),
      draftPicks: declared(league.tradeDraftPicks),
    },
    gamesCaps: {
      gamesPlayed: declared(league.maxGamesPlayed),
      inningsPitched: declared(league.maxInningsPitched),
    },
    detailNote:
      "Every rule is either published with the league's declared value or `not_set`. `not_set` means the league declares no such rule, never zero and never a per-team count; a cap that does not apply to the league's sport, such as innings in football, is also `not_set`. `timing.weeklyDeadline` keeps your league's raw value, including an empty string, and `timing.rosterChange` decodes it into a league rule with its source fields and raw values. Each team's acquisition usage is published with its standings row beside these limits.",
  };
}

function declared<T>(
  value: T | undefined,
): { readonly status: "published"; readonly value: T } | { readonly status: "not_set" } {
  return value === undefined ? { status: "not_set" } : { status: "published", value };
}

type AcquisitionLimitValues = {
  readonly weekly: number | undefined;
  readonly season: number | undefined;
};

function acquisitionLimitValues(
  league: ProviderLeagueSettings | undefined,
): AcquisitionLimitValues | undefined {
  return league === undefined
    ? undefined
    : { weekly: league.maxWeeklyAcquisitions, season: league.maxSeasonAcquisitions };
}

function acquisitionLimitsOf(league: ProviderLeagueSettings): AcquisitionLimits {
  return {
    weekly: declared(league.maxWeeklyAcquisitions),
    season: declared(league.maxSeasonAcquisitions),
  };
}

function acquisitionUsageOf(
  usage: ProviderAcquisitionUsage,
  limits: AcquisitionLimitValues | undefined,
): AcquisitionUsage {
  const { seasonMoves, weeklyAdds } = usage;
  if (seasonMoves === undefined || weeklyAdds === undefined) {
    return { status: "not_published", detail: missingAcquisitionUsage(seasonMoves, weeklyAdds) };
  }
  return {
    status: "published",
    seasonMovesUsed: seasonMoves,
    weeklyAddsUsed: weeklyAdds.used,
    coverage:
      weeklyAdds.coverage.type === "week"
        ? { week: weeklyAdds.coverage.week }
        : { date: weeklyAdds.coverage.date },
    ...(limits?.season === undefined
      ? {}
      : { seasonMovesRemaining: Math.max(0, limits.season - seasonMoves) }),
    ...(limits?.weekly === undefined
      ? {}
      : { weeklyAddsRemaining: Math.max(0, limits.weekly - weeklyAdds.used) }),
  };
}

function missingAcquisitionUsage(
  seasonMoves: number | undefined,
  weeklyAdds: ProviderAcquisitionUsage["weeklyAdds"],
): string {
  if (seasonMoves === undefined && weeklyAdds === undefined) {
    return "Your league published neither a season move count nor a weekly adds count for this team.";
  }
  return seasonMoves === undefined
    ? "Your league published no season move count for this team."
    : "Your league published no weekly adds count for this team.";
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
    for (const category of configuredCategories(league)) {
      result.push({
        stat: yield* tokens.statRef({
          leagueKey: context.owned.team.providerLeagueKey,
          statId: category.statId,
        }),
        name: category.name,
        abbreviation: category.abbreviation,
        group: category.group,
        scoring: category.scoring,
        ...(category.detail === undefined ? {} : { detail: category.detail }),
        positionTypes: category.positionTypes,
        points: modifiers.get(category.statId) ?? null,
      });
    }
    return result;
  });
}

type ConfiguredCategory = {
  readonly statId: number;
  readonly name: string;
  readonly abbreviation: string;
  readonly group: string;
  readonly scoring: CategoryRole;
  readonly detail: string | undefined;
  readonly positionTypes: ReadonlyArray<string>;
};

function configuredCategories(league: ProviderLeagueSettings): ReadonlyArray<ConfiguredCategory> {
  return league.statCategories.map((category): ConfiguredCategory => {
    const informational = category.displayOnly
      ? "Your league marks this stat display-only for this league, so it appears for information and does not score."
      : category.enabled
        ? undefined
        : "Your league marks this stat not enabled for this league, so it appears for information and does not score.";
    return {
      statId: category.statId,
      name: category.name,
      abbreviation: category.abbreviation,
      group: category.group,
      scoring: informational === undefined ? "scoring" : "informational",
      detail: informational,
      positionTypes: category.positionTypes,
    };
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

type DraftProvenanceRead = {
  readonly lookup: (providerPlayerKey: string) => PlayerDraft;
  readonly coverage?: QueryCoverage;
  readonly failures?: ReadonlyArray<QueryFailure>;
};

const notPublishedDraft: PlayerDraft = { status: "not_published" };

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

function injuryOfDetail(detail: ProviderPlayerDetail): {
  reported: boolean;
  detail?: string;
} {
  return {
    reported: detail.availabilityDetail !== undefined,
    ...(detail.availabilityDetail === undefined ? {} : { detail: detail.availabilityDetail }),
  };
}

function rosterPlayer(
  context: TeamContext,
  tokens: QueryTokens["Service"],
  player: ProviderRosterPlayer,
  detail: RosterDetail,
  week: PlayerWeek | undefined,
  startingStatus: StartingStatus,
): Effect.Effect<RosterPlayerView> {
  return tokens
    .sealPlayerRef({
      userId: context.userId,
      leagueKey: context.owned.team.providerLeagueKey,
      playerKey: player.providerPlayerKey,
    })
    .pipe(Effect.map((ref) => rosterRow(player, ref, detail, week, startingStatus)));
}

function rosterRow(
  player: ProviderRosterPlayer,
  ref: PlayerRef,
  detail: RosterDetail,
  week: PlayerWeek | undefined,
  startingStatus: StartingStatus,
): RosterPlayerView {
  return {
    player: ref,
    name: player.name,
    slot: player.slot,
    primaryPosition: player.primaryPosition,
    displayPosition: player.displayPosition,
    proTeam: player.proTeamAbbreviation ?? null,
    eligiblePositions: player.eligiblePositions,
    editable: player.isEditable,
    injury: injuryOf(player),
    startingStatus,
    ...(week === undefined ? {} : { week }),
    transactionTrend: player.transactionTrend,
    ...(detail === "full" ? { undroppable: player.undroppable } : {}),
  };
}

function startingStatusOf(status: ProviderStartingLineup): StartingStatus {
  switch (status) {
    case "confirmed-starting":
      return "confirmed_starting";
    case "confirmed-not-starting":
      return "confirmed_not_starting";
    case "unconfirmed":
      return "unconfirmed";
  }
}

function poolWeek(
  fact: ProviderPlayerWeekFact,
  projectedRank: number | null | undefined,
): PlayerWeek {
  return playerWeek({
    week: fact.week,
    plays: fact.plays,
    opponent: fact.opponent?.opponent,
    home: fact.opponent?.home,
    byeWeek: undefined,
    projectedRank,
  });
}

function rosterWeek(
  player: ProviderRosterPlayer,
  coverage: ProviderRosterCoverage,
  projectedRank: number | null | undefined,
): PlayerWeek | undefined {
  if (coverage.type !== "week") {
    return undefined;
  }
  return playerWeek({
    week: coverage.week,
    plays: player.scheduled,
    opponent: player.opponent?.opponent,
    home: player.opponent?.home,
    byeWeek: player.byeWeek ?? undefined,
    projectedRank,
  });
}

function playerWeek(source: {
  readonly week: number;
  readonly plays: boolean;
  readonly opponent: string | undefined;
  readonly home: boolean | undefined;
  readonly byeWeek: number | undefined;
  readonly projectedRank: number | null | undefined;
}): PlayerWeek {
  return {
    period: { week: source.week },
    playsThisWeek: source.plays,
    opponent: source.opponent ?? null,
    home: source.home ?? null,
    ...(source.byeWeek === undefined ? {} : { byeWeek: source.byeWeek }),
    ...(source.projectedRank === undefined ? {} : { projectedRank: source.projectedRank }),
  };
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
  | { readonly _tag: "informational"; readonly name: string }
  | { readonly _tag: "unknown" }
  | { readonly _tag: "unavailable"; readonly detail: string };

function providerOrdered(
  provider: TeamContext["provider"],
  sort: NonNullable<SearchPlayersInput["sort"]>,
): boolean {
  return provider.capabilities.playerSearch.providerOrderedSorts.includes(sort);
}

function providerPositionCodes(positions: ReadonlySet<string>): ReadonlyArray<string> | undefined {
  const codes = [...positions];
  return codes.length > 0 && codes.every((code) => /^[A-Za-z]{1,3}$/u.test(code))
    ? codes
    : undefined;
}

function limitation(provider: TeamContext["provider"], subject: ProviderLimitationSubject): string {
  return (
    provider.capabilities.limitations.find((entry) => entry.subject === subject)?.detail ??
    "Your league does not publish data for this field."
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
    case "recent_rank":
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
    return `Your league did not report the requested ${wanted} for this read.`;
  }
  const actual =
    covered.type === "week" ? `week ${String(covered.week)}` : `the roster for ${covered.date}`;
  return `Your league returned ${actual} instead of the requested ${wanted}.`;
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
