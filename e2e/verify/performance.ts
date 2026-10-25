import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";

import type { TestInfo } from "@playwright/test";
import { Schema } from "effect";

import type { DatabaseActivity, DatabaseProbe } from "./databaseActivity.ts";
import type {
  CpuSummary,
  SpanGroup,
  SpanSummary,
  PlanGroup,
  DatabaseSummary,
  ServerSummary,
  Measurement,
  ProfileResult,
  ObservedCall,
} from "./performanceEvidence.ts";

export class CallObserver {
  browser:
    | { readonly page: InstrumentedPage; readonly openSession: () => Promise<ProfilerSession> }
    | undefined;
  #window:
    | { readonly traceId: string; readonly calls: ObservedCall[]; readonly tagged: TaggedRequest[] }
    | undefined;
  #pending: Promise<unknown> = Promise.resolve();

  call<A>(
    surface: ObservedCall["surface"],
    description: string,
    action: (traceparent: string) => Promise<A>,
  ): Promise<A> {
    const window = this.#window;
    const run = async (): Promise<A> => {
      const traceId = window?.traceId ?? randomBytes(16).toString("hex");
      const spanId = randomBytes(8).toString("hex");
      const request = {
        description: `${surface} ${description}`,
        spanId,
        responded: false,
        cancelled: false,
      };
      window?.tagged.push(request);
      const started = performance.now();
      let outcome: ObservedCall["outcome"] = "failed";
      try {
        const result = await action(`00-${traceId}-${spanId}-01`);
        request.responded = true;
        outcome = "completed";
        return result;
      } finally {
        request.cancelled = !request.responded;
        window?.calls.push({
          surface,
          description,
          traceId,
          spanId,
          durationMs: tenths(performance.now() - started),
          outcome,
        });
      }
    };
    if (window === undefined) {
      return run();
    }
    const result = this.#pending.then(run);
    this.#pending = result.catch(() => undefined);
    return result;
  }

  async start(origin: string): Promise<Tracing> {
    const browser =
      this.browser === undefined ? undefined : await startTracing(this.browser.page, origin);
    const window: { traceId: string; calls: ObservedCall[]; tagged: TaggedRequest[] } = {
      traceId: browser?.traceId ?? randomBytes(16).toString("hex"),
      calls: [],
      tagged: [],
    };
    this.#window = window;
    return {
      traceId: window.traceId,
      tagged: () => [...(browser?.tagged() ?? []), ...window.tagged],
      calls: () => window.calls,
      requests: () => [
        ...(browser?.requests() ?? []),
        ...window.tagged.map((request) =>
          request.cancelled ? `${request.description} (cancelled)` : request.description,
        ),
      ],
      stop: async () => {
        try {
          await this.#pending;
          await browser?.stop();
        } finally {
          this.#window = undefined;
        }
      },
    };
  }
}

export function measurer(
  page: InstrumentedPage | CallObserver,
  info: EvidenceSink,
  origin: string,
  probe: DatabaseProbe,
  overBudget: (sample: OverBudget) => void,
): Measure {
  let samples = 0;
  return async (name, action, options) => {
    using _window = claimWindow();
    const sample = ++samples;
    let durationMs = 0;
    let result: Awaited<ReturnType<typeof action>>;
    let tracing: Tracing | undefined;
    let database: Attempt<DatabaseActivity> = unavailable("The database probe did not start.");
    let outcome: Measurement["outcome"] = "failed";
    try {
      await using releases = new AsyncDisposableStack();
      database = await observeDatabase(probe, releases, (observed) => {
        database = observed;
      });
      const traced = await startTracing(page, origin);
      tracing = traced;
      releases.defer(() => release(info, "Request tracing", traced.stop));
      const started = Date.now();
      try {
        result = await action();
        outcome = "completed";
      } finally {
        durationMs = Date.now() - started;
      }
    } finally {
      await attachJson(info, `measurement: ${name} #${sample}`, {
        name,
        sample,
        outcome,
        durationMs,
        budgetMs: options?.budgetMs,
        conditions: conditions(page),
        calls: tracing?.calls?.() ?? [],
        requests: tracing?.requests() ?? [],
        serverActivity:
          tracing === undefined
            ? unavailable("Request tracing did not start.")
            : await serverActivity(tracing, info, `measurement ${slug(name)}-${sample}`),
        databaseActivity: await databaseEvidence(
          info,
          `measurement ${slug(name)}-${sample}`,
          database,
        ),
      } satisfies Measurement).catch((error: unknown) => {
        if (outcome === "completed") {
          throw error;
        }
        info.annotations.push({
          type: "verification",
          description: `The measurement for "${name}" could not be saved: ${String(error)}`,
        });
      });
    }
    if (options?.budgetMs !== undefined && durationMs > options.budgetMs) {
      overBudget({ name, sample, durationMs, budgetMs: options.budgetMs });
    }
    return result;
  };
}

