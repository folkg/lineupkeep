import { Context, DateTime, Deferred, Effect, Layer, Option, Redacted, Ref, Schema } from "effect";

import type { FantasySport } from "#contexts/connections/FantasyTeam.ts";
import {
  ProviderOperationUnsupported,
  ProviderPeriodMismatch,
  ProviderPeriodUnsupported,
  ProviderRequestFailed,
  ProviderResponseInvalid,
  ProviderSessionMaterial,
  ProviderSessionRejected,
} from "#contexts/connections/Provider.ts";
import type {
  ProviderAvailabilityTier,
  ProviderCapabilities,
  ProviderDraftPick,
  ProviderGamesPlayed,
  ProviderLeagueSettings,
  ProviderLeagueRoster,
  ProviderLeagueTeam,
  ProviderLineupAssignment,
  ProviderScoreOutcome,
  ProviderScoreRefusal,
  ProviderScoreRequest,
  ProviderMatchup,
  ProviderNativeTarget,
  ProviderOperation,
  ProviderPlayerDetail,
  ProviderPlayerScore,
  ProviderPendingTrade,
  ProviderPlayerSearchResult,
  ProviderPlayerWeekFact,
  ProviderRoster,
  ProviderRosterCoverage,
  ProviderRosterSchedule,
  ProviderSchedulePeriod,
  ProviderShape,
  ProviderStandings,
  ProviderStatBasis,
  ProviderStatPeriod,
  ProviderTeam,
  ProviderTradeProposalResult,
  ProviderTransaction,
  ProviderTransactionPlayer,
  ProviderWriteResult,
} from "#contexts/connections/Provider.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";
import { ProviderRegistry, providerRegistryOf } from "#contexts/connections/ProviderRegistry.ts";

type FakeWriteAction = "accept" | "reject" | "lost_response" | "unavailable" | "invalid";

type FakePlayerScore = {
  readonly providerPlayerKey: string;
  readonly score: number | null;
  readonly availability: ProviderAvailabilityTier;
};

type FakePlanRefusal = {
  readonly refusal: ProviderScoreRefusal;
  readonly provenance: string;
  readonly detail: string;
};

type FakeGate = {
  readonly started: Deferred.Deferred<void>;
  readonly release: Deferred.Deferred<void>;
};

type FakeWrite = "reserve_move" | "transaction" | "propose_trade" | "withdraw_trade";

type FakeSessionRejection = {
  readonly status?: number;
  readonly detail?: string;
};

type FakeProviderState = {
  readonly sessionRejected: boolean;
  readonly sessionRejection: FakeSessionRejection;
  readonly rejectedSessions: ReadonlySet<string>;
  readonly teams: ReadonlyArray<ProviderTeam>;
  readonly requestFailure: FakeRequestFailure | undefined;
  readonly discoveryGate: Option.Option<FakeGate>;
  readonly rosterReadGate: Option.Option<FakeGate>;
  readonly league: ProviderLeagueSettings | undefined;
  readonly leagueFailure: ProviderResponseInvalid | undefined;
  readonly standings: ProviderStandings | undefined;
  readonly standingsFailure: ProviderResponseInvalid | undefined;
  readonly roster: ProviderRoster | undefined;
  readonly teamRosters: Readonly<Record<string, ProviderRoster>>;
  readonly rosterAfterNextRead: ProviderRoster | undefined;
  readonly rosterPeriods: ReadonlyArray<ProviderRosterCoverage | undefined>;
  readonly schedule: ProviderRosterSchedule | undefined;
  readonly teamSchedules: Readonly<Record<string, ProviderRosterSchedule>>;
  readonly scheduleFailure: FakeRequestFailure | undefined;
  readonly schedulePeriods: ReadonlyArray<ProviderSchedulePeriod>;
  readonly playerDetails: ReadonlyArray<ProviderPlayerDetail>;
  readonly playerWeeks: ReadonlyArray<ProviderPlayerWeekFact>;
  readonly searchPlayers: ReadonlyArray<ProviderPlayerSearchResult["players"][number]> | undefined;
  readonly playerScores: ReadonlyArray<FakePlayerScore>;
  readonly gamesPlayed: ReadonlyArray<ProviderGamesPlayed>;
  readonly playerDetailsFailure: ProviderPeriodMismatch | undefined;
  readonly matchups: ReadonlyArray<ProviderMatchup>;
  readonly transactions: ReadonlyArray<ProviderTransaction>;
  readonly pendingTrades: ReadonlyArray<ProviderPendingTrade>;
  readonly draftResults: ReadonlyArray<ProviderDraftPick>;
  readonly leagueTeams: ReadonlyArray<ProviderLeagueTeam>;
  readonly leagueRosters: ReadonlyArray<ProviderLeagueRoster> | undefined;
  readonly unsupported: ReadonlySet<ProviderOperation>;
  readonly nativeAction: FakeWriteAction;
  readonly nativeAfter: ProviderRoster | undefined;
  readonly nativeTargets: ReadonlyArray<ProviderNativeTarget>;
  readonly nativeCalls: number;
  readonly explicitAction: FakeWriteAction;
  readonly explicitDetail: string | undefined;
  readonly explicitAfter: ProviderRoster | undefined;
  readonly explicitRequests: ReadonlyArray<ReadonlyArray<ProviderLineupAssignment>>;
  readonly explicitCalls: number;
  readonly transactionAction: FakeWriteAction;
  readonly transactionDetail: string | undefined;
  readonly transactionStatus: number | undefined;
  readonly teamTransactionActions: Readonly<Record<string, FakeWriteAction>>;
  readonly transactionRequests: ReadonlyArray<FakeTransactionRequest>;
  readonly tradeProposalAction: FakeWriteAction;
  readonly tradeProposalKey: string | undefined;
  readonly tradeProposalRequests: ReadonlyArray<FakeTradeProposalRequest>;
  readonly withdrawTradeAction: FakeWriteAction;
  readonly withdrawTradeDetail: string | undefined;
  readonly withdrawTradeRequests: ReadonlyArray<string>;
  readonly completedTrades: ReadonlyArray<ProviderTransaction>;
  readonly reserveAction: FakeWriteAction;
  readonly reserveDetail: string | undefined;
  readonly reserveRequests: ReadonlyArray<FakeReserveMoveRequest>;
  readonly writeSequence: ReadonlyArray<FakeWrite>;
  readonly planRefusal: FakePlanRefusal | undefined;
  readonly providerCalls: number;
  readonly providerReads: number;
  readonly readCounts: Readonly<Record<string, number>>;
};

