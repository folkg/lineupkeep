import { isPublicRoutableHost } from "@better-auth/core/utils/host";
import { Context, Effect, Layer, Schema } from "effect";
import type { Scope } from "effect";

import { withRequestHeaders } from "./RequestContext.ts";

export class PublicInternet extends Context.Service<
  PublicInternet,
  {
    readonly request: (
      request: Request,
      options?: PublicInternetOptions,
    ) => Effect.Effect<Response, PublicInternetUnavailable, Scope.Scope>;
  }
>()("@lineupkeep/backend/runtime/PublicInternet") {
  static fromTransport(transport: PublicTransport): Layer.Layer<PublicInternet> {
    return Layer.succeed(PublicInternet)({
      request: Effect.fn("PublicInternet.request", { kind: "client" })(function* (
        request: Request,
        options: PublicInternetOptions = {},
      ) {
        const limits = yield* decodeLimits(options);
        const abort = yield* scopedAbort(limits.timeout);
        const url = new URL(request.url);

        yield* Effect.annotateCurrentSpan({
          "http.request.method": request.method,
          "server.address": url.hostname,
        });
        const response = yield* send(transport, request, url, abort, limits.maximum);
        yield* Effect.annotateCurrentSpan("http.response.status_code", response.status);
        yield* rejectRedirect(response, abort);
        return response;
      }),
    });
  }
}

export class PublicInternetUnavailable extends Schema.TaggedError<
  PublicInternetUnavailable,
  { readonly brand: unique symbol }
>()("PublicInternetUnavailable", {
  reason: Schema.optional(Schema.Literal("blocked_redirect")),
}) {}

class PublicInternetBodyUnavailable extends Schema.TaggedError<
  PublicInternetBodyUnavailable,
  { readonly brand: unique symbol }
>()("PublicInternetBodyUnavailable", {
  reason: Schema.Literals(["scope_closed", "already_read"]),
}) {
  override get message(): string {
    return this.reason === "scope_closed"
      ? "the response body was read after its request scope closed"
      : "the response body was already read";
  }
}

function decodeLimits(options: PublicInternetOptions): Effect.Effect<
  {
    timeout: number;
    maximum: number;
  },
  PublicInternetUnavailable,
  never
> {
  return Effect.gen(function* () {
    const timeout = yield* Schema.decodeEffect(Timeout)(options.timeoutMs ?? 15_000);
    const maximum = yield* Schema.decodeEffect(ResponseSize)(options.maxResponseBytes ?? 1_048_576);
    return { timeout, maximum };
  }).pipe(Effect.mapError(() => PublicInternetUnavailable.make()));
}

function scopedAbort(timeout: number): Effect.Effect<AbortController, never, Scope.Scope> {
  return Effect.gen(function* () {
    const abort = yield* Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (controller) => Effect.sync(() => controller.abort(scopeClosed)),
    );
    yield* Effect.sleep(timeout).pipe(
      Effect.andThen(Effect.sync(() => abort.abort(PublicInternetUnavailable.make()))),
      Effect.forkScoped,
    );
    return abort;
  });
}

function send(
  transport: PublicTransport,
  request: Request,
  url: URL,
  abort: AbortController,
  maximum: number,
): Effect.Effect<Response, PublicInternetUnavailable, never> {
  return Effect.tryPromise({
    try: (signal) => {
      requirePublicHttps(url);
      const cancellation = AbortSignal.any([signal, request.signal, abort.signal]);
      cancellation.throwIfAborted();
      return abortable(
        transport(cancellableUpload(request, cancellation), {
          redirect: "manual",
          signal: cancellation,
        }),
        cancellation,
      ).then((response) => limitedResponse(response, maximum, cancellation));
    },
    catch: () => PublicInternetUnavailable.make(),
  }).pipe(Effect.onError(() => Effect.sync(() => abort.abort(PublicInternetUnavailable.make()))));
}

function requirePublicHttps(url: URL): void {
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    !isPublicRoutableHost(url.hostname)
  ) {
    throw new Error("Public HTTPS destination required");
  }
}

function rejectRedirect(
  response: Response,
  abort: AbortController,
): Effect.Effect<undefined, PublicInternetUnavailable, never> {
  return Effect.gen(function* () {
    if (response.status >= 300 && response.status < 400 && response.status !== 304) {
      yield* Effect.tryPromise({
        try: () => response.body?.cancel() ?? Promise.resolve(),
        catch: () => PublicInternetUnavailable.make(),
      }).pipe(Effect.ensuring(Effect.sync(() => abort.abort(PublicInternetUnavailable.make()))));
      return yield* PublicInternetUnavailable.make({ reason: "blocked_redirect" });
    }
  });
}

