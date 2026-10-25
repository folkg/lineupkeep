import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { Schema } from "effect";
import { expect, it } from "vitest";

import type { DatabaseProbe } from "#e2e/verify/databaseActivity.ts";
import {
  CallObserver,
  measurer,
  profiler,
  summarizeCpuProfile,
  summarizeSpans,
  type CollectedSpan,
  type CpuProfile,
  type EvidenceSink,
  type OverBudget,
} from "#e2e/verify/performance.ts";
import { MeasurementJson } from "#e2e/verify/performanceEvidence.ts";

import {
  scriptedPage,
  evidenceSink,
  scriptedProbe,
  unexpectedBudgetFailure,
  scriptedSession,
  fakeCollector,
  requestSpan,
  origin,
} from "./verificationTest.ts";

it("attributes busy CPU time to the functions that were executing", () => {
  const profile: CpuProfile = {
    nodes: [
      { id: 1, callFrame: { functionName: "(idle)", url: "", lineNumber: 0 } },
      {
        id: 2,
        callFrame: {
          functionName: "renderList",
          url: "http://127.0.0.1:4173/apps/web/src/browser/notes/NoteList.tsx",
          lineNumber: 41,
        },
      },
      {
        id: 3,
        callFrame: {
          functionName: "parse",
          url: "file:///repo/node_modules/effect/dist/Schema.js",
          lineNumber: 9,
        },
      },
    ],
    samples: [1, 2, 2, 3],
    timeDeltas: [5000, 3000, 3000, 2000],
  };

  const summary = summarizeCpuProfile(profile);

  expect(summary.busyMs).toBe(8);
  expect(summary.idleMs).toBe(5);
  expect(summary.functions).toEqual([
    {
      function: "renderList",
      location: "apps/web/src/browser/notes/NoteList.tsx:42",
      selfMs: 6,
      percentOfBusy: 75,
    },
    { function: "parse", location: "effect/dist/Schema.js:10", selfMs: 2, percentOfBusy: 25 },
  ]);
});

it("summarizes application operations and their SQL, slowest first", () => {
  const spans: ReadonlyArray<CollectedSpan> = [
    span("notes.update", 40, { "app.operation": "notes.update", "app.outcome": "success" }),
    span("sql.execute", 12, { "db.query.text": "update notes set title = $1" }),
    span("sql.execute", 3, { "db.query.text": "select * from notes" }),
    span("sql.execute", 5, { "db.query.text": "select * from notes" }),
    span("http.server.request", 55, {}),
  ];

  const summary = summarizeSpans(spans);

  expect(summary).toEqual({
    operations: [{ name: "notes.update success", calls: 1, totalMs: 40, maxMs: 40 }],
    sql: {
      statements: 3,
      totalMs: 20,
      slowest: [
        { name: "update notes set title = $1", calls: 1, totalMs: 12, maxMs: 12 },
        { name: "select * from notes", calls: 2, totalMs: 8, maxMs: 5 },
      ],
    },
    logs: [],
    errors: [],
  });
});

it("recognizes SQL by exported query attributes rather than an instrumentation-specific span name", () => {
  const summary = summarizeSpans([
    span("postgres", 3, { "db.query.text": "select 1", "db.system.name": "postgresql" }),
  ]);

  expect(summary.sql).toEqual({
    statements: 1,
    totalMs: 3,
    slowest: [{ name: "select 1", calls: 1, totalMs: 3, maxMs: 3 }],
  });
});

it("excludes request-tracing teardown from a measured interaction's duration", async () => {
  await using evidence = await evidenceSink();
  const page = scriptedPage({ unrouteDelayMs: 200 });
  const measure = measurer(page, evidence.sink, origin, scriptedProbe(), unexpectedBudgetFailure);

  await measure("instant action", () => Promise.resolve(), { budgetMs: 100 });

  const [measurement] = await evidence.results();
  expect(measurement).toMatchObject({ name: "instant action", sample: 1 });
  expect(Number(measurement?.["durationMs"])).toBeLessThan(100);
});