export function profiler(
  page: InstrumentedPage | CallObserver,
  info: EvidenceSink,
  origin: string,
  openSession: (() => Promise<ProfilerSession>) | undefined,
  probe: DatabaseProbe,
): Profile {
  let samples = 0;
  return async (name, action) => {
    using _window = claimWindow();
    const sample = ++samples;
    const file = `${slug(name)}-${sample}`;
    const inspector = process.env["VERIFICATION_NODE_INSPECTOR"];
    let browserProfile: Attempt<unknown> = unavailable("The browser profiler did not start.");
    let serverProfile: Attempt<unknown> =
      inspector === undefined
        ? unavailable(
            "This target has no inspector (workerd/container); server CPU is not profiled.",
          )
        : unavailable("The server profiler did not start.");
    let tracing: Tracing | undefined;
    let database: Attempt<DatabaseActivity> = unavailable("The database probe did not start.");
    let outcome: ProfileResult["outcome"] = "failed";
    let durationMs = 0;
    try {
      await using releases = new AsyncDisposableStack();
      database = await observeDatabase(probe, releases, (observed) => {
        database = observed;
      });
      const session = page instanceof CallObserver ? page.browser?.openSession : openSession;
      const browser =
        session === undefined
          ? unavailable<() => Promise<unknown>>(
              "No browser Page participates; browser CPU is unavailable.",
            )
          : await attempt(() => startBrowserProfile(session));
      if (browser.kind === "captured") {
        releases.defer(async () => {
          browserProfile = await attempt(browser.value);
        });
      } else {
        browserProfile = browser;
      }
      if (inspector !== undefined) {
        const server = await attempt(() =>
          startNodeProfile(new URL(inspector), process.env["VERIFICATION_DIR"]),
        );
        if (server.kind === "captured") {
          releases.defer(async () => {
            serverProfile = await attempt(server.value);
          });
        } else {
          serverProfile = server;
        }
      }
      const traced = await startTracing(page, origin);
      tracing = traced;
      releases.defer(() => release(info, "Request tracing", traced.stop));
      const started = Date.now();
      try {
        const result = await action();
        outcome = "completed";
        return result;
      } finally {
        durationMs = Date.now() - started;
      }
    } finally {
      await attachJson(info, `profile: ${name} #${sample}`, {
        name,
        sample,
        outcome,
        durationMs,
        conditions: [...conditions(page), ...profileConditions],
        calls: tracing?.calls?.() ?? [],
        requests: tracing?.requests() ?? [],
        browserCpu: await saveProfile(info, `${file}-browser`, browserProfile),
        serverCpu: await saveProfile(info, `${file}-server`, serverProfile),
        serverActivity:
          tracing === undefined
            ? unavailable("Request tracing did not start.")
            : await serverActivity(tracing, info, `profile ${file}`),
        databaseActivity: await databaseEvidence(info, `profile ${file}`, database),
      } satisfies ProfileResult).catch((error: unknown) => {
        info.annotations.push({
          type: "verification",
          description: `The profile for "${name}" could not be saved: ${String(error)}`,
        });
      });
    }
  };
}

async function release(
  info: EvidenceSink,
  what: string,
  action: () => Promise<void>,
): Promise<void> {
  const outcome = await attempt(action);
  if (outcome.kind === "unavailable") {
    info.annotations.push({
      type: "verification",
      description: `${what} could not be released: ${outcome.reason}`,
    });
  }
}