export type FakeProviderWorldShape = {
  readonly state: Ref.Ref<FakeProviderState>;
  readonly rejectSession: (rejected: boolean) => Effect.Effect<void>;
  readonly rejectSessionFor: (sessions: ReadonlyArray<string>) => Effect.Effect<void>;
  readonly setSessionRejection: (rejection: FakeSessionRejection) => Effect.Effect<void>;
  readonly setTeams: (teams: ReadonlyArray<ProviderTeam>) => Effect.Effect<void>;
  readonly failRequests: (failure: FakeRequestFailure | undefined) => Effect.Effect<void>;
  readonly blockDiscovery: Effect.Effect<FakeGate>;
  readonly unblockDiscovery: Effect.Effect<void>;
  readonly blockRosterRead: Effect.Effect<FakeGate>;
  readonly unblockRosterRead: Effect.Effect<void>;
  readonly setLeague: (league: ProviderLeagueSettings | undefined) => Effect.Effect<void>;
  readonly failLeague: (failure: ProviderResponseInvalid | undefined) => Effect.Effect<void>;
  readonly setStandings: (standings: ProviderStandings | undefined) => Effect.Effect<void>;
  readonly failStandings: (failure: ProviderResponseInvalid | undefined) => Effect.Effect<void>;
  readonly setRoster: (roster: ProviderRoster | undefined) => Effect.Effect<void>;
  readonly setTeamRoster: (teamKey: string, roster: ProviderRoster) => Effect.Effect<void>;
  readonly setRosterAfterNextRead: (roster: ProviderRoster | undefined) => Effect.Effect<void>;
  readonly rosterPeriods: Effect.Effect<ReadonlyArray<ProviderRosterCoverage | undefined>>;
  readonly setSchedule: (schedule: ProviderRosterSchedule | undefined) => Effect.Effect<void>;
  readonly setTeamSchedule: (
    teamKey: string,
    schedule: ProviderRosterSchedule,
  ) => Effect.Effect<void>;
  readonly failSchedule: (failure: FakeRequestFailure | undefined) => Effect.Effect<void>;
  readonly schedulePeriods: Effect.Effect<ReadonlyArray<ProviderSchedulePeriod>>;
  readonly setPlayerDetails: (details: ReadonlyArray<ProviderPlayerDetail>) => Effect.Effect<void>;
  readonly setPlayerWeeks: (weeks: ReadonlyArray<ProviderPlayerWeekFact>) => Effect.Effect<void>;
  readonly setSearchPlayers: (
    players: ReadonlyArray<ProviderPlayerSearchResult["players"][number]>,
  ) => Effect.Effect<void>;
  readonly setPlayerScores: (scores: ReadonlyArray<FakePlayerScore>) => Effect.Effect<void>;
  readonly setGamesPlayed: (gamesPlayed: ReadonlyArray<ProviderGamesPlayed>) => Effect.Effect<void>;
  readonly failPlayerDetails: (failure: ProviderPeriodMismatch | undefined) => Effect.Effect<void>;
  readonly setMatchups: (matchups: ReadonlyArray<ProviderMatchup>) => Effect.Effect<void>;
  readonly setTransactions: (
    transactions: ReadonlyArray<ProviderTransaction>,
  ) => Effect.Effect<void>;
  readonly setPendingTrades: (trades: ReadonlyArray<ProviderPendingTrade>) => Effect.Effect<void>;
  readonly setDraftResults: (picks: ReadonlyArray<ProviderDraftPick>) => Effect.Effect<void>;
  readonly setLeagueTeams: (teams: ReadonlyArray<ProviderLeagueTeam>) => Effect.Effect<void>;
  readonly setLeagueRosters: (
    rosters: ReadonlyArray<ProviderLeagueRoster> | undefined,
  ) => Effect.Effect<void>;
  readonly unsupportedOperations: (
    operations: ReadonlyArray<ProviderOperation>,
  ) => Effect.Effect<void>;
  readonly setNativeAction: (action: FakeWriteAction) => Effect.Effect<void>;
  readonly setNativeAfter: (roster: ProviderRoster | undefined) => Effect.Effect<void>;
  readonly nativeTargets: Effect.Effect<ReadonlyArray<ProviderNativeTarget>>;
  readonly nativeCallCount: Effect.Effect<number>;
  readonly providerCalls: Effect.Effect<number>;
  readonly providerReads: Effect.Effect<number>;
  readonly readCount: (operation: ProviderOperation) => Effect.Effect<number>;
  readonly setExplicitAction: (action: FakeWriteAction, detail?: string) => Effect.Effect<void>;
  readonly setExplicitAfter: (roster: ProviderRoster | undefined) => Effect.Effect<void>;
  readonly explicitRequests: Effect.Effect<ReadonlyArray<ReadonlyArray<ProviderLineupAssignment>>>;
  readonly explicitCallCount: Effect.Effect<number>;
  readonly setTransactionAction: (
    action: FakeWriteAction,
    detail?: string,
    httpStatus?: number,
  ) => Effect.Effect<void>;
  readonly setTeamTransactionAction: (
    teamKey: string,
    action: FakeWriteAction,
  ) => Effect.Effect<void>;
  readonly transactionRequests: Effect.Effect<ReadonlyArray<FakeTransactionRequest>>;
  readonly setTradeProposalAction: (action: FakeWriteAction, key?: string) => Effect.Effect<void>;
  readonly tradeProposalRequests: Effect.Effect<ReadonlyArray<FakeTradeProposalRequest>>;
  readonly setWithdrawTradeAction: (
    action: FakeWriteAction,
    detail?: string,
  ) => Effect.Effect<void>;
  readonly withdrawTradeRequests: Effect.Effect<ReadonlyArray<string>>;
  readonly setCompletedTrades: (trades: ReadonlyArray<ProviderTransaction>) => Effect.Effect<void>;
  readonly setReserveAction: (action: FakeWriteAction, detail?: string) => Effect.Effect<void>;
  readonly reserveRequests: Effect.Effect<ReadonlyArray<FakeReserveMoveRequest>>;
  readonly writeSequence: Effect.Effect<ReadonlyArray<FakeWrite>>;
  readonly setPlanRefusal: (refusal: FakePlanRefusal | undefined) => Effect.Effect<void>;
};

export function refuseCustomPlanning(fake: FakeProviderWorldShape): Effect.Effect<void> {
  return fake.setPlanRefusal({
    refusal: "structural",
    provenance: "fake/no-score",
    detail: "This league publishes no score the custom planner can use.",
  });
}