it("stops the browser profiler and reports the action's own failure", async () => {
  await using evidence = await evidenceSink();
  const session = scriptedSession();
  const profile = profiler(
    scriptedPage(),
    evidence.sink,
    origin,
    () => Promise.resolve(session),
    scriptedProbe(),
  );

  const profiled = profile("failing action", () => Promise.reject(new Error("assertion failed")));

  await expect(profiled).rejects.toThrow("assertion failed");
  expect(session.calls).toEqual(["Profiler.enable", "Profiler.start", "Profiler.stop", "detach"]);
  const [result] = await evidence.results();
  expect(result).toMatchObject({ outcome: "failed" });
});

it("stops the browser profiler when request tracing cannot start", async () => {
  await using evidence = await evidenceSink();
  const session = scriptedSession();
  const page = scriptedPage({ routeFails: true });
  const profile = profiler(
    page,
    evidence.sink,
    origin,
    () => Promise.resolve(session),
    scriptedProbe(),
  );

  const profiled = profile("search", () => Promise.resolve());

  await expect(profiled).rejects.toThrow("route failed");
  expect(session.calls).toContain("detach");
});

it(
  "reports server activity as unavailable when a request's span is missing",
  { timeout: 10_000 },
  async () => {
    await using evidence = await evidenceSink();
    await using collector = await fakeCollector((tagged) => {
      const first = requestSpan(tagged[0] ?? "");
      return [first, first];
    });
    const page = scriptedPage();
    const measure = measurer(page, evidence.sink, origin, scriptedProbe(), unexpectedBudgetFailure);

    await measure("two requests", async () => {
      await page.request("/_serverFn/a", collector.tag);
      await page.request("/_serverFn/b", collector.tag);
    });

    const [measurement] = await evidence.results();
    expect(measurement?.["serverActivity"]).toEqual({
      kind: "unavailable",
      reason: "Server spans arrived for 1 of 2 completed requests; server activity is incomplete.",
    });
  },
);

it("attributes server activity to the spans of the requests the interaction made", async () => {
  await using evidence = await evidenceSink();
  await using collector = await fakeCollector((tagged) => tagged.map(requestSpan));
  const page = scriptedPage();
  const measure = measurer(page, evidence.sink, origin, scriptedProbe(), unexpectedBudgetFailure);

  await measure("one request", () => page.request("/_serverFn/a", collector.tag));

  const [measurement] = await evidence.results();
  expect(measurement?.["serverActivity"]).toMatchObject({ kind: "captured" });
  expect(measurement?.["requests"]).toEqual(["GET server function"]);
});

it("marks server activity partial when a cancelled request has no server span", async () => {
  await using evidence = await evidenceSink();
  await using collector = await fakeCollector((tagged) => [requestSpan(tagged[0] ?? "")]);
  const page = scriptedPage();
  const measure = measurer(page, evidence.sink, origin, scriptedProbe(), unexpectedBudgetFailure);

  await measure("one served, one cancelled", async () => {
    await page.request("/_serverFn/a", collector.tag);
    await page.request("/_serverFn/b", collector.tag, "cancelled");
  });

  const [measurement] = await evidence.results();
  expect(measurement?.["serverActivity"]).toMatchObject({
    kind: "captured",
    value: { unresolvedRequests: ["GET server function"] },
  });
});

it("removes its request listeners when tracing cannot start or stop", async () => {
  await using evidence = await evidenceSink();
  const failingStart = scriptedPage({ routeFails: true });
  const failingStop = scriptedPage({ unrouteFails: true });

  const started = await measurer(
    failingStart,
    evidence.sink,
    origin,
    scriptedProbe(),
    unexpectedBudgetFailure,
  )("start fails", () => Promise.resolve()).catch((error: unknown) => error);
  await measurer(
    failingStop,
    evidence.sink,
    origin,
    scriptedProbe(),
    unexpectedBudgetFailure,
  )("stop fails", () => Promise.resolve());

  expect(started).toEqual(new Error("route failed"));
  expect(failingStart.listenerCount()).toBe(0);
  expect(failingStop.listenerCount()).toBe(0);
  expect(evidence.sink.annotations.map((annotation) => annotation.description).join()).toContain(
    "unroute failed",
  );
});

