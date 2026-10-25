import { configureClientErrors, OBSERVE } from "solid-js";
import { attribution } from "solid-js/attribution";

import type { TelemetryHold, TelemetryReportData } from "#contracts/telemetry/telemetryContract.ts";

export function installClientTelemetry(transport: TelemetryTransport): Disposable {
  const resources = new DisposableStack();
  try {
    resources.defer(() => configureClientErrors({}));
    const budget = createSendBudget(5, 60_000, () => Date.now());
    configureClientErrors({
      onError: (error, context) => {
        if (!budget.take()) {
          return;
        }
        const report = buildClientErrorReport(
          error,
          context,
          { pathname: location.pathname },
          readTraceId(),
        );
        transport.report(report);
      },
    });
    resources.defer(attribution.enable({ log: false, values: "none", checks: false }));
    const unsubscribeInteraction = OBSERVE?.records.subscribe("interaction", (event) => {
      const settledMs = event.settledMs;
      if (settledMs === undefined || settledMs < 300) {
        return;
      }
      if (!budget.take()) {
        return;
      }
      const report = buildSlowInteractionReport({
        name: event.name,
        target: event.target,
        settledMs,
        holds: event.holds,
      });
      transport.report(report);
    });
    if (unsubscribeInteraction !== undefined) {
      resources.defer(unsubscribeInteraction);
    }
    const unsubscribeCall = OBSERVE?.records.subscribe("call", (event) => {
      if (event.durationMs < 500) {
        return;
      }
      if (!budget.take()) {
        return;
      }
      transport.report({
        kind: "slow_call",
        id: event.id,
        durationMs: event.durationMs,
        method: event.method,
        outcome: event.outcome,
      });
    });
    if (unsubscribeCall !== undefined) {
      resources.defer(unsubscribeCall);
    }
    return resources.move();
  } finally {
    resources.dispose();
  }
}

export function buildClientErrorReport(
  _error: unknown,
  context: ErrorContext,
  location: { readonly pathname: string },
  traceId: string | undefined,
): TelemetryReportData {
  return {
    kind: "client_error",
    message: "ui.boundary_caught",
    thrownIn: joinPath(context.ownerPath).slice(0, 300),
    caughtBy: joinPath(context.boundaryPath).slice(0, 300),
    pathname: location.pathname.slice(0, 200),
    ...(traceId === undefined ? {} : { clientTraceId: traceId }),
  };
}

export function buildSlowInteractionReport(event: SlowInteraction): TelemetryReportData {
  return {
    kind: "slow_interaction",
    name: event.name.slice(0, 100),
    ...(event.target === undefined ? {} : { target: event.target.slice(0, 100) }),
    settledMs: event.settledMs,
    holds: event.holds.map(toTelemetryHold),
  };
}

export function createSendBudget(limit: number, windowMs: number, now: () => number): SendBudget {
  let count = 0;
  let windowStart = now();
  return {
    take: () => {
      const current = now();
      if (current - windowStart >= windowMs) {
        count = 1;
        windowStart = current;
        return true;
      }
      if (count >= limit) {
        return false;
      }
      count += 1;
      return true;
    },
  };
}

function readTraceId(): string | undefined {
  try {
    if (typeof document === "undefined") {
      return undefined;
    }
    const meta = document.querySelector('meta[name="traceparent"]');
    return parseTraceId(meta?.getAttribute("content") ?? undefined);
  } catch {
    return undefined;
  }
}

export function parseTraceId(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const segments = value.trim().split("-");
  if (segments.length < 4) {
    return undefined;
  }
  const [, traceId] = segments;
  if (traceId === undefined || !/^[0-9a-f]{32}$/.test(traceId)) {
    return undefined;
  }
  return traceId;
}

function toTelemetryHold(hold: SlowHold): TelemetryHold {
  return {
    blockers: hold.blockers.join(", ").slice(0, 300),
    holdMs: hold.holdMs,
    acknowledged: hold.acknowledgements.length > 0,
  };
}

function joinPath(path: ReadonlyArray<string> | undefined): string {
  return path?.join(" › ") ?? "unknown";
}

export type TelemetryTransport = {
  readonly report: (data: TelemetryReportData) => void;
};

export type SendBudget = {
  readonly take: () => boolean;
};

type ErrorContext = {
  readonly ownerPath?: ReadonlyArray<string>;
  readonly boundaryPath?: ReadonlyArray<string>;
};

type SlowInteraction = {
  readonly name: string;
  readonly target?: string;
  readonly settledMs: number;
  readonly holds: ReadonlyArray<SlowHold>;
};

type SlowHold = {
  readonly blockers: ReadonlyArray<string>;
  readonly holdMs: number;
  readonly acknowledgements: ReadonlyArray<unknown>;
};