export class FakeProviderWorld extends Context.Service<FakeProviderWorld, FakeProviderWorldShape>()(
  "@lineupkeep/backend/contexts/connections/internal/ProviderFakeTest/FakeProviderWorld",
) {
  static readonly layer = Layer.effect(
    FakeProviderWorld,
    Effect.gen(function* () {
      const state = yield* Ref.make<FakeProviderState>({
        sessionRejected: false,
        sessionRejection: {},
        rejectedSessions: new Set<string>(),
        teams: [],
        requestFailure: undefined,
        discoveryGate: Option.none(),
        rosterReadGate: Option.none(),
        league: undefined,
        leagueFailure: undefined,
        standings: undefined,
        standingsFailure: undefined,
        roster: undefined,
        teamRosters: {},
        rosterAfterNextRead: undefined,
        rosterPeriods: [],
        schedule: undefined,
        teamSchedules: {},
        scheduleFailure: undefined,
        schedulePeriods: [],
        playerDetails: [],
        playerWeeks: [],
        searchPlayers: undefined,
        playerScores: [],
        gamesPlayed: [],
        playerDetailsFailure: undefined,
        matchups: [],
        transactions: [],
        pendingTrades: [],
        draftResults: [],
        leagueTeams: [],
        leagueRosters: undefined,
        unsupported: new Set(),
        nativeAction: "accept",
        nativeAfter: undefined,
        nativeTargets: [],
        nativeCalls: 0,
        explicitAction: "accept",
        explicitDetail: undefined,
        explicitAfter: undefined,
        explicitRequests: [],
        explicitCalls: 0,
        transactionAction: "accept",
        transactionDetail: undefined,
        transactionStatus: undefined,
        teamTransactionActions: {},
        transactionRequests: [],
        tradeProposalAction: "accept",
        tradeProposalKey: "nhl.l.1.pt.1",
        tradeProposalRequests: [],
        withdrawTradeAction: "accept",
        withdrawTradeDetail: undefined,
        withdrawTradeRequests: [],
        completedTrades: [],
        reserveAction: "accept",
        reserveDetail: undefined,
        reserveRequests: [],
        writeSequence: [],
        planRefusal: undefined,
        providerCalls: 0,
        providerReads: 0,
        readCounts: {},
      });
      const modify = (
        update: (current: FakeProviderState) => FakeProviderState,
      ): Effect.Effect<void> => Ref.update(state, update);
      return {
        state,
        rejectSession: (rejected) =>
          modify((current) => ({ ...current, sessionRejected: rejected })),
        rejectSessionFor: (sessions) =>
          modify((current) => ({ ...current, rejectedSessions: new Set(sessions) })),
        setSessionRejection: (sessionRejection) =>
          modify((current) => ({ ...current, sessionRejection })),
        setTeams: (teams) => modify((current) => ({ ...current, teams })),
        failRequests: (requestFailure) => modify((current) => ({ ...current, requestFailure })),
        blockDiscovery: Effect.gen(function* () {
          const gate: FakeGate = {
            started: yield* Deferred.make<void>(),
            release: yield* Deferred.make<void>(),
          };
          yield* modify((current) => ({ ...current, discoveryGate: Option.some(gate) }));
          return gate;
        }),
        unblockDiscovery: modify((current) => ({ ...current, discoveryGate: Option.none() })),
        blockRosterRead: Effect.gen(function* () {
          const gate: FakeGate = {
            started: yield* Deferred.make<void>(),
            release: yield* Deferred.make<void>(),
          };
          yield* modify((current) => ({ ...current, rosterReadGate: Option.some(gate) }));
          return gate;
        }),
        unblockRosterRead: modify((current) => ({ ...current, rosterReadGate: Option.none() })),
        setLeague: (league) => modify((current) => ({ ...current, league })),
        failLeague: (leagueFailure) => modify((current) => ({ ...current, leagueFailure })),
        setStandings: (standings) => modify((current) => ({ ...current, standings })),
        failStandings: (standingsFailure) =>
          modify((current) => ({ ...current, standingsFailure })),
        setRoster: (roster) => modify((current) => ({ ...current, roster })),
        setTeamRoster: (teamKey, roster) =>
          modify((current) => ({
            ...current,
            teamRosters: { ...current.teamRosters, [teamKey]: roster },
          })),
        setRosterAfterNextRead: (rosterAfterNextRead) =>
          modify((current) => ({ ...current, rosterAfterNextRead })),
        rosterPeriods: Effect.map(Ref.get(state), (current) => current.rosterPeriods),
        setSchedule: (schedule) => modify((current) => ({ ...current, schedule })),
        setTeamSchedule: (teamKey, schedule) =>
          modify((current) => ({
            ...current,
            teamSchedules: { ...current.teamSchedules, [teamKey]: schedule },
          })),
        failSchedule: (scheduleFailure) => modify((current) => ({ ...current, scheduleFailure })),
        schedulePeriods: Effect.map(Ref.get(state), (current) => current.schedulePeriods),
        setPlayerDetails: (playerDetails) => modify((current) => ({ ...current, playerDetails })),
        setPlayerWeeks: (playerWeeks) => modify((current) => ({ ...current, playerWeeks })),
        setSearchPlayers: (players) =>
          modify((current) => ({ ...current, searchPlayers: players })),
        setPlayerScores: (playerScores) => modify((current) => ({ ...current, playerScores })),
        setGamesPlayed: (gamesPlayed) => modify((current) => ({ ...current, gamesPlayed })),
        failPlayerDetails: (playerDetailsFailure) =>
          modify((current) => ({ ...current, playerDetailsFailure })),
        setMatchups: (matchups) => modify((current) => ({ ...current, matchups })),
        setTransactions: (transactions) => modify((current) => ({ ...current, transactions })),
        setPendingTrades: (pendingTrades) => modify((current) => ({ ...current, pendingTrades })),
        setDraftResults: (draftResults) => modify((current) => ({ ...current, draftResults })),
        setLeagueTeams: (leagueTeams) => modify((current) => ({ ...current, leagueTeams })),
        setLeagueRosters: (leagueRosters) => modify((current) => ({ ...current, leagueRosters })),
        unsupportedOperations: (operations) =>
          modify((current) => ({ ...current, unsupported: new Set(operations) })),
        setNativeAction: (nativeAction) => modify((current) => ({ ...current, nativeAction })),
        setNativeAfter: (nativeAfter) => modify((current) => ({ ...current, nativeAfter })),
        nativeTargets: Effect.map(Ref.get(state), (current) => current.nativeTargets),
        nativeCallCount: Effect.map(Ref.get(state), (current) => current.nativeCalls),
        providerCalls: Effect.map(Ref.get(state), (current) => current.providerCalls),
        providerReads: Effect.map(Ref.get(state), (current) => current.providerReads),
        readCount: (operation) =>
          Effect.map(Ref.get(state), (current) => current.readCounts[operation] ?? 0),
        setExplicitAction: (explicitAction, explicitDetail) =>
          modify((current) => ({ ...current, explicitAction, explicitDetail })),
        setExplicitAfter: (explicitAfter) => modify((current) => ({ ...current, explicitAfter })),
        explicitRequests: Effect.map(Ref.get(state), (current) => current.explicitRequests),
        explicitCallCount: Effect.map(Ref.get(state), (current) => current.explicitCalls),
        setTransactionAction: (transactionAction, transactionDetail, transactionStatus) =>
          modify((current) => ({
            ...current,
            transactionAction,
            transactionDetail,
            transactionStatus,
          })),
        setTeamTransactionAction: (teamKey, action) =>
          modify((current) => ({
            ...current,
            teamTransactionActions: { ...current.teamTransactionActions, [teamKey]: action },
          })),
        transactionRequests: Effect.map(Ref.get(state), (current) => current.transactionRequests),
        setTradeProposalAction: (tradeProposalAction, tradeProposalKey) =>
          modify((current) => ({ ...current, tradeProposalAction, tradeProposalKey })),
        tradeProposalRequests: Effect.map(
          Ref.get(state),
          (current) => current.tradeProposalRequests,
        ),
        setWithdrawTradeAction: (withdrawTradeAction, withdrawTradeDetail) =>
          modify((current) => ({ ...current, withdrawTradeAction, withdrawTradeDetail })),
        withdrawTradeRequests: Effect.map(
          Ref.get(state),
          (current) => current.withdrawTradeRequests,
        ),
        setCompletedTrades: (completedTrades) =>
          modify((current) => ({ ...current, completedTrades })),
        setReserveAction: (reserveAction, reserveDetail) =>
          modify((current) => ({ ...current, reserveAction, reserveDetail })),
        reserveRequests: Effect.map(Ref.get(state), (current) => current.reserveRequests),
        writeSequence: Effect.map(Ref.get(state), (current) => current.writeSequence),
        setPlanRefusal: (planRefusal) => modify((current) => ({ ...current, planRefusal })),
      } satisfies FakeProviderWorldShape;
    }),
  );
}

