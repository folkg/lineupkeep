import { getRequestEvent, configureServerErrors } from "@solidjs/web";
import { RequestContext } from "@sourdough/backend/runtime/RequestContext";
import { Effect, Schema, Clock, Ref } from "effect";
import { OBSERVE } from "solid-js";

import type {
  TelemetryAccepted,
  TelemetryReportData,
} from "#contracts/telemetry/telemetryContract.ts";
import { deploymentTarget } from "#deployment-target";
import { runBackend } from "#server/backendEntry.ts";
export function handleTelemetryRequest(request: Request): Promise<Response> {
  return request
    .json()
    .then(
      (input: unknown) => input,

      () => undefined,
    )
    .then((input) =>
      runBackend(request, "telemetry.client_report", recordClientReport(input, clientReportBudget)),
    )
    .then((accepted) => Response.json(accepted, { status: 202 }), returnExpectedHttpOutcome);
}

function reportServerError(request: Request, site: ServerErrorSite): void {
  deploymentTarget.backend.runBackground(
    recordServerFailure(site, serverErrorBudget),
    request,
    "telemetry.server_error",
  );
}

function reportSlowBoundary(request: Request, boundary: SlowBoundary): void {
  deploymentTarget.backend.runBackground(
    recordSlowBoundary(boundary),
    request,
    "telemetry.slow_boundary",
  );
}

export function recordClientReport(
  input: unknown,
  budget: ReportBudget,
): Effect.Effect<TelemetryAccepted, never, RequestContext> {
  return Effect.gen(function* () {
    const { requestId } = yield* RequestContext;
    const report = yield* Schema.decodeUnknownEffect(TelemetryReportSchema)(input).pipe(
      Effect.mapError((cause) => TelemetryInputInvalid.make({ cause })),
      Effect.catchTag("TelemetryInputInvalid", () =>
        Effect.annotateCurrentSpan({
          "app.outcome": "rejected",
          "error.type": "telemetry.input_invalid",
        }).pipe(
          Effect.andThen(Effect.die(new Response("Invalid telemetry report", { status: 400 }))),
        ),
      ),
    );
    const allowed = yield* budget.check;
    if (!allowed) {
      yield* Effect.annotateCurrentSpan({
        "app.outcome": "dropped",
        "telemetry.report": "dropped",
      });
      return { ref: requestId };
    }
    yield* Effect.annotateCurrentSpan(reportAttributes(report));
    yield* Effect.logError("Telemetry client report received");
    return { ref: requestId };
  });
}

export function recordServerFailure(
  site: ServerErrorSite,
  budget: ReportBudget,
): Effect.Effect<TelemetryAccepted, never, RequestContext> {
  return Effect.gen(function* () {
    const { requestId } = yield* RequestContext;
    const allowed = yield* budget.check;
    if (!allowed) {
      yield* Effect.annotateCurrentSpan({
        "app.outcome": "dropped",
        "telemetry.report": "dropped",
      });
      return { ref: requestId };
    }
    yield* Effect.annotateCurrentSpan({
      "app.outcome": "failure",
      "error.type": site.kind === "render" ? "ui.server_render" : "ui.server_function",
      "ui.site": `${site.kind}/${site.handling}`,
      ...(site.ownerPath === undefined ? {} : { "ui.thrown_in": site.ownerPath }),
      ...(site.boundaryPath === undefined ? {} : { "ui.caught_by": site.boundaryPath }),
      ...(site.functionId === undefined ? {} : { "ui.function_id": site.functionId }),
      ...(site.status === undefined ? {} : { "http.response.status_code": site.status }),
    });
    yield* Effect.logError("Telemetry server error recorded");
    return { ref: requestId };
  });
}

export function recordSlowBoundary(
  boundary: SlowBoundary,
): Effect.Effect<TelemetryAccepted, never, RequestContext> {
  return Effect.gen(function* () {
    const { requestId } = yield* RequestContext;
    yield* Effect.annotateCurrentSpan({
      "app.outcome": "success",
      "ui.wait_ms": Math.round(boundary.durationMs),
      "ui.boundary_outcome": boundary.outcome,
      "ui.render_passes": boundary.passes,
      ...(boundary.ownerPath === undefined ? {} : { "ui.thrown_in": boundary.ownerPath }),
    });
    return { ref: requestId };
  });
}

function reportAttributes(report: TelemetryReportData): Record<string, string | number> {
  switch (report.kind) {
    case "client_error":
      return {
        "app.outcome": "failure",
        "error.type": "ui.boundary_caught",
        ...(report.clientTraceId !== undefined && /^[0-9a-f]{32}$/u.test(report.clientTraceId)
          ? { "client.trace_id": report.clientTraceId }
          : {}),
      };
    case "slow_interaction":
      return {
        "app.outcome": "failure",
        "error.type": "ui.slow_interaction",
        "ui.settled_ms": Math.round(report.settledMs),
        "ui.hold_count": report.holds.length,
        "ui.hold_ms": Math.round(report.holds.reduce((total, hold) => total + hold.holdMs, 0)),
      };
    case "slow_call":
      return {
        "app.outcome": "failure",
        "error.type": "ui.slow_call",
        "ui.wait_ms": Math.round(report.durationMs),
        "http.request.method": report.method,
        ...(report.status === undefined ? {} : { "http.response.status_code": report.status }),
      };
  }
}