async function observeDatabase(
  probe: DatabaseProbe,
  releases: AsyncDisposableStack,
  observed: (activity: Attempt<DatabaseActivity>) => void,
): Promise<Attempt<DatabaseActivity>> {
  const window = await attempt(() => probe.observe());
  if (window.kind === "unavailable") {
    return window;
  }
  releases.defer(async () => {
    observed(await attempt(window.value));
  });
  return unavailable("The database window did not close.");
}

async function databaseEvidence(
  info: EvidenceSink,
  evidence: string,
  activity: Attempt<DatabaseActivity>,
): Promise<Attempt<DatabaseSummary>> {
  if (activity.kind === "unavailable") {
    return activity;
  }
  const plans = new Map<string, PlanGroup>();
  for (const plan of activity.value.plans) {
    const key = `${plan.query}\n${plan.plan}`;
    const entry = plans.get(key);
    plans.set(key, {
      query: plan.query,
      plan: plan.plan,
      executions: (entry?.executions ?? 0) + 1,
      totalMs: tenths((entry?.totalMs ?? 0) + plan.durationMs),
      maxRows: Math.max(entry?.maxRows ?? 0, plan.rows ?? 0),
      sequentialScans: plan.sequentialScans,
    });
  }
  const attachment = `query plans: ${evidence}`;
  const saved = await attempt(() => attachJson(info, attachment, activity.value.plans));
  const statements = activity.value.statements;
  const statementsAttachment = `database statements: ${evidence}`;
  const savedStatements = await attempt(() => attachJson(info, statementsAttachment, statements));
  return captured({
    totals: {
      statements: statements.reduce((total, statement) => total + statement.calls, 0),
      distinct: statements.length,
      totalMs: tenths(statements.reduce((total, statement) => total + statement.totalMs, 0)),
    },
    statements: statements.slice(0, databaseRows),
    statementsAttachment: savedStatements.kind === "captured" ? statementsAttachment : undefined,
    plans: [...plans.values()]
      .toSorted((left, right) => right.totalMs - left.totalMs)
      .slice(0, databaseRows),
    plansAttachment: saved.kind === "captured" ? attachment : undefined,
  });
}

const databaseRows = 15;

const measurementConditions = [
  "Application requests were intercepted to tag them with a trace, which disables the page's HTTP cache.",
  "Every database statement ran under auto_explain (EXPLAIN ANALYZE counting rows and buffers, without per-node timing), which adds a small cost to each statement.",
  "Database activity is database-wide during the interaction: anything else the database ran meanwhile is included.",
];

function conditions(source: InstrumentedPage | CallObserver): ReadonlyArray<string> {
  return source instanceof CallObserver
    ? [
        ...(source.browser === undefined ? [] : measurementConditions.slice(0, 1)),
        ...measurementConditions.slice(1),
        "MCP/service calls are serialized within each window; windows cannot overlap. Statistics reset before the action, and statements/log offsets are read after it. Background database work may still be included; only traced SQL establishes call attribution.",
        "Call latency is client-observed through response consumption and call-evidence attachment, including harness overhead; the action duration also includes its assertions. No browser Page is required.",
      ]
    : measurementConditions;
}

let windowOwned = false;

function claimWindow(): Disposable {
  if (windowOwned) {
    throw new Error(
      "Run measure/profile windows serially, not nested or concurrently: database statistics and Node CPU are shared.",
    );
  }
  windowOwned = true;
  return {
    [Symbol.dispose]: () => {
      windowOwned = false;
    },
  };
}

const profileConditions = [
  "Browser CPU includes Playwright's own work in the page while the action's assertions wait; keep profiled actions to the interaction and its result.",
];

