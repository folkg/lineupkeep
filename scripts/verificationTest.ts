import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { Schema } from "effect";
import { assert } from "vitest";

import type { DatabaseActivity, DatabaseProbe } from "#e2e/verify/databaseActivity.ts";
import type { Claims, Results } from "#e2e/verify/evidence.ts";
import type {
  EvidenceSink,
  InstrumentedPage,
  OverBudget,
  ProfilerSession,
  RouteLike,
} from "#e2e/verify/performance.ts";

export function requestSpan(parentSpanId: string): object {
  return {
    spanId: `server-${parentSpanId}`,
    parentSpanId,
    name: "http.server.request",
    startMs: 0,
    endMs: 5,
    durationMs: 5,
    attributes: {},
  };
}

export async function fakeCollector(
  respond: (tagged: ReadonlyArray<string>) => ReadonlyArray<object>,
): Promise<{
  tag: (traceparent: string) => number;
  [Symbol.asyncDispose]: () => Promise<void>;
}> {
  const tagged = new Map<string, string[]>();
  const server = createServer((request, response) => {
    const traceId = new URL(request.url ?? "/", "http://collector").searchParams.get("trace") ?? "";
    response
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(respond(tagged.get(traceId) ?? [])));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address !== null && typeof address === "object");
  const previous = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = `http://127.0.0.1:${address.port}`;
  return {
    tag: (traceparent: string) => {
      const traceId = traceparent.split("-")[1] ?? "";
      const spans = tagged.get(traceId) ?? [];
      tagged.set(traceId, spans);
      return spans.push(traceparent.split("-")[2] ?? "");
    },
    [Symbol.asyncDispose]: async () => {
      if (previous === undefined) {
        delete process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
      } else {
        process.env["OTEL_EXPORTER_OTLP_ENDPOINT"] = previous;
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export function scriptedSession(): ProfilerSession & { readonly calls: Array<string> } {
  const calls: Array<string> = [];
  return {
    calls,
    send: (method) => {
      calls.push(method);
      return Promise.resolve(
        method === "Profiler.stop" ? { profile: { nodes: [], samples: [], timeDeltas: [] } } : {},
      );
    },
    detach: () => {
      calls.push("detach");
      return Promise.resolve();
    },
  };
}

export function unexpectedBudgetFailure(over: OverBudget): void {
  throw new Error(`Unexpected budget failure: ${JSON.stringify(over)}`);
}

export function scriptedProbe(
  activity: DatabaseActivity = { statements: [], plans: [] },
): DatabaseProbe & { readonly closed: () => boolean } {
  let closed = false;
  return {
    observe: () =>
      Promise.resolve(() => {
        closed = true;
        return Promise.resolve(activity);
      }),
    closed: () => closed,
  };
}

export async function evidenceSink(): Promise<{
  sink: EvidenceSink;
  folder: string;
  attachments: () => {
    name: string;
    path: string;
  }[];
  results: () => Promise<
    {
      readonly [x: string]: unknown;
    }[]
  >;
  attachment: (name: string) => Promise<string>;
  [Symbol.asyncDispose]: () => Promise<void>;
}> {
  const folder = await mkdtemp(join(tmpdir(), "verification-performance-"));
  const attached: Array<string> = [];
  const byName = new Map<string, string>();
  const sink: EvidenceSink = {
    outputPath: (...segments: Array<string>) => join(folder, ...segments),
    attach: (name: string, options?: { readonly path?: string }) => {
      if (options?.path !== undefined) {
        byName.set(name, options.path);
        if (/^(measurement|profile): /u.test(name)) {
          attached.push(options.path);
        }
      }
      return Promise.resolve();
    },
    annotations: [],
  };
  return {
    sink,
    folder,
    attachments: () => [...byName].map(([name, path]) => ({ name, path: basename(path) })),
    results: () =>
      Promise.all(
        attached.map(async (path) =>
          Schema.decodeUnknownSync(Result)(await readFile(path, "utf8")),
        ),
      ),
    attachment: async (name: string) => {
      const path = byName.get(name);
      assert(path !== undefined, `no attachment named ${name}`);
      return readFile(path, "utf8");
    },
    [Symbol.asyncDispose]: () => rm(folder, { recursive: true }),
  };
}

export function scriptedPage(
  options: {
    readonly unrouteDelayMs?: number;
    readonly routeFails?: boolean;
    readonly unrouteFails?: boolean;

    readonly routeFailsAfterRegistering?: boolean;
  } = {},
): {
  route: (
    _url: (url: URL) => boolean,
    routeHandler: (route: RouteLike) => Promise<void>,
  ) => Promise<unknown>;
  unroute: () => Promise<void>;
  on: EventEmitter["on"];
  off: EventEmitter["off"];
  listenerCount: () => number;
  routeInstalled: () => boolean;
  request: (
    path: string,
    onTagged: (traceparent: string) => void,
    outcome?: "responded" | "cancelled",
  ) => Promise<void>;
} {
  let handler: ((route: RouteLike) => Promise<void>) | undefined;
  const events = new EventEmitter();
  const page = {
    route: (_url: (url: URL) => boolean, routeHandler: (route: RouteLike) => Promise<void>) => {
      if (options.routeFails === true) {
        return Promise.reject(new Error("route failed"));
      }
      handler = routeHandler;
      return options.routeFailsAfterRegistering === true
        ? Promise.reject(new Error("interception update failed"))
        : Promise.resolve();
    },
    unroute: async () => {
      await delay(options.unrouteDelayMs ?? 0);
      if (options.unrouteFails === true) {
        throw new Error("unroute failed");
      }
      handler = undefined;
    },
    on: events.on.bind(events),
    off: events.off.bind(events),
    listenerCount: () => events.listenerCount("requestfailed") + events.listenerCount("response"),
    routeInstalled: () => handler !== undefined,
    request: async (
      path: string,
      onTagged: (traceparent: string) => void,
      outcome: "responded" | "cancelled" = "responded",
    ) => {
      assert(handler !== undefined, "no route is installed");
      const request = {
        url: () => new URL(path, origin).href,
        method: () => "GET",
        headers: () => ({}),
        resourceType: () => "fetch",
      };
      await handler({
        request: () => request,
        fallback: (fallback) => {
          onTagged(fallback?.headers?.["traceparent"] ?? "");
          return Promise.resolve();
        },
      });
      if (outcome === "cancelled") {
        events.emit("requestfailed", request);
      } else {
        events.emit("response", { request: () => request });
      }
    },
  } satisfies InstrumentedPage & Record<string, unknown>;
  return page;
}

export function declare(matrix: Claims): {
  request: string;
  criteria: {
    id: string;
    statement: string;
  }[];
} {
  return {
    request: matrix.request,
    criteria: matrix.criteria.map(({ id, statement }) => ({ id, statement })),
  };
}

export async function runDirectory(
  matrix: Claims,
  overrides: Readonly<Record<string, unknown>> = {},
): Promise<{
  directory: string;
  [Symbol.asyncDispose]: () => Promise<void>;
}> {
  const resources = new AsyncDisposableStack();
  try {
    const directory = await mkdtemp(join(tmpdir(), "verification-run-"));
    resources.defer(() => rm(directory, { recursive: true }));
    const declaration = JSON.stringify(declare(matrix));
    const files = {
      "run.json": {
        runId: "run",
        composition: "e2e-test",
        startedAt: "2026-10-13T00:00:00.000Z",
        target: "node",
        revision: "abc123",
        workingTree: "",
        sourceFingerprint: "f1",
        video: false,
        selection: { files: ["e2e/notes.e2e.ts"] },
        criteriaDeclared: true,
        criteriaSha256: createHash("sha256").update(declaration).digest("hex"),
      },
      "results.json": passingResults,
      "cleanup.json": { cleanupComplete: true, steps: [], commands: [] },
      "source-check.json": { changedDuringRun: false },
      "claims.json": matrix,
      ...overrides,
    };
    await writeFile(join(directory, "criteria.json"), declaration);
    for (const [name, content] of Object.entries(files)) {
      await writeFile(
        join(directory, name),
        typeof content === "string" ? content : JSON.stringify(content),
      );
    }
    const cleanup = resources.move();
    return {
      directory,
      [Symbol.asyncDispose]: () => cleanup.disposeAsync(),
    };
  } finally {
    await resources.disposeAsync();
  }
}

export function criterion(
  overrides: Partial<Claims["criteria"][number]> = {},
): Claims["criteria"][number] {
  return {
    id: "C1",
    statement: "An added note survives a reload",
    status: "passed",
    assertions: [{ test: "adds a note", step: "Persistence: reload" }],
    artifacts: [],
    observation: "The note's title and body were shown after reload",
    ...overrides,
  };
}

export function claims(criteria: Claims["criteria"]): Claims {
  return {
    request: "Adding a note persists it",
    criteria,
    limitations: ["Local build only"],
    video: "not-requested",
  };
}

export function shots(
  scenes: ReadonlyArray<{
    readonly start: number;
    readonly end: number;
    readonly claims: ReadonlyArray<string>;
    readonly artifacts: ReadonlyArray<string>;
  }>,
): {
  rawVideo: string;
  scenes: {
    start: number;
    end: number;
    claims: ReadonlyArray<string>;
    artifacts: ReadonlyArray<string>;
    title: string;
    text: string;
  }[];
} {
  return {
    rawVideo: "test-results/video.webm",
    scenes: scenes.map((scene) => ({ ...scene, title: "Action", text: "Submit the form" })),
  };
}

export const passingAttempt = {
  title: "adds a note",
  status: "passed",
  expectedStatus: "passed",
  steps: [
    {
      title: "Setup: sign in",
      status: "completed",
      durationMs: 2000,
      videoSeconds: { start: 0, end: 2 },
    },
    {
      title: "Persistence: reload",
      status: "completed",
      durationMs: 3000,
      videoSeconds: { start: 6, end: 9 },
    },
  ],
  attachments: [{ name: "video", path: "test-results/video.webm" }],
};

export const passingResults: Results = { verdict: "passed", attempts: [passingAttempt] };

export const origin = "http://127.0.0.1:4173";

const Result = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown));