const providerFake = Effect.gen(function* () {
  const world = yield* FakeProviderWorld;

  const prepare = (
    input: ProviderSessionMaterial,
    operation: ProviderOperation,
  ): Effect.Effect<
    FakeProviderState,
    | ProviderSessionRejected
    | ProviderOperationUnsupported
    | ProviderRequestFailed
    | ProviderResponseInvalid
  > =>
    Effect.gen(function* () {
      yield* validate(input, operation);
      yield* Ref.update(world.state, (current) => ({
        ...current,
        providerCalls: current.providerCalls + 1,
        providerReads: current.providerReads + (readOperations.has(operation) ? 1 : 0),
        readCounts: readOperations.has(operation)
          ? {
              ...current.readCounts,
              [operation]: (current.readCounts[operation] ?? 0) + 1,
            }
          : current.readCounts,
      }));
      const current = yield* Ref.get(world.state);
      if (current.sessionRejected || current.rejectedSessions.has(Redacted.value(input.session))) {
        return yield* ProviderSessionRejected.make({ operation });
      }
      if (current.unsupported.has(operation)) {
        return yield* ProviderOperationUnsupported.make({
          operation,
          reason: `The fake provider does not support ${operation}.`,
        });
      }
      yield* requestFailure(current, operation);
      return current;
    });

  return {
    key: decodeProviderKey("yahoo"),
    capabilities: fakeCapabilities,
    validateSession: Effect.fn("FakeProvider.validateSession")(function* (input) {
      yield* validate(input, "validate_session");
      const current = yield* Ref.get(world.state);
      if (current.sessionRejected || current.rejectedSessions.has(Redacted.value(input.session))) {
        return yield* ProviderSessionRejected.make({
          operation: "validate_session",
          ...current.sessionRejection,
        });
      }
      yield* requestFailure(current, "validate_session");
    }),
    discoverTeams: Effect.fn("FakeProvider.discoverTeams")(function* (input) {
      yield* validate(input, "discover_teams");
      const current = yield* Ref.get(world.state);
      if (current.sessionRejected || current.rejectedSessions.has(Redacted.value(input.session))) {
        return yield* ProviderSessionRejected.make({
          operation: "discover_teams",
          ...current.sessionRejection,
        });
      }
      yield* requestFailure(current, "discover_teams");
      const gate = Option.getOrUndefined(current.discoveryGate);
      if (gate !== undefined) {
        yield* Deferred.succeed(gate.started, undefined);
        yield* Deferred.await(gate.release);
      }
      const latest = yield* Ref.get(world.state);
      return latest.teams;
    }),
    readLeague: Effect.fn("FakeProvider.readLeague")(function* (input) {
      const current = yield* prepare(input, "read_league");
      if (current.leagueFailure !== undefined) {
        return yield* ProviderResponseInvalid.make({
          operation: "read_league",
          ...(current.leagueFailure.field === undefined
            ? {}
            : { field: current.leagueFailure.field }),
        });
      }
      if (current.league === undefined) {
        return yield* ProviderOperationUnsupported.make({
          operation: "read_league",
          reason: "No league settings are configured for the fake provider.",
        });
      }
      if (current.league.providerLeagueKey !== input.providerLeagueKey) {
        return yield* ProviderResponseInvalid.make({ operation: "read_league" });
      }
      return current.league;
    }),
    readStandings: Effect.fn("FakeProvider.readStandings")(function* (input) {
      const current = yield* prepare(input, "read_standings");
      if (current.standingsFailure !== undefined) {
        return yield* ProviderResponseInvalid.make({
          operation: "read_standings",
          ...(current.standingsFailure.field === undefined
            ? {}
            : { field: current.standingsFailure.field }),
        });
      }
      if (current.standings === undefined) {
        return yield* ProviderOperationUnsupported.make({
          operation: "read_standings",
          reason: "No standings are configured for the fake provider.",
        });
      }
      if (current.standings.providerLeagueKey !== input.providerLeagueKey) {
        return yield* ProviderResponseInvalid.make({ operation: "read_standings" });
      }
      return current.standings;
    }),
    readRoster: Effect.fn("FakeProvider.readRoster")(function* (input) {
      const current = yield* prepare(input, "read_roster");
      yield* Ref.update(world.state, (state) => ({
        ...state,
        rosterPeriods: [...state.rosterPeriods, input.period],
      }));
      const configured = current.teamRosters[input.providerTeamKey] ?? current.roster;
      if (configured === undefined) {
        return yield* ProviderOperationUnsupported.make({
          operation: "read_roster",
          reason: "No roster is configured for the fake provider.",
        });
      }
      if (configured.providerTeamKey !== input.providerTeamKey) {
        return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
      }
      const gate = Option.getOrUndefined(current.rosterReadGate);
      if (gate !== undefined) {
        yield* Deferred.succeed(gate.started, undefined);
        yield* Deferred.await(gate.release);
        yield* Ref.update(world.state, (current) => ({
          ...current,
          rosterReadGate: Option.none(),
        }));
      }
      const coverage = configured.coverage;
      if (
        input.period !== undefined &&
        (input.period.type !== coverage.type ||
          (input.period.type === "week" &&
            coverage.type === "week" &&
            input.period.week !== coverage.week) ||
          (input.period.type === "date" &&
            coverage.type === "date" &&
            input.period.date !== coverage.date))
      ) {
        return yield* ProviderPeriodMismatch.make({
          operation: "read_roster",
          requested: input.period,
          covered: coverage,
        });
      }
      if (current.rosterAfterNextRead !== undefined) {
        yield* Ref.update(world.state, (state) => ({
          ...state,
          roster: current.rosterAfterNextRead,
          rosterAfterNextRead: undefined,
        }));
      }
      return configured;
    }),
    readRosterSchedule: Effect.fn("FakeProvider.readRosterSchedule")(function* (input) {
      const current = yield* prepare(input, "read_roster_schedule");
      yield* Ref.update(world.state, (state) => ({
        ...state,
        schedulePeriods: [...state.schedulePeriods, input.period],
      }));
      if (current.scheduleFailure === "unavailable") {
        return yield* ProviderRequestFailed.make({ operation: "read_roster_schedule" });
      }
      if (current.scheduleFailure === "invalid_response") {
        return yield* ProviderResponseInvalid.make({ operation: "read_roster_schedule" });
      }
      const configured = current.teamSchedules[input.providerTeamKey] ?? current.schedule;
      if (configured === undefined) {
        return yield* ProviderOperationUnsupported.make({
          operation: "read_roster_schedule",
          reason: "No roster schedule is configured for the fake provider.",
        });
      }
      if (configured.providerTeamKey !== input.providerTeamKey) {
        return yield* ProviderResponseInvalid.make({ operation: "read_roster_schedule" });
      }
      return scheduleForPeriod(configured, input.period);
    }),
    applyNativeAction: Effect.fn("FakeProvider.applyNativeAction")(function* (input) {
      const current = yield* prepare(input, "apply_native_action").pipe(
        Effect.mapError((error) =>
          error._tag === "provider.session_rejected"
            ? error
            : ProviderResponseInvalid.make({ operation: "apply_native_action" }),
        ),
      );
      const configured = current.teamRosters[input.providerTeamKey] ?? current.roster;
      if (configured === undefined) {
        return yield* ProviderResponseInvalid.make({
          operation: "apply_native_action",
        });
      }
      if (configured.providerTeamKey !== input.providerTeamKey) {
        return { status: "rejected" as const, reason: "not_found" as const };
      }
      yield* Ref.update(world.state, (state) => ({
        ...state,
        nativeCalls: state.nativeCalls + 1,
        nativeTargets: [...state.nativeTargets, input.target],
      }));
      const result: ProviderWriteResult = writeResult(current.nativeAction);
      if (current.nativeAction === "accept" || current.nativeAction === "lost_response") {
        const after = current.nativeAfter ?? configured;
        yield* Ref.update(world.state, (state) =>
          current.teamRosters[input.providerTeamKey] === undefined
            ? { ...state, roster: after }
            : {
                ...state,
                teamRosters: { ...state.teamRosters, [input.providerTeamKey]: after },
              },
        );
      }
      return result;
    }),
    applyExplicitAssignments: Effect.fn("FakeProvider.applyExplicitAssignments")(function* (input) {
      const current = yield* prepare(input, "apply_explicit_assignments").pipe(
        Effect.mapError((error) =>
          error._tag === "provider.session_rejected"
            ? error
            : ProviderResponseInvalid.make({ operation: "apply_explicit_assignments" }),
        ),
      );
      if (current.roster === undefined) {
        return yield* ProviderResponseInvalid.make({
          operation: "apply_explicit_assignments",
        });
      }
      if (current.roster.providerTeamKey !== input.providerTeamKey) {
        return { status: "rejected" as const, reason: "not_found" as const };
      }
      yield* Ref.update(world.state, (state) => ({
        ...state,
        explicitCalls: state.explicitCalls + 1,
        explicitRequests: [...state.explicitRequests, input.assignments],
      }));
      if (current.explicitAction === "invalid") {
        return yield* ProviderResponseInvalid.make({
          operation: "apply_explicit_assignments",
        });
      }
      const result: ProviderWriteResult = writeResult(
        current.explicitAction,
        current.explicitDetail,
      );
      if (current.explicitAction === "accept" || current.explicitAction === "lost_response") {
        const after = current.explicitAfter ?? applyAssignments(current.roster, input.assignments);
        yield* Ref.update(world.state, (state) => ({ ...state, roster: after }));
      }
      return result;
    }),
    applyTransaction: Effect.fn("FakeProvider.applyTransaction")(function* (input) {
      const current = yield* prepare(input, "apply_transaction").pipe(
        Effect.mapError((error) =>
          error._tag === "provider.session_rejected"
            ? error
            : ProviderResponseInvalid.make({ operation: "apply_transaction" }),
        ),
      );
      yield* Ref.update(world.state, (state) => ({
        ...state,
        writeSequence: [...state.writeSequence, "transaction" as const],
        transactionRequests: [
          ...state.transactionRequests,
          {
            providerLeagueKey: input.providerLeagueKey,
            providerTeamKey: input.providerTeamKey,
            adds: input.adds,
            drops: input.drops,
            faabBid: input.faabBid,
          },
        ],
      }));
      const action =
        current.teamTransactionActions[input.providerTeamKey] ?? current.transactionAction;
      if (action === "invalid") {
        return yield* ProviderResponseInvalid.make({ operation: "apply_transaction" });
      }
      return writeResult(action, current.transactionDetail, current.transactionStatus);
    }),
    proposeTrade: Effect.fn("FakeProvider.proposeTrade")(function* (input) {
      const current = yield* prepare(input, "propose_trade").pipe(
        Effect.mapError((error) =>
          error._tag === "provider.session_rejected"
            ? error
            : ProviderResponseInvalid.make({ operation: "propose_trade" }),
        ),
      );
      const acceptedKey =
        current.tradeProposalAction === "accept" ? current.tradeProposalKey : undefined;
      yield* Ref.update(world.state, (state) => ({
        ...state,
        writeSequence: [...state.writeSequence, "propose_trade" as const],
        tradeProposalRequests: [
          ...state.tradeProposalRequests,
          {
            providerLeagueKey: input.providerLeagueKey,
            providerTeamKey: input.providerTeamKey,
            counterpartyTeamKey: input.counterpartyTeamKey,
            send: input.send,
            receive: input.receive,
            note: input.note,
            session: Redacted.value(input.session),
          },
        ],
        ...(acceptedKey === undefined
          ? {}
          : {
              pendingTrades: [
                ...state.pendingTrades,
                fakePendingTrade({
                  transactionKey: acceptedKey,
                  providerTeamKey: input.providerTeamKey,
                  counterpartyTeamKey: input.counterpartyTeamKey,
                  send: input.send,
                  receive: input.receive,
                  note: input.note,
                }),
              ],
            }),
      }));
      if (current.tradeProposalAction === "invalid") {
        return yield* ProviderResponseInvalid.make({ operation: "propose_trade" });
      }
      if (current.tradeProposalAction === "accept") {
        return acceptedKey === undefined
          ? { status: "unknown" as const }
          : { status: "accepted" as const, transactionKey: acceptedKey };
      }
      return tradeWriteResult(current.tradeProposalAction);
    }),
    withdrawTrade: Effect.fn("FakeProvider.withdrawTrade")(function* (input) {
      const current = yield* prepare(input, "withdraw_trade").pipe(
        Effect.mapError((error) =>
          error._tag === "provider.session_rejected"
            ? error
            : ProviderResponseInvalid.make({ operation: "withdraw_trade" }),
        ),
      );
      yield* Ref.update(world.state, (state) => ({
        ...state,
        writeSequence: [...state.writeSequence, "withdraw_trade" as const],
        withdrawTradeRequests: [...state.withdrawTradeRequests, input.transactionKey],
        ...(current.withdrawTradeAction === "accept"
          ? {
              pendingTrades: state.pendingTrades.filter(
                (offer) => offer.transactionKey !== input.transactionKey,
              ),
            }
          : {}),
      }));
      if (current.withdrawTradeAction === "invalid") {
        return yield* ProviderResponseInvalid.make({ operation: "withdraw_trade" });
      }
      return writeResult(current.withdrawTradeAction, current.withdrawTradeDetail);
    }),
    applyReserveMove: Effect.fn("FakeProvider.applyReserveMove")(function* (input) {
      const current = yield* prepare(input, "apply_reserve_move").pipe(
        Effect.mapError((error) =>
          error._tag === "provider.session_rejected"
            ? error
            : ProviderResponseInvalid.make({ operation: "apply_reserve_move" }),
        ),
      );
      yield* Ref.update(world.state, (state) => ({
        ...state,
        writeSequence: [...state.writeSequence, "reserve_move" as const],
        reserveRequests: [
          ...state.reserveRequests,
          {
            providerTeamKey: input.providerTeamKey,
            coverage: input.coverage,
            providerPlayerKey: input.providerPlayerKey,
            slot: input.slot,
          },
        ],
      }));
      if (current.reserveAction === "invalid") {
        return yield* ProviderResponseInvalid.make({ operation: "apply_reserve_move" });
      }
      return writeResult(current.reserveAction, current.reserveDetail);
    }),
    readPlayerDetails: Effect.fn("FakeProvider.readPlayerDetails")(function* (input) {
      const current = yield* prepare(input, "read_player_details");
      if (current.playerDetailsFailure !== undefined) {
        return yield* ProviderPeriodMismatch.make({
          operation: "read_player_details",
          requested: current.playerDetailsFailure.requested,
          covered: current.playerDetailsFailure.covered,
        });
      }
      const basis = yield* fakePlayerBasis(input.period, input.sport, input.currentPeriod);
      const requested = new Set(input.providerPlayerKeys);
      return current.playerDetails
        .filter((player) => requested.has(player.providerPlayerKey))
        .map((player) => ({
          ...player,
          actual:
            player.actual === undefined
              ? undefined
              : { basis, stats: player.actual.stats, notAggregated: [] },
        }));
    }),
    readPlayerWeeks: Effect.fn("FakeProvider.readPlayerWeeks")(function* (input) {
      const current = yield* prepare(input, "read_player_weeks");
      const rostered = new Map(
        (current.roster?.players ?? []).map(
          (player) => [player.providerPlayerKey, player] as const,
        ),
      );
      return input.providerPlayerKeys.map((providerPlayerKey) => {
        const configured = current.playerWeeks.find(
          (week) => week.providerPlayerKey === providerPlayerKey,
        );
        if (configured !== undefined) {
          return configured;
        }
        const player = rostered.get(providerPlayerKey);
        return {
          providerPlayerKey,
          week: input.week.week,
          plays: player?.scheduled ?? true,
          opponent: player?.opponent,
          projectedRank: undefined,
        };
      });
    }),
    readPlayerHistory: Effect.fn("FakeProvider.readPlayerHistory")(function* (input) {
      const current = yield* prepare(input, "read_player_history");
      if (current.playerDetailsFailure !== undefined) {
        return yield* ProviderPeriodMismatch.make({
          operation: "read_player_history",
          requested: current.playerDetailsFailure.requested,
          covered: current.playerDetailsFailure.covered,
        });
      }
      const requested = new Set(input.providerPlayerKeys);
      const details = current.playerDetails.filter((player) =>
        requested.has(player.providerPlayerKey),
      );
      return input.periods.map((period) => ({ period, details }));
    }),
    searchPlayers: Effect.fn("FakeProvider.searchPlayers")(function* (input) {
      const current = yield* prepare(input, "search_players");
      const query = input.query?.toLocaleLowerCase();
      const rows: ReadonlyArray<ProviderPlayerSearchResult["players"][number]> =
        current.searchPlayers ??
        current.playerDetails.flatMap(
          (player): ReadonlyArray<ProviderPlayerSearchResult["players"][number]> => {
            if (
              player.rosterStatus === "unknown" ||
              player.name === undefined ||
              player.primaryPosition === undefined ||
              player.displayPosition === undefined ||
              player.eligiblePositions === undefined
            ) {
              return [];
            }
            return [
              {
                providerPlayerKey: player.providerPlayerKey,
                name: player.name,
                primaryPosition: player.primaryPosition,
                displayPosition: player.displayPosition,
                eligiblePositions: player.eligiblePositions,
                availability: player.rosterStatus,
                proTeam: undefined,
                status: { value: "healthy", code: undefined, detail: undefined },
                percentOwned: null,
                percentOwnedDelta: null,
                percentStarted: null,
                percentStartedChange: null,
                actualRank: null,
                overallRank: null,
                statValue: null,
                transactionTrend: {
                  status: "not_published",
                  reason: "The fake provider publishes no transaction trend.",
                },
              },
            ];
          },
        );
      const filtered = rows.filter(
        (player) =>
          (input.availability === "all" || player.availability === input.availability) &&
          (query === undefined || query === "" || player.name.toLocaleLowerCase().includes(query)),
      );
      const ascending = (left: number | null, right: number | null): number =>
        (left ?? Number.POSITIVE_INFINITY) - (right ?? Number.POSITIVE_INFINITY);
      const descending = (left: number | null, right: number | null): number =>
        (right ?? Number.NEGATIVE_INFINITY) - (left ?? Number.NEGATIVE_INFINITY);
      const sorted = [...filtered].sort((left, right) => {
        switch (input.sort) {
          case "name":
            return left.name.localeCompare(right.name);
          case "position":
            return left.primaryPosition.localeCompare(right.primaryPosition);
          case "ownership":
            return descending(left.percentOwned, right.percentOwned);
          case "actual_rank":
            return ascending(left.actualRank, right.actualRank);
          case "overall_rank":
            return ascending(left.overallRank, right.overallRank);
          case "stat":
            return descending(left.statValue, right.statValue);
        }
      });
      return { players: sorted.slice(0, input.limit) };
    }),
    readMatchups: Effect.fn("FakeProvider.readMatchups")(function* (input) {
      const current = yield* prepare(input, "read_matchups");
      return current.matchups.filter((matchup) => matchup.period.week === input.period.week);
    }),
    readTransactions: Effect.fn("FakeProvider.readTransactions")(function* (input) {
      const current = yield* prepare(input, "read_transactions");
      const offset = input.offset ?? 0;
      return current.transactions
        .filter(
          (transaction) =>
            input.providerTeamKey === undefined ||
            transaction.teams.some((team) => team.providerTeamKey === input.providerTeamKey),
        )
        .slice(offset, offset + input.limit);
    }),
    readCompletedTrades: Effect.fn("FakeProvider.readCompletedTrades")(function* (input) {
      const current = yield* prepare(input, "read_completed_trades");
      return current.completedTrades
        .filter((transaction) =>
          transaction.teams.some((team) => team.providerTeamKey === input.providerTeamKey),
        )
        .slice(0, input.limit);
    }),
    readPendingTrades: Effect.fn("FakeProvider.readPendingTrades")(function* (input) {
      const current = yield* prepare(input, "read_pending_trades");
      return current.pendingTrades.filter(
        (offer) =>
          offer.proposer?.providerTeamKey === input.providerTeamKey ||
          offer.receiver?.providerTeamKey === input.providerTeamKey,
      );
    }),
    readDraftResults: Effect.fn("FakeProvider.readDraftResults")(function* (input) {
      const current = yield* prepare(input, "read_draft_results");
      return current.draftResults.filter((pick) =>
        pick.providerTeamKey.startsWith(`${input.providerLeagueKey}.t.`),
      );
    }),
    readLeagueTeams: Effect.fn("FakeProvider.readLeagueTeams")(function* (input) {
      const current = yield* prepare(input, "read_league_teams");
      return current.leagueTeams.filter(
        (team) => team.providerLeagueKey === input.providerLeagueKey,
      );
    }),
    readLeagueRosters: Effect.fn("FakeProvider.readLeagueRosters")(function* (input) {
      const current = yield* prepare(input, "read_league_rosters");
      const rosters = (current.leagueRosters ?? []).filter(
        (roster) => roster.providerLeagueKey === input.providerLeagueKey,
      );
      if (rosters.length === 0) {
        return yield* ProviderOperationUnsupported.make({
          operation: "read_league_rosters",
          reason: "No league rosters are configured for the fake provider.",
        });
      }
      return rosters;
    }),
    scoreRoster: Effect.fn("FakeProvider.scoreRoster")(function* (input: ProviderScoreRequest) {
      const current = yield* prepare(input, "read_player_details");
      if (current.planRefusal !== undefined) {
        return {
          kind: "refused" as const,
          refusal: current.planRefusal.refusal,
          provenance: current.planRefusal.provenance,
          detail: current.planRefusal.detail,
        };
      }
      return planFakeLineup(input, current.playerScores, current.gamesPlayed);
    }),
  } satisfies ProviderShape;
});