export function summarizeCpuProfile(profile: CpuProfile): CpuSummary {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node.callFrame]));
  const functions = new Map<string, { function: string; location: string; micros: number }>();
  let busy = 0;
  let idle = 0;
  let unattributed = 0;
  profile.samples.forEach((nodeId, index) => {
    const micros = profile.timeDeltas[index] ?? 0;
    const frame = nodes.get(nodeId);
    if (frame === undefined || idleFrames.has(frame.functionName)) {
      idle += micros;
      return;
    }
    busy += micros;
    if (frame.url === "") {
      unattributed += micros;
      return;
    }
    const location = `${shortenUrl(frame.url)}:${frame.lineNumber + 1}`;
    const name = frame.functionName === "" ? "(anonymous)" : frame.functionName;
    const key = `${name}\n${location}`;
    const entry = functions.get(key) ?? { function: name, location, micros: 0 };
    entry.micros += micros;
    functions.set(key, entry);
  });
  return {
    busyMs: tenths(busy / 1000),
    idleMs: tenths(idle / 1000),
    unattributedMs: tenths(unattributed / 1000),
    functions: [...functions.values()]
      .toSorted((left, right) => right.micros - left.micros)
      .slice(0, 10)
      .map((entry) => ({
        function: entry.function,
        location: entry.location,
        selfMs: tenths(entry.micros / 1000),
        percentOfBusy: busy === 0 ? 0 : Math.round((entry.micros / busy) * 100),
      })),
  };
}

