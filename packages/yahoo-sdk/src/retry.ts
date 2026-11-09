import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Ref from "effect/Ref";
import * as Schedule from "effect/Schedule";

export type Policy =
  | Effect.Retry.Options<unknown>
  | ((lastError: Ref.Ref<unknown>) => Effect.Retry.Options<unknown>);

export class Retry extends Context.Service<Retry, Policy>()("YahooRetry") {}

export const policy = (
  value: Policy,
): (<A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, Exclude<R, Retry>>) =>
  Effect.provide(Layer.succeed(Retry)(value));

export const none = Effect.provide(Layer.succeed(Retry)({ while: () => false }));

export const makeDefault = (): Effect.Retry.Options<unknown> => ({
  while: isTransient,
  schedule: Schedule.exponential("100 millis").pipe(Schedule.jittered, Schedule.upTo({ times: 2 })),
});

export const transient = policy(makeDefault());

const transientTags: ReadonlySet<string> = new Set([
  "TooManyRequests",
  "InternalServerError",
  "BadGateway",
  "ServiceUnavailable",
  "GatewayTimeout",
  "HttpClientError",
]);

export function isTransient(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string" &&
    transientTags.has(error._tag)
  );
}