export const ProviderFakeTest = Layer.effect(ProviderRegistry)(
  Effect.map(providerFake, (provider) => ProviderRegistry.of(providerRegistryOf([provider]))),
).pipe(Layer.provideMerge(FakeProviderWorld.layer));

const readOperations: ReadonlySet<ProviderOperation> = new Set<ProviderOperation>([
  "validate_session",
  "discover_teams",
  "read_league",
  "read_standings",
  "read_roster",
  "read_league_rosters",
  "read_roster_schedule",
  "read_player_details",
  "read_player_history",
  "read_player_weeks",
  "read_matchups",
  "search_players",
  "read_transactions",
  "read_completed_trades",
  "read_pending_trades",
  "read_draft_results",
  "read_league_teams",
]);

const fakeCapabilities: ProviderCapabilities = {
  fantasyDay: {
    timeZone: "America/Los_Angeles",
    boundary: "local-midnight",
    version: "yahoo-pacific-midnight/1",
  },
  sports: ["football", "hockey"],
  playerSearch: {
    sorts: ["name", "position", "ownership", "actual_rank", "overall_rank", "stat"],
    providerOrderedSorts: ["actual_rank", "overall_rank", "stat"],
    weeklyOrderingValues: false,
  },
  statPeriods: {
    football: {
      kinds: { season: "native", week: "native", preset: "unsupported", range: "unsupported" },
      presets: [],
      maximumRangeDays: 0,
      detail: "The fake provider publishes season and completed-week player series only.",
    },
    hockey: {
      kinds: { season: "native", week: "unsupported", preset: "aggregated", range: "aggregated" },
      presets: [
        { preset: "last_7_days", days: 7 },
        { preset: "last_14_days", days: 14 },
        { preset: "last_30_days", days: 30 },
      ],
      maximumRangeDays: 31,
      detail:
        "The fake provider publishes no weekly player series for hockey and serves preset windows and explicit ranges by aggregating daily reads.",
    },
    baseball: {
      kinds: {
        season: "unsupported",
        week: "unsupported",
        preset: "unsupported",
        range: "unsupported",
      },
      presets: [],
      maximumRangeDays: 0,
      detail: "The fake provider does not serve baseball.",
    },
    basketball: {
      kinds: {
        season: "unsupported",
        week: "unsupported",
        preset: "unsupported",
        range: "unsupported",
      },
      presets: [],
      maximumRangeDays: 0,
      detail: "The fake provider does not serve basketball.",
    },
  },
  projections: { basis: "week", sports: ["football"] },
  scheduleRead: { maximumDates: 21 },
  tradeProposal: {
    assets: ["player"],
    detail:
      "The fake provider's trade proposal request names players only and publishes no element for a draft pick.",
  },
  transactionRequest: { maximumAdds: 1, maximumDrops: 1 },
  limitations: [
    {
      subject: "team_remaining_games",
      detail:
        "This provider publishes no remaining-game count for football: a player plays at most one game per scoring week, and each roster entry carries the bye week instead.",
    },
    {
      subject: "per_team_games_played",
      detail:
        "This provider publishes no per-team games-played count: its league settings carry only the league's games-played cap.",
    },
  ],
};