export function summarizeSpans(spans: ReadonlyArray<CollectedSpan>): SpanSummary {
  const operations = group(
    spans.filter((span) => typeof span.attributes["app.operation"] === "string"),
    (span) => `${span.name} ${text(span.attributes["app.outcome"])}`.trim(),
  );
  const statements = spans.filter((span) => typeof span.attributes["db.query.text"] === "string");
  const start = Math.min(...spans.map((span) => span.startMs));
  return {
    operations,
    sql: {
      statements: statements.length,
      totalMs: tenths(statements.reduce((total, span) => total + span.durationMs, 0)),

      slowest: group(statements, (span) => text(span.attributes["db.query.text"])),
    },
    logs: spans
      .flatMap((span) =>
        (span.events ?? []).map((event) => ({
          atMs: tenths(event.timeMs - start),
          level: text(event.attributes["effect.logLevel"]) || "INFO",
          message: event.name,
          span: span.name,
        })),
      )
      .toSorted((left, right) => left.atMs - right.atMs)
      .slice(0, 30),
    errors: spans.flatMap((span) =>
      span.error === undefined ? [] : [{ span: span.name, error: span.error }],
    ),
  };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function group(
  spans: ReadonlyArray<CollectedSpan>,
  key: (span: CollectedSpan) => string,
): ReadonlyArray<SpanGroup> {
  const groups = new Map<string, Array<number>>();
  for (const span of spans) {
    groups.set(key(span), [...(groups.get(key(span)) ?? []), span.durationMs]);
  }
  return [...groups.entries()]
    .map(([name, durations]) => ({
      name,
      calls: durations.length,
      totalMs: tenths(durations.reduce((total, duration) => total + duration, 0)),
      maxMs: tenths(Math.max(...durations)),
    }))
    .toSorted((left, right) => right.totalMs - left.totalMs);
}

export function describeServerRequest(request: RequestLike): string | undefined {
  const { pathname } = new URL(request.url());
  if (pathname.startsWith("/_serverFn/")) {
    const singleFlight = request.headers()["x-single-flight"] === undefined ? "" : " single-flight";
    return `${request.method()} server function${singleFlight}`;
  }
  if (pathname.startsWith("/api/") && pathname !== "/api/telemetry") {
    return `${request.method()} ${pathname}`;
  }
  return undefined;
}

function describeApplicationRequest(request: RequestLike): string | undefined {
  return (
    describeServerRequest(request) ??
    (request.resourceType() === "document"
      ? `${request.method()} page ${new URL(request.url()).pathname}`
      : undefined)
  );
}

async function startTracing(
  page: InstrumentedPage | CallObserver,
  origin: string,
): Promise<Tracing> {
  if (page instanceof CallObserver) {
    return page.start(origin);
  }
  const traceId = randomBytes(16).toString("hex");
  const tagged = new Map<RequestLike, TaggedRequest>();
  const matches = (url: URL): boolean => url.origin === new URL(origin).origin;
  const handler = async (route: RouteLike): Promise<void> => {
    const request = route.request();
    const description = describeApplicationRequest(request);
    if (description === undefined) {
      await route.fallback();
      return;
    }
    const spanId = randomBytes(8).toString("hex");
    tagged.set(request, { description, spanId, responded: false, cancelled: false });
    await route.fallback({
      headers: { ...request.headers(), traceparent: `00-${traceId}-${spanId}-01` },
    });
  };
  const cancelled = (request: RequestLike): void => {
    const entry = tagged.get(request);
    if (entry !== undefined && !entry.responded) {
      tagged.set(request, { ...entry, cancelled: true });
    }
  };
  const responded = (response: { request(): RequestLike }): void => {
    const entry = tagged.get(response.request());
    if (entry !== undefined) {
      tagged.set(response.request(), { ...entry, responded: true });
    }
  };
  page.on("requestfailed", cancelled);
  page.on("response", responded);
  const unsubscribe = (): void => {
    page.off("requestfailed", cancelled);
    page.off("response", responded);
  };
  try {
    await page.route(matches, handler);
  } catch (error) {
    unsubscribe();

    const rollback = await attempt(() => page.unroute(matches, handler));
    if (rollback.kind === "unavailable") {
      throw new Error(
        `Request tracing failed to start, and its route could not be removed (${rollback.reason}); do not measure on this page again.`,
        { cause: error },
      );
    }
    throw error;
  }
  return {
    traceId,
    tagged: () => [...tagged.values()],
    requests: () =>
      [...tagged.values()].map((entry) =>
        entry.cancelled ? `${entry.description} (cancelled)` : entry.description,
      ),
    stop: async () => {
      try {
        await page.unroute(matches, handler);
      } finally {
        unsubscribe();
      }
    },
  };
}

async function serverActivity(
  tracing: Tracing,
  info: EvidenceSink,
  evidence: string,
): Promise<Attempt<ServerSummary>> {
  const collector = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  if (collector === undefined) {
    return unavailable("Server traces are collected only in application verification runs.");
  }
  return attempt(async () => {
    const read = async (): Promise<
      {
        readonly spanId: string;
        readonly parentSpanId?: string | undefined;
        readonly name: string;
        readonly startMs: number;
        readonly endMs: number;
        readonly durationMs: number;
        readonly attributes: {
          readonly [x: string]: unknown;
        };
        readonly events?:
          | readonly {
              readonly name: string;
              readonly timeMs: number;
              readonly attributes: {
                readonly [x: string]: unknown;
              };
            }[]
          | undefined;
        readonly error?: string | undefined;
      }[]
    > => {
      const url = new URL("/spans", collector);
      url.searchParams.set("trace", tracing.traceId);
      const spans = Schema.decodeUnknownSync(SpansJson)(await (await fetch(url)).text());
      return [...new Map(spans.map((span) => [span.spanId, span])).values()];
    };
    const missing = (
      spans: ReadonlyArray<CollectedSpan>,
      requests: ReadonlyArray<TaggedRequest>,
    ): TaggedRequest[] =>
      requests.filter(
        (request) =>
          !spans.some(
            (span) => span.name === "http.server.request" && span.parentSpanId === request.spanId,
          ),
      );
    const completed = tracing.tagged().filter((request) => !request.cancelled);
    let spans = await read();
    for (let quiet = 0, waited = 0; waited < spanSettleAttempts; waited += 1) {
      if (missing(spans, completed).length === 0 && quiet >= 3) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, spanSettleIntervalMs));
      const next = await read();
      quiet = next.length === spans.length ? quiet + 1 : 0;
      spans = next;
    }
    const attachment = `backend spans: ${evidence}`;
    await attachJson(info, attachment, spans);
    const absent = missing(spans, completed).length;
    if (absent > 0) {
      throw new Error(
        `Server spans arrived for ${completed.length - absent} of ${completed.length} completed requests; server activity is incomplete.`,
      );
    }

    const unresolved = missing(
      spans,
      tracing.tagged().filter((request) => request.cancelled),
    ).map((request) => request.description);
    return {
      ...summarizeSpans(spans),
      unresolvedRequests: unresolved,
      tracesAttachment: attachment,
    };
  });
}

const spanSettleIntervalMs = 150;
const spanSettleAttempts = 20;

async function saveProfile(
  info: EvidenceSink,
  file: string,
  profile: Attempt<unknown>,
): Promise<Attempt<CpuSummary>> {
  if (profile.kind === "unavailable") {
    return profile;
  }
  return attempt(async () => {
    const path = info.outputPath(`${file}.cpuprofile`);
    await writeFile(path, JSON.stringify(profile.value));
    await info.attach(`cpuprofile: ${file}`, { path, contentType: "application/json" });
    return summarizeCpuProfile(Schema.decodeUnknownSync(CpuProfileSchema)(profile.value));
  });
}

