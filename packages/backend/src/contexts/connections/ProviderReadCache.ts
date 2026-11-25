import { Context, Effect, Schema } from "effect";

import type {
  Provider,
  ProviderAvailableDraftPick,
  ProviderDraftPick,
  ProviderLeagueGame,
  ProviderLeagueRoster,
  ProviderLeagueSettings,
  ProviderLeagueTeam,
  ProviderMatchup,
  ProviderPendingTrade,
  ProviderPlayerDetail,
  ProviderPlayerGameLog,
  ProviderPlayerPeriod,
  ProviderPlayerSearchResult,
  ProviderPlayerWeekFact,
  ProviderPlayerWeekOpponent,
  ProviderReadFailure,
  ProviderRoster,
  ProviderRosterSchedule,
  ProviderStandings,
  ProviderTransaction,
} from "./Provider.ts";

export class ProviderReadCache extends Context.Service<ProviderReadCache, ProviderReadCacheShape>()(
  "@lineupkeep/backend/contexts/connections/ProviderReadCache",
) {}

export type ProviderReadCacheShape = {
  readonly wrap: (provider: Provider, scope: string) => Provider;
};

export function makeProviderReadCache(): ProviderReadCacheShape {
  const leagues = new Map<string, CacheEntry<ProviderLeagueSettings>>();
  const rosters = new Map<string, CacheEntry<ProviderRoster>>();
  const leagueRosters = new Map<string, CacheEntry<ReadonlyArray<ProviderLeagueRoster>>>();
  const rosterSchedules = new Map<string, CacheEntry<ProviderRosterSchedule>>();
  const leagueGames = new Map<string, CacheEntry<ReadonlyArray<ProviderLeagueGame>>>();
  const playerDetails = new Map<string, CacheEntry<ReadonlyArray<ProviderPlayerDetail>>>();
  const playerWeeks = new Map<string, CacheEntry<ReadonlyArray<ProviderPlayerWeekFact>>>();
  const playerWeekOpponents = new Map<
    string,
    CacheEntry<ReadonlyArray<ProviderPlayerWeekOpponent>>
  >();
  const playerHistory = new Map<string, CacheEntry<ReadonlyArray<ProviderPlayerPeriod>>>();
  const playerGameLogs = new Map<string, CacheEntry<ProviderPlayerGameLog>>();
  const searches = new Map<string, CacheEntry<ProviderPlayerSearchResult>>();
  const matchups = new Map<string, CacheEntry<ReadonlyArray<ProviderMatchup>>>();
  const transactions = new Map<string, CacheEntry<ReadonlyArray<ProviderTransaction>>>();
  const completedTrades = new Map<string, CacheEntry<ReadonlyArray<ProviderTransaction>>>();
  const pendingTrades = new Map<string, CacheEntry<ReadonlyArray<ProviderPendingTrade>>>();
  const draftResults = new Map<string, CacheEntry<ReadonlyArray<ProviderDraftPick>>>();
  const availableDraftPicks = new Map<
    string,
    CacheEntry<ReadonlyArray<ProviderAvailableDraftPick>>
  >();
  const standings = new Map<string, CacheEntry<ProviderStandings>>();
  const leagueTeams = new Map<string, CacheEntry<ReadonlyArray<ProviderLeagueTeam>>>();

  return {
    wrap: (provider, scope) => {
      const key = (input: { readonly session?: unknown }): Effect.Effect<string> =>
        readKey(scope, input);
      const readLeagueGames = provider.readLeagueGames;
      const readPlayerGameLog = provider.readPlayerGameLog;
      return {
        ...provider,
        readLeague: (input) => cached(leagues, key(input), provider.readLeague(input)),
        readRoster: (input) => cached(rosters, key(input), provider.readRoster(input)),
        readLeagueRosters: (input) =>
          cached(leagueRosters, key(input), provider.readLeagueRosters(input)),
        readRosterSchedule: (input) =>
          cached(rosterSchedules, key(input), provider.readRosterSchedule(input)),
        ...(readLeagueGames === undefined
          ? {}
          : {
              readLeagueGames: (input) => cached(leagueGames, key(input), readLeagueGames(input)),
            }),
        readPlayerDetails: (input) =>
          cached(playerDetails, key(input), provider.readPlayerDetails(input)),
        readPlayerWeeks: (input) =>
          cached(playerWeeks, key(input), provider.readPlayerWeeks(input)),
        readPlayerWeekOpponents: (input) =>
          cached(playerWeekOpponents, key(input), provider.readPlayerWeekOpponents(input)),
        readPlayerHistory: (input) =>
          cached(playerHistory, key(input), provider.readPlayerHistory(input)),
        ...(readPlayerGameLog === undefined
          ? {}
          : {
              readPlayerGameLog: (input) =>
                cached(playerGameLogs, key(input), readPlayerGameLog(input)),
            }),
        searchPlayers: (input) => cached(searches, key(input), provider.searchPlayers(input)),
        readMatchups: (input) => cached(matchups, key(input), provider.readMatchups(input)),
        readTransactions: (input) =>
          cached(transactions, key(input), provider.readTransactions(input)),
        readCompletedTrades: (input) =>
          cached(completedTrades, key(input), provider.readCompletedTrades(input)),
        readPendingTrades: (input) =>
          cached(pendingTrades, key(input), provider.readPendingTrades(input)),
        readDraftResults: (input) =>
          cached(draftResults, key(input), provider.readDraftResults(input)),
        readAvailableDraftPicks: (input) =>
          cached(availableDraftPicks, key(input), provider.readAvailableDraftPicks(input)),
        readStandings: (input) => cached(standings, key(input), provider.readStandings(input)),
        readLeagueTeams: (input) =>
          cached(leagueTeams, key(input), provider.readLeagueTeams(input)),
      };
    },
  };
}

const json = Schema.fromJsonString(Schema.Unknown);

function readKey(scope: string, input: { readonly session?: unknown }): Effect.Effect<string> {
  const { session: _session, ...rest } = input;
  void _session;
  return Schema.encodeEffect(json)(rest).pipe(
    Effect.orDie,
    Effect.map((encoded) => `${scope}:${encoded}`),
  );
}

function cached<A>(
  entries: Map<string, CacheEntry<A>>,
  key: Effect.Effect<string>,
  read: Effect.Effect<A, ProviderReadFailure>,
): Effect.Effect<A, ProviderReadFailure> {
  return Effect.gen(function* () {
    const cacheKey = yield* key;
    const existing = entries.get(cacheKey);
    if (existing !== undefined) {
      return existing._tag === "ok" ? existing.value : yield* existing.error;
    }
    return yield* read.pipe(
      Effect.tap((value) =>
        Effect.sync(() => {
          entries.set(cacheKey, { _tag: "ok", value });
        }),
      ),
      Effect.tapError((error) =>
        Effect.sync(() => {
          entries.set(cacheKey, { _tag: "error", error });
        }),
      ),
    );
  });
}

type CacheEntry<A> =
  | { readonly _tag: "ok"; readonly value: A }
  | { readonly _tag: "error"; readonly error: ProviderReadFailure };
