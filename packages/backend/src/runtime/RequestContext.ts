import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { Context, Crypto, Effect, Layer, Schema } from "effect";
import { dual } from "effect/Function";

export class RequestContext extends Context.Service<RequestContext, RequestContextShape>()(
  "@lineupkeep/backend/runtime/RequestContext",
) {}

export function makeRequestContext(request: Request): Effect.Effect<RequestContextShape> {
  return Schema.decodeUnknownEffect(RequestId)(request.headers.get("x-request-id")).pipe(
    Effect.orDie,
    Effect.map((requestId) => ({ request, requestId })),
  );
}

export function correlateRequestEffect(request: Request): Effect.Effect<
  {
    request: Request;
    requestId: string;
  },
  Effect.Error<Crypto.Crypto["randomULID"]>,
  never
> {
  const upstream = request.headers.get("x-request-id");
  if (upstream !== null && isValidRequestId(upstream)) {
    return Effect.succeed({ request, requestId: upstream });
  }
  return Crypto.Crypto.use((crypto) => crypto.randomULID).pipe(
    Effect.map((requestId) => ({
      request: withRequestHeaders(request, { "x-request-id": requestId }),
      requestId,
    })),
    Effect.provide(NodeCrypto.layer),
  );
}

export function requestContextLayer(context: RequestContextShape): Layer.Layer<RequestContext> {
  return Layer.succeed(RequestContext)(context);
}

export const withRequestHeaders: {
  (additions: Readonly<Record<string, string>>): (request: RequestParts) => Request;
  (request: RequestParts, additions: Readonly<Record<string, string>>): Request;
} = dual(2, (request: RequestParts, additions: Readonly<Record<string, string>>): Request => {
  const headers = new Headers(request.headers);
  for (const [name, value] of Object.entries(additions)) {
    headers.set(name, value);
  }

  const init: RequestInit & { readonly duplex: "half" } = {
    method: request.method,
    headers,
    body: request.body,
    signal: request.signal,
    duplex: "half",
  };
  return new Request(request.url, init);
});

function isValidRequestId(value: string): boolean {
  return Schema.is(RequestId)(value);
}

const RequestId = Schema.Trim.pipe(
  Schema.check(Schema.isPattern(/^[A-Za-z0-9._:-]{1,128}$/u)),
  Schema.brand("RequestId"),
);

export type RequestParts = Pick<Request, "url" | "method" | "headers" | "body" | "signal">;

export type RequestContextShape = {
  readonly request: Request;

  readonly requestId: string;
};
