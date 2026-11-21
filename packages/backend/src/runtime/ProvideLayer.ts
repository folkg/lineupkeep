import { Context, Effect, Layer } from "effect";

const provideLayer = <A, E, R, LE, E2, RE>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<LE, E2, RE>,
): Effect.Effect<A, E | E2, Exclude<R, LE> | RE> =>
  Effect.scoped(
    Layer.build(layer).pipe(
      Effect.flatMap((context: Context.Context<LE>) => Effect.provideContext(effect, context)),
    ),
  );

const provide =
  <LE, E2, RE>(
    layer: Layer.Layer<LE, E2, RE>,
  ): (<A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E | E2, Exclude<R, LE> | RE>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E | E2, Exclude<R, LE> | RE> =>
    provideLayer(effect, layer);

export default { provideLayer, provide };