function cancellableUpload(request: Request, signal: AbortSignal): Request {
  if (request.body === null) {
    return request;
  }

  return withRequestHeaders(
    {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.body.pipeThrough(
        new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>(),
        { signal },
      ),
      signal,
    },
    {},
  );
}

function limitedResponse(response: Response, maximum: number, signal: AbortSignal): Response {
  if (response.body === null) {
    return response;
  }
  let received = 0;
  const body = response.body.pipeThrough(
    new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > maximum) {
          throw PublicInternetUnavailable.make();
        }
        controller.enqueue(chunk);
      },
    }),
    { signal },
  );
  return readableResponse(
    new Response(publicBody(body, signal), {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    }),
    signal,
  );
}

function readableResponse(response: Response, signal: AbortSignal): Response {
  const read = {
    arrayBuffer: response.arrayBuffer.bind(response),
    blob: response.blob.bind(response),
    bytes: response.bytes.bind(response),
    formData: response.formData.bind(response),
    json: response.json.bind(response),
    text: response.text.bind(response),
  };
  const guard =
    <A>(consume: () => Promise<A>): (() => Promise<A>) =>
    () => {
      const failure = unreadableBody(response, signal);
      return failure === undefined ? consume() : Promise.reject(failure);
    };
  return Object.assign(response, {
    arrayBuffer: guard(read.arrayBuffer),
    blob: guard(read.blob),
    bytes: guard(read.bytes),
    formData: guard(read.formData),
    json: guard(read.json),
    text: guard(read.text),
  });
}

function unreadableBody(
  response: Response,
  signal: AbortSignal,
): PublicInternetBodyUnavailable | undefined {
  return (
    scopeClosedFailure(signal) ??
    (response.bodyUsed ? PublicInternetBodyUnavailable.make({ reason: "already_read" }) : undefined)
  );
}

function bodyFailure(
  signal: AbortSignal,
): PublicInternetUnavailable | PublicInternetBodyUnavailable {
  return scopeClosedFailure(signal) ?? PublicInternetUnavailable.make();
}

function scopeClosedFailure(signal: AbortSignal): PublicInternetBodyUnavailable | undefined {
  if (signal.reason === scopeClosed) {
    return PublicInternetBodyUnavailable.make({ reason: "scope_closed" });
  }
}

function publicBody(
  body: ReadableStream<Uint8Array<ArrayBuffer>>,
  signal: AbortSignal,
): ReadableStream<Uint8Array<ArrayBuffer>> {
  const reader = body.getReader();
  return new ReadableStream({
    start(controller) {
      const onAbort = (): void => controller.error(bodyFailure(signal));
      const cleanup = (): void => signal.removeEventListener("abort", onAbort);
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
      }
      void reader.closed.then(cleanup, () => {
        cleanup();
        controller.error(bodyFailure(signal));
      });
    },
    pull(controller) {
      return reader.read().then(
        ({ done, value }) => {
          if (done === true) {
            controller.close();
          } else {
            controller.enqueue(value);
          }
        },
        () => controller.error(bodyFailure(signal)),
      );
    },
    cancel() {
      return reader.cancel().catch(() => {
        throw PublicInternetUnavailable.make();
      });
    },
  });
}

function abortable(pending: Promise<Response>, signal: AbortSignal): Promise<Response> {
  const result = Promise.withResolvers<Response>();
  const onAbort = (): void => result.reject(PublicInternetUnavailable.make());
  signal.addEventListener("abort", onAbort, { once: true });
  if (signal.aborted) {
    onAbort();
  }
  void pending.then(result.resolve, result.reject);
  return result.promise.finally(() => signal.removeEventListener("abort", onAbort));
}

const Timeout = Schema.Finite.check(Schema.isGreaterThan(0));
const ResponseSize = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));
const scopeClosed = Symbol("PublicInternet.scopeClosed");

export type PublicInternetOptions = {
  readonly timeoutMs?: number;

  readonly maxResponseBytes?: number;
};

type PublicTransport = (
  request: Request,
  init: { readonly redirect: "manual"; readonly signal: AbortSignal },
) => Promise<Response>;