function planFakeLineup(
  input: ProviderScoreRequest,
  scores: ReadonlyArray<FakePlayerScore>,
  gamesPlayed: ReadonlyArray<ProviderGamesPlayed>,
): ProviderScoreOutcome {
  if (scores.length === 0) {
    return {
      kind: "refused",
      refusal: "structural",
      provenance: "fake/no-score",
      detail: "This league publishes no score the custom planner can use.",
    };
  }
  const byKey = new Map(scores.map((score) => [score.providerPlayerKey, score]));
  const values = input.roster.players.map((player): ProviderPlayerScore => {
    const declared = byKey.get(player.providerPlayerKey);
    if (declared === undefined) {
      throw new Error("The fake provider must declare a score for every roster player.");
    }
    return {
      providerPlayerKey: player.providerPlayerKey,
      score: declared.score,
      availability: declared.availability,
    };
  });
  return { kind: "scored", provenance: "fake/declared-score", players: values, gamesPlayed };
}

function validate(
  input: ProviderSessionMaterial,
  operation: ProviderOperation,
): Effect.Effect<void, ProviderSessionRejected> {
  return Schema.decodeEffect(ProviderSessionMaterial)(input).pipe(
    Effect.flatMap((decoded) =>
      Redacted.value(decoded.session).length === 0
        ? ProviderSessionRejected.make({ operation })
        : Effect.void,
    ),
    Effect.mapError(() => ProviderSessionRejected.make({ operation })),
  );
}

