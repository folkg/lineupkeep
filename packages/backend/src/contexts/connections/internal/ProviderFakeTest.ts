import { Context, Deferred, Effect, Layer, Option, Redacted, Ref, Schema } from "effect";

import {
  ProviderCrumbUnavailable,
  ProviderGateway,
  ProviderOperationUnsupported,
  ProviderPeriodMismatch,
  ProviderRequestFailed,
  ProviderResponseInvalid,
  ProviderReviewLinkInvalid,
  ProviderSessionMaterial,
  ProviderSessionRejected,
} from "#contexts/connections/Provider.ts";
import type {
  ProviderLeagueSettings,
  ProviderLeagueTeam,
  ProviderMatchup,
  ProviderNativeActionResult,
  ProviderNativeTarget,
  ProviderOperation,
  ProviderPlayerDetail,
  ProviderReviewLinkInput,
  ProviderRoster,
  ProviderRosterCoverage,
  ProviderStandings,
  ProviderTeam,
  ProviderTransaction,
} from "#contexts/connections/Provider.ts";

type FakeNativeAction = "accept" | "reject" | "lost_response" | "unavailable";

type FakeGate = {
  readonly started: Deferred.Deferred<void>;
  readonly release: Deferred.Deferred<void>;
};

type FakeProviderState = {
  readonly sessionRejected: boolean;
  readonly teams: ReadonlyArray<ProviderTeam>;
  readonly requestFailure: FakeRequestFailure | undefined;
  readonly crumbAvailable: boolean;
  readonly discoveryGate: Option.Option<FakeGate>;
  readonly rosterReadGate: Option.Option<FakeGate>;
  readonly league: ProviderLeagueSettings | undefined;
  readonly leagueFailure: ProviderResponseInvalid | undefined;
  readonly standings: ProviderStandings | undefined;
  readonly standingsFailure: ProviderResponseInvalid | undefined;
  readonly roster: ProviderRoster | undefined;
  readonly rosterPeriods: ReadonlyArray<ProviderRosterCoverage | undefined>;
  readonly playerDetails: ReadonlyArray<ProviderPlayerDetail>;
  readonly playerDetailsFailure: ProviderPeriodMismatch | undefined;
  readonly matchups: ReadonlyArray<ProviderMatchup>;
  readonly transactions: ReadonlyArray<ProviderTransaction>;
  readonly leagueTeams: ReadonlyArray<ProviderLeagueTeam>;
  readonly unsupported: ReadonlySet<ProviderOperation>;
  readonly reviewLinkFailure: ProviderReviewLinkInvalid | undefined;
  readonly reviewLinkUrl: string | undefined;
  readonly nativeAction: FakeNativeAction;
  readonly nativeAfter: ProviderRoster | undefined;
  readonly nativeTargets: ReadonlyArray<ProviderNativeTarget>;
  readonly nativeCalls: number;
};

export type FakeProviderWorldShape = {
  readonly state: Ref.Ref<FakeProviderState>;
  readonly rejectSession: (rejected: boolean) => Effect.Effect<void>;
  readonly setTeams: (teams: ReadonlyArray<ProviderTeam>) => Effect.Effect<void>;
  readonly failRequests: (failure: FakeRequestFailure | undefined) => Effect.Effect<void>;
  readonly setCrumbAvailable: (available: boolean) => Effect.Effect<void>;
  readonly blockDiscovery: Effect.Effect<FakeGate>;
  readonly unblockDiscovery: Effect.Effect<void>;
  readonly blockRosterRead: Effect.Effect<FakeGate>;
  readonly unblockRosterRead: Effect.Effect<void>;
  readonly setLeague: (league: ProviderLeagueSettings | undefined) => Effect.Effect<void>;
  readonly failLeague: (failure: ProviderResponseInvalid | undefined) => Effect.Effect<void>;
  readonly setStandings: (standings: ProviderStandings | undefined) => Effect.Effect<void>;
  readonly failStandings: (failure: ProviderResponseInvalid | undefined) => Effect.Effect<void>;
  readonly setRoster: (roster: ProviderRoster | undefined) => Effect.Effect<void>;
  readonly rosterPeriods: Effect.Effect<ReadonlyArray<ProviderRosterCoverage | undefined>>;
  readonly setPlayerDetails: (details: ReadonlyArray<ProviderPlayerDetail>) => Effect.Effect<void>;
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
  readonly setNativeAction: (action: FakeNativeAction) => Effect.Effect<void>;
  readonly setNativeAfter: (roster: ProviderRoster | undefined) => Effect.Effect<void>;
  readonly nativeTargets: Effect.Effect<ReadonlyArray<ProviderNativeTarget>>;
  readonly nativeCallCount: Effect.Effect<number>;
};

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
        crumbAvailable: true,
        discoveryGate: Option.none(),
        rosterReadGate: Option.none(),
        league: undefined,
        leagueFailure: undefined,
        standings: undefined,
        standingsFailure: undefined,
        roster: undefined,
        rosterPeriods: [],
        playerDetails: [],
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
        setCrumbAvailable: (crumbAvailable) =>
          modify((current) => ({ ...current, crumbAvailable })),
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
        rosterPeriods: Effect.map(Ref.get(state), (current) => current.rosterPeriods),
        setPlayerDetails: (playerDetails) => modify((current) => ({ ...current, playerDetails })),
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
      } satisfies FakeProviderWorldShape;
    }),
  );
}