async function startBrowserProfile(
  openSession: () => Promise<ProfilerSession>,
): Promise<() => Promise<unknown>> {
  const session = await openSession();
  try {
    await session.send("Profiler.enable");
    await session.send("Profiler.start");
  } catch (error) {
    await session.detach();
    throw error;
  }
  return async () => {
    try {
      return Schema.decodeUnknownSync(ProfilerStopResult)(await session.send("Profiler.stop"))
        .profile;
    } finally {
      await session.detach();
    }
  };
}

async function startNodeProfile(
  inspector: URL,
  run: string | undefined,
): Promise<() => Promise<unknown>> {
  const targets = Schema.decodeUnknownSync(InspectorTargets)(
    await (
      await fetch(new URL("/json/list", inspector), {
        signal: AbortSignal.timeout(inspectorTimeoutMs),
      })
    ).text(),
  );
  const target = targets[0];
  if (target === undefined) {
    throw new Error(`No inspector target at ${inspector.origin}.`);
  }
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  let nextId = 0;
  const send = (method: string, params?: Readonly<Record<string, unknown>>): Promise<unknown> =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++nextId;
      const settle = (error: Error | undefined, result?: unknown): void => {
        clearTimeout(timer);
        socket.removeEventListener("message", onMessage);
        socket.removeEventListener("close", onClose);
        if (error === undefined) {
          resolve(result);
        } else {
          reject(error);
        }
      };
      const onMessage = (event: MessageEvent): void => {
        const message = Schema.decodeUnknownSync(InspectorReply)(String(event.data));
        if (message.id === id) {
          settle(
            message.error === undefined ? undefined : new Error(message.error.message),
            message.result,
          );
        }
      };
      const onClose = (): void => settle(new Error(`The inspector closed during ${method}.`));
      const timer = setTimeout(
        () => settle(new Error(`The inspector did not answer ${method} in time.`)),
        inspectorTimeoutMs,
      );
      socket.addEventListener("message", onMessage);
      socket.addEventListener("close", onClose);
      socket.send(JSON.stringify({ id, method, params }));
    });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Inspector connection timed out.")),
        inspectorTimeoutMs,
      );
      socket.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("Inspector connection failed."));
        },
        { once: true },
      );
    });
    const owner = Schema.decodeUnknownSync(EvaluateResult)(
      await send("Runtime.evaluate", {
        expression: "process.env.VERIFICATION_DIR",
        returnByValue: true,
      }),
    ).result.value;
    if (run === undefined || owner !== run) {
      throw new Error(
        `The inspector at ${inspector.host} belongs to another process; the server was not profiled.`,
      );
    }
    await send("Profiler.enable");
    await send("Profiler.start");
  } catch (error) {
    socket.close();
    throw error;
  }
  return async () => {
    try {
      return Schema.decodeUnknownSync(ProfilerStopResult)(await send("Profiler.stop")).profile;
    } finally {
      socket.close();
    }
  };
}

const inspectorTimeoutMs = 10_000;

async function attachJson(info: EvidenceSink, name: string, value: unknown): Promise<void> {
  const path = info.outputPath(`${slug(name)}.json`);
  await writeFile(path, JSON.stringify(value, null, 2));
  await info.attach(name, { path, contentType: "application/json" });
}

async function attempt<A>(action: () => Promise<A>): Promise<Attempt<A>> {
  try {
    return captured(await action());
  } catch (error) {
    return unavailable(error instanceof Error ? error.message : String(error));
  }
}

function captured<A>(value: A): Attempt<A> {
  return { kind: "captured", value };
}

function unavailable<A>(reason: string): Attempt<A> {
  return { kind: "unavailable", reason };
}

function shortenUrl(encoded: string): string {
  const url = decodeLocation(encoded);
  const packageIndex = url.lastIndexOf("node_modules/");
  if (packageIndex !== -1) {
    return url.slice(packageIndex + "node_modules/".length);
  }
  for (const root of ["/apps/", "/packages/"]) {
    const index = url.lastIndexOf(root);
    if (index !== -1) {
      return url.slice(index + 1);
    }
  }
  return URL.canParse(url) ? new URL(url).pathname : url;
}