const fakeFantasyDay = "2026-10-26";

function fakePlayerBasis(
  period: ProviderStatPeriod,
  sport: FantasySport,
  currentPeriod: number | undefined,
): Effect.Effect<ProviderStatBasis, ProviderPeriodUnsupported> {
  const support = fakeCapabilities.statPeriods[sport];
  const unsupported = support.kinds[period.kind] === "unsupported";
  if (unsupported) {
    return ProviderPeriodUnsupported.make({
      operation: "read_player_details",
      kind: period.kind,
      declared: "unsupported",
      reason: support.detail,
      remedy: `Ask for one of: \`kind: "season"\` for season totals, \`kind: "preset"\` with ${support.presets
        .map((entry) => entry.preset)
        .join(", ")}, \`kind: "range"\` with an explicit \`start\` and \`end\` of at most ${String(
        support.maximumRangeDays,
      )} days.`,
    });
  }
  switch (period.kind) {
    case "season":
      return Effect.succeed({ type: "season" as const });
    case "week":
      return currentPeriod === undefined || period.week >= currentPeriod
        ? ProviderPeriodUnsupported.make({
            operation: "read_player_details",
            kind: "week",
            declared: support.kinds.week,
            reason: `The provider publishes weekly player statistics only for a completed scoring week, and week ${String(period.week)} is the current or upcoming week.`,
            remedy: 'Ask for a completed week, or `kind: "season"` for season totals.',
          })
        : Effect.succeed({ type: "week" as const, week: period.week });
    case "preset": {
      const window = support.presets.find((entry) => entry.preset === period.preset);
      const days = window?.days ?? 1;
      return Effect.succeed({
        type: "date_range" as const,
        start: fakeShiftDate(fakeFantasyDay, -(days - 1)),
        end: fakeFantasyDay,
        days,
      });
    }
    case "range":
      return Effect.succeed({
        type: "date_range" as const,
        start: period.start,
        end: period.end,
        days: fakeDayCount(period.start, period.end),
      });
  }
}

