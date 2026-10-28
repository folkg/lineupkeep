import { Context, Deferred, Effect, Layer, Option, Redacted, Ref, Schema } from "effect";

import {
  ProviderOperationUnsupported,
  ProviderPeriodMismatch,
  ProviderRequestFailed,
  ProviderResponseInvalid,
  ProviderReviewLinkInvalid,
  ProviderSessionMaterial,
  ProviderSessionRejected,
} from "#contexts/connections/Provider.ts";
import type {
  ProviderAvailabilityTier,
  ProviderCapabilities,
  ProviderGamesPlayed,
  ProviderLeagueSettings,
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
  ProviderPlayerSearchResult,
  ProviderReviewLinkInput,
  ProviderRoster,
  ProviderRosterCoverage,
  ProviderShape,
  ProviderStandings,
  ProviderTeam,
  ProviderTransaction,
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

type FakeProviderState = {
  readonly sessionRejected: boolean;
  readonly teams: ReadonlyArray<ProviderTeam>;
  readonly requestFailure: FakeRequestFailure | undefined;
  readonly discoveryGate: Option.Option<FakeGate>;
  readonly rosterReadGate: Option.Option<FakeGate>;
  readonly league: ProviderLeagueSettings | undefined;
  readonly leagueFailure: ProviderResponseInvalid | undefined;
  readonly standings: ProviderStandings | undefined;
  readonly standingsFailure: ProviderResponseInvalid | undefined;
  readonly roster: ProviderRoster | undefined;
  readonly rosterAfterNextRead: ProviderRoster | undefined;
  readonly rosterPeriods: ReadonlyArray<ProviderRosterCoverage | undefined>;
  readonly playerDetails: ReadonlyArray<ProviderPlayerDetail>;
  readonly searchPlayers: ReadonlyArray<ProviderPlayerSearchResult["players"][number]> | undefined;
  readonly playerScores: ReadonlyArray<FakePlayerScore>;
  readonly gamesPlayed: ReadonlyArray<ProviderGamesPlayed>;
  readonly playerDetailsFailure: ProviderPeriodMismatch | undefined;
  readonly matchups: ReadonlyArray<ProviderMatchup>;
  readonly transactions: ReadonlyArray<ProviderTransaction>;
  readonly leagueTeams: ReadonlyArray<ProviderLeagueTeam>;
  readonly unsupported: ReadonlySet<ProviderOperation>;
  readonly reviewLinkFailure: ProviderReviewLinkInvalid | undefined;
  readonly reviewLinkUrl: string | undefined;
  readonly nativeAction: FakeWriteAction;
  readonly nativeAfter: ProviderRoster | undefined;
  readonly nativeTargets: ReadonlyArray<ProviderNativeTarget>;
  readonly nativeCalls: number;
  readonly explicitAction: FakeWriteAction;
  readonly explicitAfter: ProviderRoster | undefined;
  readonly explicitRequests: ReadonlyArray<ReadonlyArray<ProviderLineupAssignment>>;
  readonly explicitCalls: number;
  readonly planRefusal: FakePlanRefusal | undefined;
};

export type FakeProviderWorldShape = {
  readonly state: Ref.Ref<FakeProviderState>;
  readonly rejectSession: (rejected: boolean) => Effect.Effect<void>;
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
  readonly setRosterAfterNextRead: (roster: ProviderRoster | undefined) => Effect.Effect<void>;
  readonly rosterPeriods: Effect.Effect<ReadonlyArray<ProviderRosterCoverage | undefined>>;
  readonly setPlayerDetails: (details: ReadonlyArray<ProviderPlayerDetail>) => Effect.Effect<void>;
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
  readonly setLeagueTeams: (teams: ReadonlyArray<ProviderLeagueTeam>) => Effect.Effect<void>;
  readonly unsupportedOperations: (
    operations: ReadonlyArray<ProviderOperation>,
  ) => Effect.Effect<void>;
  readonly failReviewLinks: (failure: ProviderReviewLinkInvalid | undefined) => Effect.Effect<void>;
  readonly setReviewLinkUrl: (url: string | undefined) => Effect.Effect<void>;
  readonly setNativeAction: (action: FakeWriteAction) => Effect.Effect<void>;
  readonly setNativeAfter: (roster: ProviderRoster | undefined) => Effect.Effect<void>;
  readonly nativeTargets: Effect.Effect<ReadonlyArray<ProviderNativeTarget>>;
  readonly nativeCallCount: Effect.Effect<number>;
  readonly setExplicitAction: (action: FakeWriteAction) => Effect.Effect<void>;
  readonly setExplicitAfter: (roster: ProviderRoster | undefined) => Effect.Effect<void>;
  readonly explicitRequests: Effect.Effect<ReadonlyArray<ReadonlyArray<ProviderLineupAssignment>>>;
  readonly explicitCallCount: Effect.Effect<number>;
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
        teams: [],
        requestFailure: undefined,
        discoveryGate: Option.none(),
        rosterReadGate: Option.none(),
        league: undefined,
        leagueFailure: undefined,
        standings: undefined,
        standingsFailure: undefined,
        roster: undefined,
        rosterAfterNextRead: undefined,
        rosterPeriods: [],
        playerDetails: [],
        searchPlayers: undefined,
        playerScores: [],
        gamesPlayed: [],
        playerDetailsFailure: undefined,
        matchups: [],
        transactions: [],
        leagueTeams: [],
        unsupported: new Set(),
        reviewLinkFailure: undefined,
        reviewLinkUrl: undefined,
        nativeAction: "accept",
        nativeAfter: undefined,
        nativeTargets: [],
        nativeCalls: 0,
        explicitAction: "accept",
        explicitAfter: undefined,
        explicitRequests: [],
        explicitCalls: 0,
        planRefusal: undefined,
      });
      const modify = (
        update: (current: FakeProviderState) => FakeProviderState,
      ): Effect.Effect<void> => Ref.update(state, update);
      return {
        state,
        rejectSession: (rejected) =>
          modify((current) => ({ ...current, sessionRejected: rejected })),
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
        setRosterAfterNextRead: (rosterAfterNextRead) =>
          modify((current) => ({ ...current, rosterAfterNextRead })),
        rosterPeriods: Effect.map(Ref.get(state), (current) => current.rosterPeriods),
        setPlayerDetails: (playerDetails) => modify((current) => ({ ...current, playerDetails })),
        setSearchPlayers: (players) =>
          modify((current) => ({ ...current, searchPlayers: players })),
        setPlayerScores: (playerScores) => modify((current) => ({ ...current, playerScores })),
        setGamesPlayed: (gamesPlayed) => modify((current) => ({ ...current, gamesPlayed })),
        failPlayerDetails: (playerDetailsFailure) =>
          modify((current) => ({ ...current, playerDetailsFailure })),
        setMatchups: (matchups) => modify((current) => ({ ...current, matchups })),
        setTransactions: (transactions) => modify((current) => ({ ...current, transactions })),
        setLeagueTeams: (leagueTeams) => modify((current) => ({ ...current, leagueTeams })),
        unsupportedOperations: (operations) =>
          modify((current) => ({ ...current, unsupported: new Set(operations) })),
        failReviewLinks: (reviewLinkFailure) =>
          modify((current) => ({ ...current, reviewLinkFailure })),
        setReviewLinkUrl: (reviewLinkUrl) => modify((current) => ({ ...current, reviewLinkUrl })),
        setNativeAction: (nativeAction) => modify((current) => ({ ...current, nativeAction })),
        setNativeAfter: (nativeAfter) => modify((current) => ({ ...current, nativeAfter })),
        nativeTargets: Effect.map(Ref.get(state), (current) => current.nativeTargets),
        nativeCallCount: Effect.map(Ref.get(state), (current) => current.nativeCalls),
        setExplicitAction: (explicitAction) =>
          modify((current) => ({ ...current, explicitAction })),
        setExplicitAfter: (explicitAfter) => modify((current) => ({ ...current, explicitAfter })),
        explicitRequests: Effect.map(Ref.get(state), (current) => current.explicitRequests),
        explicitCallCount: Effect.map(Ref.get(state), (current) => current.explicitCalls),
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
      const current = yield* Ref.get(world.state);
      if (current.sessionRejected) {
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
    reviewLinkTemplate: { version: "fake-review-links-v1" },
    validateSession: Effect.fn("FakeProvider.validateSession")(function* (input) {
      yield* validate(input, "validate_session");
      const current = yield* Ref.get(world.state);
      if (current.sessionRejected) {
        return yield* ProviderSessionRejected.make({ operation: "validate_session" });
      }
      yield* requestFailure(current, "validate_session");
    }),
    discoverTeams: Effect.fn("FakeProvider.discoverTeams")(function* (input) {
      yield* validate(input, "discover_teams");
      const current = yield* Ref.get(world.state);
      if (current.sessionRejected) {
        return yield* ProviderSessionRejected.make({ operation: "discover_teams" });
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
      if (current.roster === undefined) {
        return yield* ProviderOperationUnsupported.make({
          operation: "read_roster",
          reason: "No roster is configured for the fake provider.",
        });
      }
      if (current.roster.providerTeamKey !== input.providerTeamKey) {
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
      const coverage = current.roster.coverage;
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
      return current.roster;
    }),
    applyNativeAction: Effect.fn("FakeProvider.applyNativeAction")(function* (input) {
      const current = yield* prepare(input, "apply_native_action").pipe(
        Effect.mapError((error) =>
          error._tag === "provider.session_rejected"
            ? error
            : ProviderResponseInvalid.make({ operation: "apply_native_action" }),
        ),
      );
      if (current.roster === undefined) {
        return yield* ProviderResponseInvalid.make({
          operation: "apply_native_action",
        });
      }
      if (current.roster.providerTeamKey !== input.providerTeamKey) {
        return { status: "rejected" as const, reason: "not_found" as const };
      }
      yield* Ref.update(world.state, (state) => ({
        ...state,
        nativeCalls: state.nativeCalls + 1,
        nativeTargets: [...state.nativeTargets, input.target],
      }));
      const result: ProviderWriteResult = writeResult(current.nativeAction);
      if (current.nativeAction === "accept" || current.nativeAction === "lost_response") {
        const after = current.nativeAfter ?? current.roster;
        yield* Ref.update(world.state, (state) => ({ ...state, roster: after }));
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
      const result: ProviderWriteResult = writeResult(current.explicitAction);
      if (current.explicitAction === "accept" || current.explicitAction === "lost_response") {
        const after = current.explicitAfter ?? applyAssignments(current.roster, input.assignments);
        yield* Ref.update(world.state, (state) => ({ ...state, roster: after }));
      }
      return result;
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
      const requested = new Set(input.providerPlayerKeys);
      return current.playerDetails.filter((player) => requested.has(player.providerPlayerKey));
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
                percentOwned: null,
                percentOwnedDelta: null,
                percentStarted: null,
                percentStartedChange: null,
                actualRank: null,
                overallRank: null,
                statValue: null,
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
      return current.transactions
        .filter(
          (transaction) =>
            input.providerTeamKey === undefined ||
            transaction.teams.some((team) => team.providerTeamKey === input.providerTeamKey),
        )
        .slice(0, input.limit);
    }),
    readLeagueTeams: Effect.fn("FakeProvider.readLeagueTeams")(function* (input) {
      const current = yield* prepare(input, "read_league_teams");
      return current.leagueTeams.filter(
        (team) => team.providerLeagueKey === input.providerLeagueKey,
      );
    }),
    buildReviewLink: Effect.fn("FakeProvider.buildReviewLink")(function* (
      input: ProviderReviewLinkInput,
    ) {
      const current = yield* Ref.get(world.state);
      if (current.reviewLinkUrl !== undefined) {
        return current.reviewLinkUrl;
      }
      if (current.reviewLinkFailure !== undefined) {
        return yield* ProviderReviewLinkInvalid.make({
          reason: current.reviewLinkFailure.reason,
        });
      }
      const url = new URL(`https://review.example.test/league/${input.providerLeagueKey}/add`);
      const append = (name: "apid" | "dpid", key: string): void => {
        url.searchParams.append(name, key.slice(key.lastIndexOf(".p.") + 3));
      };
      switch (input.intent.kind) {
        case "add":
          append("apid", input.intent.add);
          break;
        case "add_drop":
          append("apid", input.intent.add);
          append("dpid", input.intent.drop);
          break;
        case "drop":
          append("dpid", input.intent.drop);
          break;
        case "trade":
          return yield* ProviderReviewLinkInvalid.make({
            reason: "unsupported-review-surface",
          });
      }
      return url.href;
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
  },
  publishesProjections: false,
  limitations: [
    {
      subject: "player_schedule",
      detail:
        "This provider publishes no per-player games-remaining or probable-starter field. A roster entry carries the professional-team abbreviation and, where the league publishes one, the bye week; remaining player-games are available per fantasy team from get_matchups and get_team_summary.",
    },
    {
      subject: "probable_starters",
      detail:
        "This provider publishes no probable-starter field on its fantasy read surface, so participation is reported only through the provider's injury status.",
    },
    {
      subject: "projections",
      detail: "This provider does not expose projected player statistics.",
    },
    {
      subject: "team_remaining_games",
      detail:
        "This provider publishes no remaining-game count for football: a player plays at most one game per scoring week, and each roster entry carries the bye week instead.",
    },
    {
      subject: "lock_timing",
      detail:
        "This provider's exact fantasy-day rollover and per-player lock timing are not verified. This reports the league's declared period range only.",
    },
    {
      subject: "historical_seasons",
      detail: "Only the linked team's current season is validated for this provider.",
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

function writeResult(action: FakeWriteAction): ProviderWriteResult {
  switch (action) {
    case "accept":
      return { status: "accepted" };
    case "lost_response":
      return { status: "unknown" };
    case "unavailable":
      return { status: "not_sent", reason: "request_failed" };
    case "reject":
      return { status: "rejected", reason: "invalid_request" };
    case "invalid":
      return { status: "rejected", reason: "invalid_request" };
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
    players: roster.players.map((player) => ({
      ...player,
      slot: slots.get(player.providerPlayerKey) ?? player.slot,
    })),
  };
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

type FakeRequestFailure = "unavailable" | "invalid_response";
