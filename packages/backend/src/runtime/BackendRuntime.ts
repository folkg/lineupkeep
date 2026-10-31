import { Effect, Layer, ManagedRuntime, Option, Tracer } from "effect";
import { Headers, HttpTraceContext } from "effect/http";
import * as OtlpExporter from "effect/observability/OtlpExporter";

import { ApplicationLayer } from "./ApplicationLayer.ts";
import type { BackendServices } from "./ApplicationLayer.ts";
import type { BackendPlatform } from "./BackendPlatform.ts";
import { BackgroundWork } from "./BackgroundWork.ts";
import {
  correlateRequestEffect,
  makeRequestContext,
  requestContextLayer,
  withRequestHeaders,
} from "./RequestContext.ts";
import type { RequestContext } from "./RequestContext.ts";

export type { BackendServices } from "./ApplicationLayer.ts";
type RuntimeServices<Services> = Services | RequestContext;
type PlatformServices = BackgroundWork | OtlpExporter.Flusher;

export class BackendRuntime<Services = BackendServices> {
  static make(platform: BackendPlatform): BackendRuntime<BackendServices> {
    const processLayer = Layer.mergeAll(platform.observability, platform.background);
    const applicationLayer = ApplicationLayer.pipe(
      Layer.provide(platform.database),
      Layer.provide(platform.publicInternet),
    );

    if (platform.databaseLifetime === "process") {
      const runtime = ManagedRuntime.make(Layer.provideMerge(applicationLayer, processLayer));
      return new BackendRuntime({
        run: (effect) => runtime.runPromise(effect),
        runPlatform: (effect) => runtime.runPromise(effect),
        dispose: () => runtime.dispose(),
        afterResponse: platform.afterResponse,
      });
    }

    const runtime = ManagedRuntime.make(processLayer);
    return new BackendRuntime({
      run: (effect) =>
        runtime.runPromise(Effect.provide(effect, applicationLayer, { local: true })),
      runPlatform: (effect) => runtime.runPromise(effect),
      dispose: () => runtime.dispose(),
      afterResponse: platform.afterResponse,
    });
  }

  static makeTest(options: TestRuntimeOptions = {}): BackendRuntime<never> {
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(
        OtlpExporter.layerFlusher,
        options.waitUntil === undefined
          ? BackgroundWork.processLifetime
          : BackgroundWork.fromWaitUntil(options.waitUntil),
      ),
    );
    return new BackendRuntime({
      run: (effect) => runtime.runPromise(effect),
      runPlatform: (effect) => runtime.runPromise(effect),
      dispose: () => runtime.dispose(),
      afterResponse: options.afterResponse ?? Effect.void,
    });
  }

  private readonly pending = new Set<Promise<unknown>>();

  private constructor(private readonly execution: Execution<Services>) {}

  runHttpHandler(
    request: Request,
    handler: (request: Request) => Promise<Response>,
  ): Promise<Response> {
    const pathname = new URL(request.url).pathname;

    const { runPlatform, afterResponse } = this.execution;
    const track = <A>(work: Promise<A>): Promise<A> => this.track(work);

    const registerAfterResponse = Effect.flatMap(BackgroundWork, (background) =>
      Effect.suspend(() => {
        const work = track(runPlatform(afterResponse));
        background.extend(work);
        return Effect.promise(() => work);
      }),
    );

    return track(
      runPlatform(
        Effect.gen(function* () {
          const requestId = request.headers.get("x-request-id");
          if (requestId !== null) {
            yield* Effect.annotateCurrentSpan("request.id", requestId);
          }

          const span = yield* Effect.currentSpan;
          const traceHeaders = HttpTraceContext.toHeaders(span);
          const tracedRequest = withRequestHeaders(request, traceHeaders);
          const response = yield* Effect.promise(() => handler(tracedRequest));
          yield* Effect.annotateCurrentSpan("http.response.status_code", response.status);
          return response;
        }).pipe(
          Effect.withSpan("http.server.request", {
            attributes: {
              "http.request.method": request.method,
              "url.path": pathname,
            },
            kind: "server",
            parent: traceParent(request),
          }),
          Effect.ensuring(registerAfterResponse),
        ),
      ),
    );
  }

  run<A, E, R extends RuntimeServices<Services>>(
    program: Effect.Effect<A, E, R>,
    request: Request,
    operation: BackendOperation,
  ): Promise<A> {
    return this.execution.run(
      Effect.gen(function* () {
        const correlated = yield* correlateRequestEffect(request).pipe(Effect.orDie);
        const requestContext = yield* makeRequestContext(correlated.request);
        return yield* program.pipe(
          Effect.tap(() => annotateOperationSuccess),
          Effect.withSpan(operation, {
            attributes: {
              "app.operation": operation,
              "request.id": requestContext.requestId,
            },
            kind: "server",
            parent: traceParent(request),
          }),
          Effect.provide(requestContextLayer(requestContext)),
        );
      }),
    );
  }

  runBackground<E, R extends RuntimeServices<Services>>(
    program: Effect.Effect<unknown, E, R>,
    request: Request,
    operation: BackendOperation,
  ): void {
    void this.track(
      this.execution.runPlatform(
        Effect.flatMap(BackgroundWork, (background) =>
          Effect.sync(() => {
            const work = this.track(
              this.run(
                program.pipe(
                  Effect.catchCause(() =>
                    Effect.annotateCurrentSpan({
                      "app.outcome": "failure",
                      "error.type": "background.operation_failed",
                    }).pipe(Effect.andThen(Effect.logError("Background operation failed"))),
                  ),
                  Effect.asVoid,
                ),
                request,
                operation,
              ).then(() => this.execution.runPlatform(this.execution.afterResponse)),
            );
            background.extend(work);
          }),
        ),
      ),
    );
  }

  dispose(): Promise<void> {
    return this.settlePending().then(() => this.execution.dispose());
  }

  private settlePending(): Promise<void> {
    if (this.pending.size === 0) {
      return Promise.resolve();
    }
    return Promise.allSettled(this.pending).then(() => this.settlePending());
  }

  private track<A>(work: Promise<A>): Promise<A> {
    this.pending.add(work);
    const settle = (): boolean => this.pending.delete(work);
    work.then(settle, settle);
    return work;
  }
}