it("removes a route that was registered before tracing failed to start", async () => {
  await using evidence = await evidenceSink();
  const page = scriptedPage({ routeFailsAfterRegistering: true });

  const started = await measurer(
    page,
    evidence.sink,
    origin,
    scriptedProbe(),
    unexpectedBudgetFailure,
  )("start fails late", () => Promise.resolve()).catch((error: unknown) => error);

  expect(started).toEqual(new Error("interception update failed"));
  expect(page.routeInstalled()).toBe(false);
  expect(page.listenerCount()).toBe(0);
});

it("records what the database ran during a measured interaction, grouping repeated plans", async () => {
  await using evidence = await evidenceSink();
  const plan = {
    query: "select * from note where owner = $1",
    durationMs: 1.5,
    plan: "Sort → Seq Scan on note",
    rows: 20,
    sharedBlocksHit: 3,
    sharedBlocksRead: 0,
    sequentialScans: ["note"],
    detail: { "Node Type": "Sort" },
  };
  const probe = scriptedProbe({
    statements: [
      {
        query: "select * from note where owner = $1",
        calls: 2,
        totalMs: 3,
        meanMs: 1.5,
        rows: 40,
        sharedBlocksHit: 6,
        sharedBlocksRead: 0,
      },
    ],
    plans: [plan, plan],
  });
  const measure = measurer(scriptedPage(), evidence.sink, origin, probe, unexpectedBudgetFailure);

  await measure("list notes", () => Promise.resolve());

  const [measurement] = await evidence.results();
  expect(measurement?.["databaseActivity"]).toMatchObject({
    kind: "captured",
    value: {
      statements: [{ calls: 2, totalMs: 3 }],
      plans: [{ plan: "Sort → Seq Scan on note", executions: 2, totalMs: 3, maxRows: 20 }],
      plansAttachment: "query plans: measurement list-notes-1",
    },
  });
  expect(probe.closed()).toBe(true);
});

it("retains measurement evidence and closes the database window when the action fails", async () => {
  await using evidence = await evidenceSink();
  const probe = scriptedProbe();
  const measure = measurer(scriptedPage(), evidence.sink, origin, probe, unexpectedBudgetFailure);

  const measured = measure("failing", () => Promise.reject(new Error("assertion failed")));

  await expect(measured).rejects.toThrow("assertion failed");
  expect(probe.closed()).toBe(true);
  const [measurement] = await evidence.results();
  expect(measurement).toMatchObject({
    name: "failing",
    outcome: "failed",
    databaseActivity: { kind: "captured" },
  });
});

it("preserves the action's error when measurement evidence cannot be saved", async () => {
  await using evidence = await evidenceSink();
  const sink: EvidenceSink = {
    ...evidence.sink,
    attach: () => Promise.reject(new Error("attachment unavailable")),
  };
  const measure = measurer(scriptedPage(), sink, origin, scriptedProbe(), unexpectedBudgetFailure);
  const failure = new Error("assertion failed");

  const measured = measure("failing", () => Promise.reject(failure));

  await expect(measured).rejects.toBe(failure);
  expect(sink.annotations).toContainEqual({
    type: "verification",
    description: 'The measurement for "failing" could not be saved: Error: attachment unavailable',
  });
});

it("reports an evidence-saving error when the measured action succeeds", async () => {
  await using evidence = await evidenceSink();
  const failure = new Error("attachment unavailable");
  const sink: EvidenceSink = {
    ...evidence.sink,
    attach: () => Promise.reject(failure),
  };
  const measure = measurer(scriptedPage(), sink, origin, scriptedProbe(), unexpectedBudgetFailure);

  const measured = measure("save", () => Promise.resolve("saved"));

  await expect(measured).rejects.toBe(failure);
});

it("measures the interaction and reports database activity unavailable when the probe fails", async () => {
  await using evidence = await evidenceSink();
  const probe: DatabaseProbe = {
    observe: () => Promise.reject(new Error("connection refused")),
  };
  const measure = measurer(scriptedPage(), evidence.sink, origin, probe, unexpectedBudgetFailure);

  const result = await measure("search", () => Promise.resolve("done"));

  expect(result).toBe("done");
  const [measurement] = await evidence.results();
  expect(measurement?.["databaseActivity"]).toEqual({
    kind: "unavailable",
    reason: "connection refused",
  });
});