export const ProviderFakeTest = Layer.effect(
  ProviderGateway,
  Effect.gen(function* () {
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

    return ProviderGateway.of({
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
      readCrumb: Effect.fn("FakeProvider.readCrumb")(function* (input) {
        yield* validate(input, "read_crumb");
        const current = yield* Ref.get(world.state);
        if (current.sessionRejected) {
          return yield* ProviderSessionRejected.make({ operation: "read_crumb" });
        }
        yield* requestFailure(current, "read_crumb");
        if (!current.crumbAvailable) {
          return yield* ProviderCrumbUnavailable.make({ operation: "read_crumb" });
        }
        return { crumb: Redacted.make("fake-provider-crumb") };
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
        return current.roster;
      }),
      applyNativeStartActive: Effect.fn("FakeProvider.applyNativeStartActive")(function* (input) {
        const current = yield* prepare(input, "apply_native_start_active").pipe(
          Effect.mapError((error) =>
            error._tag === "provider.session_rejected"
              ? error
              : ProviderResponseInvalid.make({ operation: "apply_native_start_active" }),
          ),
        );
        if (current.roster === undefined) {
          return yield* ProviderResponseInvalid.make({
            operation: "apply_native_start_active",
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
        const result: ProviderNativeActionResult = (() => {
          switch (current.nativeAction) {
            case "accept":
              return { status: "accepted" };
            case "lost_response":
              return { status: "unknown" };
            case "unavailable":
              return { status: "unknown" };
            case "reject":
              return { status: "rejected", reason: "invalid_request" };
          }
        })();
        if (current.nativeAction === "accept" || current.nativeAction === "lost_response") {
          const after = current.nativeAfter ?? current.roster;
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
      searchPlayers: Effect.fn("FakeProvider.searchPlayers")(function* (input) {
        const current = yield* prepare(input, "search_players");
        const query = input.query?.toLocaleLowerCase();
        const filtered = current.playerDetails.flatMap((player) => {
          if (
            player.rosterStatus === "unknown" ||
            player.name === undefined ||
            player.primaryPosition === undefined ||
            player.displayPosition === undefined ||
            player.eligiblePositions === undefined
          ) {
            return [];
          }
          if (input.availability !== "all" && player.rosterStatus !== input.availability) {
            return [];
          }
          if (
            query !== undefined &&
            query !== "" &&
            !player.name.toLocaleLowerCase().includes(query)
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
              percentStartedDelta: null,
            },
          ];
        });
        const sorted = [...filtered].sort((left, right) => {
          switch (input.sort) {
            case "name":
              return left.name.localeCompare(right.name);
            case "position":
              return left.primaryPosition.localeCompare(right.primaryPosition);
            case "ownership":
            case "actual_rank":
            case "overall_rank":
            case "stat":
              return 0;
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
        const page = input.intent.kind === "trade" ? "trade" : "add";
        const url = new URL(
          `https://review.example.test/league/${input.providerLeagueKey}/${page}`,
        );
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
            for (const key of input.intent.send) {
              append("apid", key);
            }
            for (const key of input.intent.receive) {
              append("dpid", key);
            }
            break;
        }
        return url.href;
      }),
    });
  }),
).pipe(Layer.provideMerge(FakeProviderWorld.layer));

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