function traceParent(request: Request): Tracer.ExternalSpan | undefined {
  return (
    Option.getOrUndefined(HttpTraceContext.fromHeaders(Headers.fromInput(request.headers))) ??
    cloudRunTraceParent(request)
  );
}

function cloudRunTraceParent(request: Request): Tracer.ExternalSpan | undefined {
  const header = request.headers.get("x-cloud-trace-context");
  if (header === null) {
    return undefined;
  }
  const [ids, options] = header.trim().split(";", 2);
  const [traceId, spanId] = ids?.split("/") ?? [];
  if (traceId === undefined || spanId === undefined || !/^[0-9a-f]{32}$/iu.test(traceId.trim())) {
    return undefined;
  }
  const hexadecimalSpanId = decimalSpanId(spanId.trim());
  if (hexadecimalSpanId === undefined) {
    return undefined;
  }
  return Tracer.externalSpan({
    traceId: traceId.trim().toLowerCase(),
    spanId: hexadecimalSpanId,
    sampled: options?.includes("o=1") ?? true,
  });
}

function decimalSpanId(value: string): string | undefined {
  if (!/^[0-9]{1,20}$/u.test(value)) {
    return undefined;
  }
  const parsed = BigInt(value);
  return parsed > 0n && parsed <= 0xffffffffffffffffn
    ? parsed.toString(16).padStart(16, "0")
    : undefined;
}

const annotateOperationSuccess = Effect.flatMap(Effect.currentSpan, (span) =>
  span.attributes.has("app.outcome")
    ? Effect.void
    : Effect.annotateCurrentSpan("app.outcome", "success"),
);

type Execution<Services> = {
  readonly run: <A, E>(effect: Effect.Effect<A, E, Services | PlatformServices>) => Promise<A>;
  readonly runPlatform: <A, E>(effect: Effect.Effect<A, E, PlatformServices>) => Promise<A>;
  readonly dispose: () => Promise<void>;
  readonly afterResponse: Effect.Effect<void, never, PlatformServices>;
};

type TestRuntimeOptions = {
  readonly afterResponse?: Effect.Effect<void, never, PlatformServices>;
  readonly waitUntil?: (promise: Promise<unknown>) => void;
};

export type BackendOperation = `${string}.${string}`;