it("lists the logs written inside an interaction's spans in order, and the spans that failed", () => {
  const spans: ReadonlyArray<CollectedSpan> = [
    {
      ...span("notes.update", 12, { "app.operation": "notes.update" }),
      startMs: 100,
      events: [
        { name: "Note saved", timeMs: 108, attributes: { "effect.logLevel": "INFO" } },
        { name: "Slow write", timeMs: 104, attributes: { "effect.logLevel": "WARN" } },
      ],
      error: "NoteNotFound",
    },
  ];

  const summary = summarizeSpans(spans);

  expect(summary.logs).toEqual([
    { atMs: 4, level: "WARN", message: "Slow write", span: "notes.update" },
    { atMs: 8, level: "INFO", message: "Note saved", span: "notes.update" },
  ]);
  expect(summary.errors).toEqual([{ span: "notes.update", error: "NoteNotFound" }]);
});

it("reports every sample over its budget and keeps measuring", async () => {
  await using evidence = await evidenceSink();
  const failures: Array<OverBudget> = [];
  const measure = measurer(scriptedPage(), evidence.sink, origin, scriptedProbe(), (over) =>
    failures.push(over),
  );

  await measure("save", () => delay(40), { budgetMs: 10 });
  await measure("save", () => delay(40), { budgetMs: 10 });

  expect(failures).toEqual([
    expect.objectContaining({ name: "save", sample: 1, budgetMs: 10 }),
    expect.objectContaining({ name: "save", sample: 2, budgetMs: 10 }),
  ]);
  expect((await evidence.results()).map((sample) => sample["sample"])).toEqual([1, 2]);
});

it("totals every database statement even when it lists only the slowest", async () => {
  await using evidence = await evidenceSink();
  const statements = Array.from({ length: 20 }, (_, index) => ({
    query: `select ${index}`,
    calls: 1,
    totalMs: 20 - index,
    meanMs: 20 - index,
    rows: 1,
    sharedBlocksHit: 0,
    sharedBlocksRead: 0,
  }));
  const measure = measurer(
    scriptedPage(),
    evidence.sink,
    origin,
    scriptedProbe({ statements, plans: [] }),
    unexpectedBudgetFailure,
  );

  await measure("busy", () => Promise.resolve());

  const [measurement] = await evidence.results();
  expect(measurement?.["databaseActivity"]).toMatchObject({
    kind: "captured",
    value: { totals: { statements: 20, distinct: 20, totalMs: 210 } },
  });
});

it("keeps a measurement's and a profile's query plans apart for the same interaction", async () => {
  await using evidence = await evidenceSink();
  const plan = (
    label: string,
  ): {
    query: string;
    durationMs: number;
    plan: string;
    rows: number;
    sharedBlocksHit: number;
    sharedBlocksRead: number;
    sequentialScans: never[];
    detail: Readonly<Record<string, never>>;
  } => ({
    query: "select 1",
    durationMs: 1,
    plan: label,
    rows: 1,
    sharedBlocksHit: 0,
    sharedBlocksRead: 0,
    sequentialScans: [],
    detail: {},
  });
  const measure = measurer(
    scriptedPage(),
    evidence.sink,
    origin,
    scriptedProbe({ statements: [], plans: [plan("measured plan")] }),
    unexpectedBudgetFailure,
  );
  const profile = profiler(
    scriptedPage(),
    evidence.sink,
    origin,
    () => Promise.resolve(scriptedSession()),
    scriptedProbe({ statements: [], plans: [plan("profiled plan")] }),
  );

  await measure("list", () => Promise.resolve());
  await profile("list", () => Promise.resolve());

  const [measured, profiled] = await evidence.results();
  expect(measured?.["databaseActivity"]).toMatchObject({
    value: { plansAttachment: "query plans: measurement list-1" },
  });
  expect(profiled?.["databaseActivity"]).toMatchObject({
    value: { plansAttachment: "query plans: profile list-1" },
  });
  expect(await evidence.attachment("query plans: measurement list-1")).toContain("measured plan");
  expect(await evidence.attachment("query plans: profile list-1")).toContain("profiled plan");
});