const BoundedString = (maxLength: number): Schema.String =>
  Schema.String.pipe(Schema.check(Schema.isMaxLength(maxLength)));

const TelemetryReportSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("client_error"),
    message: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(500))),
    thrownIn: Schema.optional(BoundedString(300)),
    caughtBy: Schema.optional(BoundedString(300)),
    pathname: Schema.String.pipe(Schema.check(Schema.isMaxLength(200))),
    clientTraceId: Schema.optional(BoundedString(64)),
  }),
  Schema.Struct({
    kind: Schema.Literal("slow_interaction"),
    name: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(100))),
    target: Schema.optional(BoundedString(100)),
    settledMs: Schema.Finite,
    holds: Schema.Array(
      Schema.Struct({
        blockers: BoundedString(300),
        holdMs: Schema.Finite,
        acknowledged: Schema.Boolean,
      }),
    ),
  }),
  Schema.Struct({
    kind: Schema.Literal("slow_call"),
    id: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(200))),
    durationMs: Schema.Finite,
    method: Schema.Literals(["GET", "POST"]),
    outcome: Schema.Literals(["ok", "error"]),
    status: Schema.optional(Schema.Finite.pipe(Schema.check(Schema.isInt()))),
  }),
]);

class TelemetryInputInvalid extends Schema.TaggedError<
  TelemetryInputInvalid,
  { readonly brand: unique symbol }
>()("TelemetryInputInvalid", { cause: Schema.Defect() }) {}

const { clientReportBudget, serverErrorBudget } = Effect.runSync(
  Effect.all({
    clientReportBudget: makeReportBudget({ limit: 100, windowMs: 60_000 }),
    serverErrorBudget: makeReportBudget({ limit: 200, windowMs: 60_000 }),
  }),
);

export function isExpectedHttpOutcome(error: unknown): boolean {
  return error instanceof Response && error.status < 500;
}

function returnExpectedHttpOutcome(error: unknown): Response {
  if (error instanceof Response && isExpectedHttpOutcome(error)) {
    return error;
  }
  throw error;
}

export function installServerTelemetry(): void {
  configureServerErrors({
    onError: (error, context) => {
      if (isExpectedHttpOutcome(error)) {
        return undefined;
      }
      const request = context.event?.request ?? getRequestEvent()?.request;
      if (request === undefined) {
        return undefined;
      }
      const ref = request.headers.get("x-request-id") ?? "unknown";
      reportServerError(request, {
        kind: context.kind,
        handling: context.handling,
        ownerPath: context.ownerPath?.join(" › "),
        boundaryPath: context.boundaryPath?.join(" › "),
        functionId: context.functionId,
        status: error instanceof Response ? error.status : undefined,
      });
      return new Error(`Something went wrong (ref ${ref})`);
    },
  });
  OBSERVE?.records.subscribe("boundary", (event) => {
    if (event.durationMs < 200) {
      return;
    }
    const request = getRequestEvent()?.request;
    if (request === undefined) {
      return;
    }
    reportSlowBoundary(request, {
      ownerPath: event.ownerPath?.join(" › "),
      durationMs: event.durationMs,
      outcome: event.outcome,
      passes: event.passes,
    });
  });
}

export function makeReportBudget(options: ReportBudgetOptions): Effect.Effect<ReportBudget> {
  return Ref.make({ count: 0, windowStart: 0 }).pipe(
    Effect.map((state) => ({
      check: Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const current = yield* Ref.get(state);
        if (now - current.windowStart >= options.windowMs) {
          yield* Ref.set(state, { count: 1, windowStart: now });
          return true;
        }
        if (current.count >= options.limit) {
          return false;
        }
        yield* Ref.set(state, { count: current.count + 1, windowStart: current.windowStart });
        return true;
      }),
    })),
  );
}

type ServerErrorSite = {
  readonly kind: "render" | "server-function";
  readonly handling: string;
  readonly ownerPath?: string;
  readonly boundaryPath?: string;
  readonly functionId?: string;
  readonly status?: number;
};

type SlowBoundary = {
  readonly ownerPath?: string;
  readonly durationMs: number;
  readonly outcome: string;
  readonly passes: number;
};

type ReportBudget = {
  readonly check: Effect.Effect<boolean>;
};

type ReportBudgetOptions = {
  readonly limit: number;
  readonly windowMs: number;
};