function fakeShiftDate(date: string, days: number): string {
  return DateTime.formatIsoDate(
    DateTime.add(DateTime.makeUnsafe(`${date}T00:00:00.000Z`), { days }),
  );
}

function fakeDayCount(start: string, end: string): number {
  const from = DateTime.toEpochMillis(DateTime.makeUnsafe(`${start}T00:00:00.000Z`));
  const to = DateTime.toEpochMillis(DateTime.makeUnsafe(`${end}T00:00:00.000Z`));
  return (to - from) / 86_400_000 + 1;
}

function fakePendingTrade(input: {
  readonly transactionKey: string;
  readonly providerTeamKey: string;
  readonly counterpartyTeamKey: string;
  readonly send: ReadonlyArray<string>;
  readonly receive: ReadonlyArray<string>;
  readonly note: string | undefined;
}): ProviderPendingTrade {
  const proposer = { providerTeamKey: input.providerTeamKey, name: undefined };
  const receiver = { providerTeamKey: input.counterpartyTeamKey, name: undefined };
  const player = (
    providerPlayerKey: string,
    from: typeof proposer,
    to: typeof proposer,
  ): ProviderTransactionPlayer => ({
    providerPlayerKey,
    movement: { kind: "other", from, to },
    name: undefined,
    primaryPosition: undefined,
    displayPosition: undefined,
    eligiblePositions: undefined,
    proTeam: undefined,
  });
  return {
    transactionKey: input.transactionKey,
    proposedAt: "2026-11-01T00:00:00.000Z",
    note: input.note,
    canRespond: false,
    proposer,
    receiver,
    unusedRosterSpots: undefined,
    players: [
      ...input.send.map((key) => player(key, proposer, receiver)),
      ...input.receive.map((key) => player(key, receiver, proposer)),
    ],
    picks: [],
    incomplete: undefined,
  };
}

function tradeWriteResult(action: Exclude<FakeWriteAction, "accept">): ProviderTradeProposalResult {
  switch (action) {
    case "lost_response":
      return { status: "unknown" };
    case "unavailable":
      return { status: "not_sent", reason: "request_failed" };
    case "reject":
    case "invalid":
      return { status: "rejected", reason: "invalid_request" };
  }
}

function writeResult(
  action: FakeWriteAction,
  detail?: string,
  httpStatus?: number,
): ProviderWriteResult {
  switch (action) {
    case "accept":
      return { status: "accepted" };
    case "lost_response":
      return { status: "unknown" };
    case "unavailable":
      return {
        status: "not_sent",
        reason: "request_failed",
        ...(detail === undefined ? {} : { detail }),
      };
    case "reject":
      return {
        status: "rejected",
        reason: "invalid_request",
        ...(detail === undefined ? {} : { detail }),
        ...(httpStatus === undefined ? {} : { httpStatus }),
      };
    case "invalid":
      return {
        status: "rejected",
        reason: "invalid_request",
        ...(detail === undefined ? {} : { detail }),
      };
  }
}

function applyAssignments(
  roster: ProviderRoster,
  assignments: ReadonlyArray<ProviderLineupAssignment>,
): ProviderRoster {
  const slots = new Map(
    assignments.map((assignment) => [assignment.providerPlayerKey, assignment.slot]),
  );
  return {
    ...roster,
    players: roster.players.map((player) => {
      const assigned = slots.get(player.providerPlayerKey);
      return {
        ...player,
        slot: assigned === undefined ? player.slot : { status: "verified", slot: assigned },
      };
    }),
  };
}

function scheduleForPeriod(
  schedule: ProviderRosterSchedule,
  period: ProviderSchedulePeriod,
): ProviderRosterSchedule {
  if (period.type === "week") {
    return { ...schedule, period };
  }
  const dates = datesInRange(period.start, period.end);
  const covered = new Set(dates);
  return {
    ...schedule,
    period,
    dates: schedule.dates.filter((date) => covered.has(date)),
    players: schedule.players.map((player) => ({
      ...player,
      games: player.games.filter((game) => game.date !== undefined && covered.has(game.date)),
    })),
  };
}

function datesInRange(start: string, end: string): ReadonlyArray<string> {
  const first = DateTime.makeUnsafe(`${start}T00:00:00.000Z`);
  const last = DateTime.makeUnsafe(`${end}T00:00:00.000Z`);
  const span = Math.floor(
    (DateTime.toEpochMillis(last) - DateTime.toEpochMillis(first)) / 86_400_000,
  );
  return globalThis.Array.from({ length: span + 1 }, (_, index) =>
    DateTime.formatIsoDate(DateTime.add(first, { days: index })),
  );
}

function requestFailure(
  state: FakeProviderState,
  operation: ProviderOperation,
): Effect.Effect<void, ProviderRequestFailed | ProviderResponseInvalid> {
  switch (state.requestFailure) {
    case "unavailable":
      return ProviderRequestFailed.make({ operation });
    case "invalid_response":
      return ProviderResponseInvalid.make({ operation });
    case undefined:
      return Effect.void;
  }
}

type FakeTransactionRequest = {
  readonly providerLeagueKey: string;
  readonly providerTeamKey: string;
  readonly adds: ReadonlyArray<string>;
  readonly drops: ReadonlyArray<string>;
  readonly faabBid: number | undefined;
};

type FakeTradeProposalRequest = {
  readonly providerLeagueKey: string;
  readonly providerTeamKey: string;
  readonly counterpartyTeamKey: string;
  readonly send: ReadonlyArray<string>;
  readonly receive: ReadonlyArray<string>;
  readonly note: string | undefined;
  readonly session: string;
};

type FakeReserveMoveRequest = {
  readonly providerTeamKey: string;
  readonly coverage: ProviderRosterCoverage;
  readonly providerPlayerKey: string;
  readonly slot: string;
};

type FakeRequestFailure = "unavailable" | "invalid_response";