it("refuses to profile a server inspector that belongs to another process", async () => {
  await using evidence = await evidenceSink();
  await using foreign = await foreignInspector();
  using _environment = scopedEnvironment({
    VERIFICATION_NODE_INSPECTOR: foreign.url,
    VERIFICATION_DIR: "/this-run",
  });
  const profile = profiler(
    scriptedPage(),
    evidence.sink,
    origin,
    () => Promise.resolve(scriptedSession()),
    scriptedProbe(),
  );

  await profile("search", () => Promise.resolve());

  const [result] = await evidence.results();
  expect(result?.["serverCpu"]).toMatchObject({ kind: "unavailable" });
  expect(JSON.stringify(result?.["serverCpu"])).toContain("belongs to another process");
});

it("measures headless calls with isolated trace linkage and client latency", async () => {
  await using evidence = await evidenceSink();
  await using collector = await fakeCollector((tagged) => tagged.map(requestSpan));
  const calls = new CallObserver();
  const measure = measurer(calls, evidence.sink, origin, scriptedProbe(), unexpectedBudgetFailure);

  await measure("service", () =>
    calls.call("services", "read", (traceparent) => {
      collector.tag(traceparent);
      return Promise.resolve("persisted");
    }),
  );
  await measure("mcp", () =>
    calls.call("mcp", "tools/call", (traceparent) => {
      collector.tag(traceparent);
      return Promise.resolve("protocol result");
    }),
  );

  const samples = await evidence.results();
  expect(samples[0]).toMatchObject({
    outcome: "completed",
    calls: [
      {
        surface: "services",
        description: "read",
        outcome: "completed",
      },
    ],
    serverActivity: { kind: "captured" },
  });
  expect(samples[1]).toMatchObject({ calls: [{ surface: "mcp" }], requests: ["mcp tools/call"] });
  const first = Schema.decodeUnknownSync(MeasurementJson)(JSON.stringify(samples[0]));
  const second = Schema.decodeUnknownSync(MeasurementJson)(JSON.stringify(samples[1]));
  expect(first.calls?.[0]?.durationMs).toBeGreaterThanOrEqual(0);
  expect(first.calls?.[0]?.traceId).not.toBe(second.calls?.[0]?.traceId);
  const secondSpans = await evidence.attachment("backend spans: measurement mcp-2");
  expect(secondSpans).toContain(second.calls?.[0]?.spanId);
  expect(secondSpans).not.toContain(first.calls?.[0]?.spanId);
});

it("serializes calls inside a window and rejects overlapping windows before resetting statistics", async () => {
  await using evidence = await evidenceSink();
  const calls = new CallObserver();
  const measure = measurer(calls, evidence.sink, origin, scriptedProbe(), unexpectedBudgetFailure);
  const order: string[] = [];

  await measure("serial", async () => {
    await expect(measure("overlap", () => Promise.resolve())).rejects.toThrow("serially");
    await Promise.all([
      calls.call("services", "first", async () => {
        order.push("first start");
        await delay(10);
        order.push("first end");
      }),
      calls.call("mcp", "second", () => {
        order.push("second");
        return Promise.resolve();
      }),
    ]);
  });

  expect(order).toEqual(["first start", "first end", "second"]);
  expect(await evidence.results()).toHaveLength(1);
});

it("retains failed headless calls and preserves the original transport failure", async () => {
  await using evidence = await evidenceSink();
  const calls = new CallObserver();
  const probe = scriptedProbe();
  const measure = measurer(calls, evidence.sink, origin, probe, unexpectedBudgetFailure);
  const failure = new Error("transport disconnected");

  await expect(
    measure("failed call", () => calls.call("mcp", "tools/call", () => Promise.reject(failure))),
  ).rejects.toBe(failure);

  const [result] = await evidence.results();
  expect(result).toMatchObject({
    outcome: "failed",
    calls: [{ outcome: "failed" }],
    requests: ["mcp tools/call (cancelled)"],
  });
  expect(probe.closed()).toBe(true);
});