function decodeLocation(url: string): string {
  try {
    return decodeURI(url);
  } catch {
    return url;
  }
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
}

function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

const idleFrames = new Set(["(idle)", "(program)", "(root)", "(garbage collector)"]);

const CallFrame = Schema.Struct({
  functionName: Schema.String,
  url: Schema.String,
  lineNumber: Schema.Number,
});
const CpuProfileSchema = Schema.Struct({
  nodes: Schema.Array(Schema.Struct({ id: Schema.Number, callFrame: CallFrame })),
  samples: Schema.Array(Schema.Number),
  timeDeltas: Schema.Array(Schema.Number),
});
const ProfilerStopResult = Schema.Struct({ profile: Schema.Unknown });
const EvaluateResult = Schema.Struct({
  result: Schema.Struct({ value: Schema.optional(Schema.Unknown) }),
});
const InspectorTargets = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ webSocketDebuggerUrl: Schema.String })),
);
const InspectorReply = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optional(Schema.Number),
    result: Schema.optional(Schema.Unknown),
    error: Schema.optional(Schema.Struct({ message: Schema.String })),
  }),
);
const SpanSchema = Schema.Struct({
  spanId: Schema.String,
  parentSpanId: Schema.optional(Schema.String),
  name: Schema.String,
  startMs: Schema.Number,
  endMs: Schema.Number,
  durationMs: Schema.Number,
  attributes: Schema.Record(Schema.String, Schema.Unknown),
  events: Schema.optional(
    Schema.Array(
      Schema.Struct({
        name: Schema.String,
        timeMs: Schema.Number,
        attributes: Schema.Record(Schema.String, Schema.Unknown),
      }),
    ),
  ),
  error: Schema.optional(Schema.String),
});
const SpansJson = Schema.fromJsonString(Schema.Array(SpanSchema));

export type CpuProfile = typeof CpuProfileSchema.Type;
export type CollectedSpan = typeof SpanSchema.Type;

type Attempt<A> =
  | { readonly kind: "captured"; readonly value: A }
  | { readonly kind: "unavailable"; readonly reason: string };

export type InstrumentedPage = {
  route(url: (url: URL) => boolean, handler: (route: RouteLike) => Promise<void>): Promise<unknown>;
  unroute(
    url: (url: URL) => boolean,
    handler: (route: RouteLike) => Promise<void>,
  ): Promise<unknown>;
  on(event: "requestfailed", listener: (request: RequestLike) => void): unknown;
  on(event: "response", listener: (response: { request(): RequestLike }) => void): unknown;
  off(event: "requestfailed", listener: (request: RequestLike) => void): unknown;
  off(event: "response", listener: (response: { request(): RequestLike }) => void): unknown;
};

export type EvidenceSink = Pick<TestInfo, "outputPath" | "attach" | "annotations">;

export type ProfilerSession = {
  send(method: "Profiler.enable" | "Profiler.start" | "Profiler.stop"): Promise<unknown>;
  detach(): Promise<void>;
};

export type RouteLike = {
  request(): RequestLike;
  fallback(options?: { readonly headers?: Record<string, string> }): Promise<void>;
};

export type RequestLike = {
  url(): string;
  method(): string;
  headers(): Record<string, string>;
  resourceType(): string;
};

type TaggedRequest = {
  readonly description: string;

  readonly spanId: string;
  readonly responded: boolean;
  readonly cancelled: boolean;
};

type Tracing = {
  readonly traceId: string;
  readonly tagged: () => ReadonlyArray<TaggedRequest>;
  readonly calls?: () => ReadonlyArray<ObservedCall>;
  readonly requests: () => ReadonlyArray<string>;
  readonly stop: () => Promise<void>;
};

export type OverBudget = {
  readonly name: string;
  readonly sample: number;
  readonly durationMs: number;
  readonly budgetMs: number;
};

export type Measure = <A>(
  name: string,
  action: () => Promise<A>,
  options?: { readonly budgetMs: number },
) => Promise<A>;

export type Profile = <A>(name: string, action: () => Promise<A>) => Promise<A>;
