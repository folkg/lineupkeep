import { Context, Layer } from "effect";

export class BackgroundWork extends Context.Service<BackgroundWork, BackgroundWorkShape>()(
  "@sourdough/backend/runtime/BackgroundWork",
) {
  static readonly processLifetime = Layer.succeed(BackgroundWork)({
    extend: () => undefined,
  });

  static fromWaitUntil(
    waitUntil: (promise: Promise<unknown>) => void,
  ): Layer.Layer<BackgroundWork> {
    return Layer.succeed(BackgroundWork)({ extend: (promise) => waitUntil(promise) });
  }
}

export type BackgroundWorkShape = {
  readonly extend: (promise: Promise<unknown>) => void;
};