it("profiles without a Page and marks browser and non-Node CPU unavailable", async () => {
  await using evidence = await evidenceSink();
  const calls = new CallObserver();
  const profile = profiler(calls, evidence.sink, origin, undefined, scriptedProbe());

  expect(
    await profile("headless", () => calls.call("services", "read", () => Promise.resolve(42))),
  ).toBe(42);

  const [result] = await evidence.results();
  expect(result).toMatchObject({
    browserCpu: { kind: "unavailable" },
    serverCpu: { kind: "unavailable" },
  });
  expect(JSON.stringify(result?.["browserCpu"])).toContain("Page");
});

it("settles delayed headless exports and counts duplicate SQL spans and logs once", async () => {
  await using evidence = await evidenceSink();
  let polls = 0;
  await using collector = await fakeCollector((tagged) => {
    polls += 1;
    if (polls < 3) {
      return [];
    }
    const sql = {
      ...span("sql.execute", 2, { "db.query.text": "select 1" }),
      events: [{ name: "read complete", timeMs: 1, attributes: {} }],
    };
    return [...tagged.map(requestSpan), sql, sql];
  });
  const calls = new CallObserver();
  const measure = measurer(calls, evidence.sink, origin, scriptedProbe(), unexpectedBudgetFailure);

  await measure("delayed", () =>
    calls.call("services", "read", (traceparent) => {
      collector.tag(traceparent);
      return Promise.resolve();
    }),
  );

  const [sample] = await evidence.results();
  expect(sample?.["serverActivity"]).toMatchObject({
    kind: "captured",
    value: { sql: { statements: 1, totalMs: 2 }, logs: [{ message: "read complete" }] },
  });
});

it(
  "marks missing headless server export unavailable rather than zero work",
  { timeout: 10_000 },
  async () => {
    await using evidence = await evidenceSink();
    await using _collector = await fakeCollector(() => []);
    const calls = new CallObserver();
    const measure = measurer(
      calls,
      evidence.sink,
      origin,
      scriptedProbe(),
      unexpectedBudgetFailure,
    );

    await measure("missing", () => calls.call("mcp", "tools/call", () => Promise.resolve()));

    const [sample] = await evidence.results();
    expect(sample?.["serverActivity"]).toEqual({
      kind: "unavailable",
      reason: "Server spans arrived for 0 of 1 completed requests; server activity is incomplete.",
    });
  },
);

function span(
  name: string,
  durationMs: number,
  attributes: Readonly<Record<string, unknown>>,
): CollectedSpan {
  return {
    spanId: `${name}-${durationMs}`,
    name,
    startMs: 0,
    endMs: durationMs,
    durationMs,
    attributes,
  };
}

async function foreignInspector(): Promise<{
  url: string;
  [Symbol.asyncDispose]: () => Promise<void>;
}> {
  const child = spawn(
    process.execPath,
    ["--inspect=127.0.0.1:0", "-e", "setInterval(() => {}, 1000)"],
    {
      env: { ...process.env, VERIFICATION_DIR: "/another-run" },
      stdio: ["ignore", "ignore", "pipe"],
    },
  );
  let output = "";
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  await expect.poll(() => /ws:\/\/127\.0\.0\.1:(\d+)\//u.test(output)).toBe(true);
  const port = /ws:\/\/127\.0\.0\.1:(\d+)\//u.exec(output)?.[1];
  const exited = new Promise((resolve) => child.once("exit", resolve));
  return {
    url: `http://127.0.0.1:${port ?? ""}`,
    [Symbol.asyncDispose]: async () => {
      child.kill("SIGKILL");
      await exited;
    },
  };
}

function scopedEnvironment(values: Readonly<Record<string, string>>): {
  [Symbol.dispose]: () => void;
} {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]] as const),
  );
  Object.assign(process.env, values);
  return {
    [Symbol.dispose]: () => {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) {
          delete process.env[name];
        } else {
          process.env[name] = value;
        }
      }
    },
  };
}
