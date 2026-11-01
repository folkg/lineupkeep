import { Context, DateTime, Effect, Layer, Ref } from "effect";

import type { GameSourceGame, GameSourceShape } from "#contexts/connections/GameSource.ts";
import {
  GameSourceRegistry,
  GameSourceRequestFailed,
  GameSourceResponseInvalid,
  gameSourceRegistryOf,
} from "#contexts/connections/GameSource.ts";

type FakeGameSourceFailure = "unavailable" | "invalid";

type FakeGameSourceState = {
  readonly games: ReadonlyArray<GameSourceGame>;
  readonly calls: ReadonlyArray<string>;
  readonly failure: FakeGameSourceFailure | undefined;
};

export class FakeGameSourceWorld extends Context.Service<
  FakeGameSourceWorld,
  FakeGameSourceWorldShape
>()("@lineupkeep/backend/contexts/connections/internal/FakeGameSourceTest/FakeGameSourceWorld") {}

export type FakeGameSourceWorldShape = {
  readonly state: Ref.Ref<FakeGameSourceState>;
  readonly setGames: (games: ReadonlyArray<GameSourceGame>) => Effect.Effect<void>;
  readonly setFailure: (failure: FakeGameSourceFailure | undefined) => Effect.Effect<void>;
  readonly calls: Effect.Effect<ReadonlyArray<string>>;
};

export function fakeGameSourceLayer(
  teamCount = 32,
): Layer.Layer<GameSourceRegistry | FakeGameSourceWorld> {
  const world = Layer.effect(FakeGameSourceWorld)(
    Effect.gen(function* () {
      const state = yield* Ref.make<FakeGameSourceState>({
        games: [],
        calls: [],
        failure: undefined,
      });
      return FakeGameSourceWorld.of({
        state,
        setGames: (games) => Ref.update(state, (current) => ({ ...current, games })),
        setFailure: (failure) => Ref.update(state, (current) => ({ ...current, failure })),
        calls: Effect.map(Ref.get(state), (current) => current.calls),
      });
    }),
  );
  const registry = Layer.effect(GameSourceRegistry)(
    Effect.gen(function* () {
      const fake = yield* FakeGameSourceWorld;
      const source: GameSourceShape = {
        key: "nhl-web",
        capabilities: {
          coverage: [{ league: "nhl", sport: "hockey", teamCount }],
          weekDays: 7,
          publishesStartTime: true,
          publishesVenueTimeZone: true,
          publishesStatus: true,
          maximumResponseBytes: 262_144,
        },
        readLeagueWeek: (input) =>
          Effect.gen(function* () {
            yield* Ref.update(fake.state, (current) => ({
              ...current,
              calls: [...current.calls, input.weekStart],
            }));
            const current = yield* Ref.get(fake.state);
            if (current.failure === "unavailable") {
              return yield* GameSourceRequestFailed.make({ source: source.key });
            }
            if (current.failure === "invalid") {
              return yield* GameSourceResponseInvalid.make({ source: source.key });
            }
            const weekEnd = addDays(input.weekStart, 6);
            return {
              league: input.league,
              weekStart: input.weekStart,
              weekEnd,
              games: current.games.filter(
                (game) => game.date >= input.weekStart && game.date <= weekEnd,
              ),
            };
          }),
      };
      return GameSourceRegistry.of(gameSourceRegistryOf([source]));
    }),
  );
  return Layer.provideMerge(registry, world);
}

export function fakeGame(input: {
  readonly id: string;
  readonly date: string;
  readonly startTime?: string;
  readonly home: {
    readonly identifier: string;
    readonly abbreviation: string;
    readonly name: string;
  };
  readonly away: {
    readonly identifier: string;
    readonly abbreviation: string;
    readonly name: string;
  };
}): GameSourceGame {
  return {
    id: input.id,
    date: input.date,
    startTime:
      input.startTime === undefined
        ? null
        : {
            instant: DateTime.makeUnsafe(input.startTime),
            timeZone: "UTC",
          },
    venue: null,
    status: "scheduled",
    home: input.home,
    away: input.away,
  };
}

function addDays(date: string, days: number): string {
  const parsed = DateTime.makeUnsafe(`${date}T00:00:00.000Z`);
  return DateTime.formatIsoDate(DateTime.add(parsed, { days }));
}
