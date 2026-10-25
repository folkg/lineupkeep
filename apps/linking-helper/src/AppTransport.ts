import { Context, Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

export class AppTransport extends Context.Service<AppTransport, AppTransportShape>()(
  "@lineupkeep/linking-helper/AppTransport",
) {}

export type AppResponse = {
  readonly status: number;
  readonly body: string;
};

export type AppTransportShape = {
  readonly send: (request: Request) => Effect.Effect<AppResponse, TransportFailure>;
};

export class TransportFailure extends Schema.TaggedError<
  TransportFailure,
  { readonly brand: unique symbol }
>()("linking_helper.transport_failed", {}) {}

export const AppTransportLive = Layer.effect(
  AppTransport,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const send = Effect.fn("AppTransport.send")(function* (request: Request) {
      const response = yield* client
        .execute(HttpClientRequest.fromWeb(request))
        .pipe(Effect.mapError(() => TransportFailure.make({})));
      const body = yield* response.text.pipe(Effect.mapError(() => TransportFailure.make({})));
      return { status: response.status, body };
    });

    return AppTransport.of({ send });
  }),
).pipe(Layer.provide(FetchHttpClient.layer));
