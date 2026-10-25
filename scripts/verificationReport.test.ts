import { existsSync } from "node:fs";
import { mkdtempDisposable, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { Schema } from "effect";
import { expect, it } from "vitest";

import { deliveryProblems, type Results } from "#e2e/verify/evidence.ts";
import { CallObserver, measurer, profiler } from "#e2e/verify/performance.ts";
import { MeasurementJson, ProfileJson } from "#e2e/verify/performanceEvidence.ts";
import { writeReport } from "#e2e/verify/report.ts";
import { ServiceCallJson } from "#e2e/verify/serviceEvidence.ts";

import {
  claims,
  criterion,
  runDirectory,
  passingAttempt,
  passingResults,
  scriptedPage,
  evidenceSink,
  scriptedProbe,
  unexpectedBudgetFailure,
  scriptedSession,
  fakeCollector,
  requestSpan,
  origin,
} from "./verificationTest.ts";

it("writes a report that marks a run NOT READY and embeds its screenshots", async () => {
  const cited = criterion({ artifacts: ["persisted.png"] });
  await using run = await runDirectory(claims([cited]));
  await writeFile(join(run.directory, "persisted.png"), Buffer.from("not really a png"));

  await writeReport(run.directory, [
    "The source changed during the run, so evidence has no stable source identity; rerun bun run verify without editing until cleanup completes.",
  ]);

  const html = await readFile(join(run.directory, "report.html"), "utf8");
  const markdown = await readFile(join(run.directory, "report.md"), "utf8");
  expect(markdown).toContain("# Application verification:");
  expect(html).toContain("<title>Application verification:");
  expect(markdown).toContain("Delivery gate: NOT READY");
  expect(markdown).toContain("The source changed during the run");
  expect(html).toContain(
    `src="data:image/png;base64,${Buffer.from("not really a png").toString("base64")}"`,
  );
});

it("labels service citations and correlates their application runtime spans in both reports", async () => {
  const title = "Action (services) [owner]: create";
  const name = "Service call 1: create";
  const results = {
    ...passingResults,
    attempts: [
      {
        ...passingAttempt,
        steps: [{ ...passingAttempt.steps[1], title, serviceCalls: [name], personas: ["owner"] }],
        attachments: [{ name, path: "service.json" }],
      },
    ],
  };
  await using run = await runDirectory(
    claims([criterion({ assertions: [{ test: passingAttempt.title, step: title }] })]),
    { "results.json": results },
  );
  await writeFile(
    join(run.directory, "service.json"),
    JSON.stringify({
      phase: "Action",
      description: "create",
      traceId: "service-trace",
      execution: "application",
      persona: "owner",
      program: "createNote",
      arguments: {},
      outcome: { status: "succeeded", result: { title: "Saved" } },
    }),
  );
  await writeFile(
    join(run.directory, "server-spans.jsonl"),
    JSON.stringify({ traceId: "service-trace", name: "verification.service", attributes: {} }),
  );

  expect(await deliveryProblems(run.directory)).toEqual([]);
  await writeReport(run.directory, []);

  for (const file of ["report.md", "report.html"]) {
    const report = await readFile(join(run.directory, file), "utf8");
    expect(report).toContain("includes service calls");
    expect(report).toContain("Saved");
    expect(report).toContain("Correlated server spans: verification.service");
    expect(report).toContain("Node server");
    expect(report).toContain("personas: owner");
    expect(report).toContain("#service-1");
  }

  const call = Schema.decodeUnknownSync(ServiceCallJson)(
    await readFile(join(run.directory, "service.json"), "utf8"),
  );
  await writeFile(
    join(run.directory, "service.json"),
    JSON.stringify({ ...call, persona: "other" }),
  );
  expect((await deliveryProblems(run.directory)).join(" ")).toContain(
    "not attached to its service phase step",
  );

  await writeFile(
    join(run.directory, "results.json"),
    JSON.stringify({ ...results, attempts: [{ ...results.attempts[0], steps: [] }] }),
  );
  expect((await deliveryProblems(run.directory)).join(" ")).toContain(
    "not attached to its service phase step",
  );

  await writeFile(join(run.directory, "service.json"), "{}");
  expect((await deliveryProblems(run.directory)).join(" ")).toContain("service.json");
});

it("renders step-linked MCP transcripts in both reports", async () => {
  const results = {
    ...passingResults,
    attempts: [
      {
        ...passingAttempt,
        steps: [
          {
            ...passingAttempt.steps[0],
            title: "Setup (mcp): discovery",
            mcpExchanges: ["MCP exchange 1: tools/call"],
          },
          {
            ...passingAttempt.steps[1],
            title: "Result: MCP list",
            mcpExchanges: ["MCP exchange 1: tools/call"],
          },
        ],
        attachments: [{ name: "MCP exchange 1: tools/call", path: "exchange.json" }],
      },
    ],
  };
  const matrix = claims([
    criterion({ assertions: [{ test: "adds a note", step: "Result: MCP list" }] }),
  ]);
  await using run = await runDirectory(matrix, { "results.json": results });
  await writeFile(
    join(run.directory, "exchange.json"),
    JSON.stringify({
      persona: "owner",
      method: "POST",
      url: "https://app.test/mcp",
      rpcMethod: "tools/call",
      tool: "list_notes",
      arguments: {},
      traceId: "trace-1",
      request: { body: { method: "tools/call" } },
      status: 200,
      response: { body: { result: { notes: [{ title: "Protocol evidence" }] } } },
    }),
  );
  await writeFile(
    join(run.directory, "server-spans.jsonl"),
    JSON.stringify({ traceId: "trace-1", name: "mcp.request", attributes: {} }),
  );

  await writeReport(run.directory, []);

  for (const name of ["report.md", "report.html"]) {
    const report = await readFile(join(run.directory, name), "utf8");
    expect(report).toContain("Protocol evidence");
    expect(report).toContain("Correlated server spans: mcp.request");
    expect(report).toContain("includes MCP exchanges");
    expect(report).toContain("Non-setup steps with MCP exchanges");
    expect(report).not.toContain("Declared proof surfaces");
    expect(report).not.toContain("Setup (mcp): discovery");
    expect(report).toContain("e2e-test");
    expect(report).toContain(
      "PublicInternet test routing and an authenticated verification-only service route differ from a deployable build",
    );
    expect(report).toContain("list_notes");
    expect(report).toContain("#mcp-1");
    expect(report).toContain("200");
  }
});

it("removes the run directory when artifact setup rejects", async () => {
  try {
    await using run = await runDirectory(claims([criterion()]), { "missing/file.json": {} });
    expect.unreachable(`Setup unexpectedly succeeded in ${run.directory}`);
  } catch (error) {
    const failure = Schema.decodeUnknownSync(
      Schema.Struct({ code: Schema.Literal("ENOENT"), path: Schema.String }),
    )(error);

    expect(existsSync(dirname(dirname(failure.path)))).toBe(false);
  }
});

it("never embeds an artifact from outside the run in its report", async () => {
  await using outside = await mkdtempDisposable(join(tmpdir(), "verification-outside-"));
  await writeFile(join(outside.path, "private.png"), "private");
  await using run = await runDirectory(claims([criterion({ artifacts: ["linked.png"] })]));
  await symlink(join(outside.path, "private.png"), join(run.directory, "linked.png"));

  const problems = await deliveryProblems(run.directory);
  await writeReport(run.directory, problems);

  const html = await readFile(join(run.directory, "report.html"), "utf8");
  expect(problems).toContainEqual(expect.stringContaining("linked.png"));
  expect(html).not.toContain(Buffer.from("private").toString("base64"));
});

it("replaces a ready report when the evidence later becomes invalid", async () => {
  await using run = await runDirectory(claims([criterion()]));
  await writeReport(run.directory, []);
  await writeFile(join(run.directory, "claims.json"), "not JSON");

  await writeReport(run.directory, await deliveryProblems(run.directory));

  const markdown = await readFile(join(run.directory, "report.md"), "utf8");
  expect(markdown).toContain("Delivery gate: NOT READY");
  expect(markdown).not.toContain("Delivery gate: READY");
});

it("keeps an artifact's name as text in the report's HTML", async () => {
  const name = 'shot" onload="alert(1)" data-x=".png';
  await using run = await runDirectory(claims([criterion({ artifacts: [name] })]));
  await writeFile(join(run.directory, name), "image");

  await writeReport(run.directory, []);

  const html = await readFile(join(run.directory, "report.html"), "utf8");
  expect(html).not.toContain('onload="alert(1)"');
  expect(html).toContain("shot&quot; onload=&quot;alert(1)&quot;");
});

it("tabulates database statements, query plans, server logs, and the application's telemetry", async () => {
  const results: Results = {
    verdict: "passed",
    attempts: [
      {
        ...passingAttempt,
        attachments: [
          { name: "measurement: list #1", path: "measurement.json" },
          { name: "query plans: list-1", path: "plans.json" },
        ],
      },
    ],
  };
  await using run = await runDirectory(claims([criterion()]), { "results.json": results });
  await writeFile(
    join(run.directory, "measurement.json"),
    JSON.stringify({
      name: "list",
      sample: 1,
      outcome: "completed",
      durationMs: 120,
      conditions: [],
      requests: ["GET page /notes"],
      serverActivity: {
        kind: "captured",
        value: {
          operations: [{ name: "notes.list success", calls: 1, totalMs: 20, maxMs: 20 }],
          sql: { statements: 1, totalMs: 4, slowest: [] },
          unresolvedRequests: [],
          logs: [{ atMs: 2, level: "WARN", message: "Slow list", span: "notes.list" }],
          errors: [],
        },
      },
      databaseActivity: {
        kind: "captured",
        value: {
          totals: { statements: 1, distinct: 1, totalMs: 3.2 },
          statements: [
            {
              query: "select * from note where owner = $1",
              calls: 1,
              totalMs: 3.2,
              meanMs: 3.2,
              rows: 150,
              sharedBlocksHit: 12,
              sharedBlocksRead: 0,
            },
          ],
          plans: [
            {
              query: "select * from note where owner = 'u1'",
              plan: "Sort → Seq Scan on note",
              executions: 1,
              totalMs: 3.1,
              maxRows: 150,
              sequentialScans: ["note"],
            },
          ],
          plansAttachment: "query plans: list-1",
        },
      },
    }),
  );
  await writeFile(
    join(run.directory, "server-spans.jsonl"),
    [
      {
        name: "telemetry.client_report",
        attributes: { "app.outcome": "failure", "error.type": "ui.slow_interaction" },
      },
      { name: "notes.update", attributes: {}, error: "NoteNotFound" },
    ]
      .map((span) => JSON.stringify(span))
      .join("\n"),
  );

  await writeReport(run.directory, []);

  const markdown = await readFile(join(run.directory, "report.md"), "utf8");
  expect(markdown).toContain(
    "| `select * from note where owner = $1` | 1 | 3.2 ms | 3.2 ms | 150 | 12 | 0 |",
  );
  expect(markdown).toContain("| Sort → Seq Scan on note | 1 | 3.1 ms | 150 | note |");
  expect(markdown).toContain("| WARN | Slow list | notes.list | 1 |");
  expect(markdown).toContain(
    "| telemetry.client_report | failure | error.type=ui.slow_interaction |",
  );
  expect(markdown).toContain("| notes.update | NoteNotFound | 1 |");
  expect(markdown).toContain("Full query plans: plans.json");
  const html = await readFile(join(run.directory, "report.html"), "utf8");
  expect(html).toContain("<code>select * from note where owner = $1</code>");
});

it("counts samples where an operation did not run as zero in its median", async () => {
  const sample = (
    index: number,
    operations: ReadonlyArray<object>,
  ): {
    name: string;
    sample: number;
    outcome: string;
    databaseActivity: {
      kind: string;
      reason: string;
    };
    durationMs: number;
    conditions: never[];
    requests: never[];
    serverActivity: {
      kind: string;
      value: {
        operations: readonly object[];
        sql: {
          statements: number;
          totalMs: number;
          slowest: never[];
        };
        unresolvedRequests: never[];
        logs: never[];
        errors: never[];
      };
    };
  } => ({
    name: "open",
    sample: index,
    outcome: "completed",
    databaseActivity: { kind: "unavailable", reason: "not collected" },
    durationMs: 100,
    conditions: [],
    requests: [],
    serverActivity: {
      kind: "captured",
      value: {
        operations,
        sql: { statements: 0, totalMs: 0, slowest: [] },
        unresolvedRequests: [],
        logs: [],
        errors: [],
      },
    },
  });
  const files = [
    sample(1, []),
    sample(2, []),
    sample(3, [{ name: "rare operation", calls: 1, totalMs: 90, maxMs: 90 }]),
  ];
  const results: Results = {
    verdict: "passed",
    attempts: [
      {
        ...passingAttempt,
        attachments: files.map((_, index) => ({
          name: `measurement: open #${index + 1}`,
          path: `measurement-${index + 1}.json`,
        })),
      },
    ],
  };
  await using run = await runDirectory(claims([criterion()]), { "results.json": results });
  for (const [index, file] of files.entries()) {
    await writeFile(join(run.directory, `measurement-${index + 1}.json`), JSON.stringify(file));
  }

  await writeReport(run.directory, []);

  const markdown = await readFile(join(run.directory, "report.md"), "utf8");
  expect(markdown).toContain("| rare operation | 1 of 3 | 1 | 0 ms | 90 ms |");
});

it("leads repeated samples with their median, and keeps different budgets apart", async () => {
  const sample = (
    index: number,
    durationMs: number,
    budgetMs: number,
  ): {
    name: string;
    sample: number;
    outcome: string;
    databaseActivity: {
      kind: string;
      reason: string;
    };
    durationMs: number;
    budgetMs: number;
    conditions: never[];
    requests: never[];
    serverActivity: {
      kind: string;
      reason: string;
    };
  } => ({
    name: "save",
    sample: index,
    outcome: "completed",
    databaseActivity: { kind: "unavailable", reason: "not collected" },
    durationMs,
    budgetMs,
    conditions: [],
    requests: [],
    serverActivity: { kind: "unavailable", reason: "not collected" },
  });
  const files = [sample(1, 100, 500), sample(2, 900, 500), sample(3, 200, 100)];
  const results: Results = {
    verdict: "passed",
    attempts: [
      {
        ...passingAttempt,
        attachments: files.map((_, index) => ({
          name: `measurement: save #${index + 1}`,
          path: `measurement-${index + 1}.json`,
        })),
      },
    ],
  };
  await using run = await runDirectory(claims([criterion()]), { "results.json": results });
  for (const [index, file] of files.entries()) {
    await writeFile(join(run.directory, `measurement-${index + 1}.json`), JSON.stringify(file));
  }

  await writeReport(run.directory, []);

  const markdown = await readFile(join(run.directory, "report.md"), "utf8");
  expect(markdown).toContain(
    "| save | adds a note | measurement | 2 | 500 ms | 100–900 ms | 1 of 2 over 500 ms |",
  );
  expect(markdown).toContain("| 3 | 200 ms (OVER 100 ms) |");
});

it("round-trips produced measurements and profiles into reports, including unavailable and partial evidence", async () => {
  await using evidence = await evidenceSink();
  await using collector = await fakeCollector((tagged) => [requestSpan(tagged[0] ?? "")]);
  const page = scriptedPage();
  const measure = measurer(page, evidence.sink, origin, scriptedProbe(), unexpectedBudgetFailure);

  await measure("partial save", async () => {
    await page.request("/_serverFn/a", collector.tag);
    await page.request("/_serverFn/b", collector.tag, "cancelled");
  });
  const unavailableMeasure = measurer(
    scriptedPage({ routeFails: true }),
    evidence.sink,
    origin,
    {
      observe: () => Promise.reject(new Error("database unavailable")),
    },
    unexpectedBudgetFailure,
  );
  await expect(unavailableMeasure("unavailable save", () => Promise.resolve())).rejects.toThrow(
    "route failed",
  );
  const profile = profiler(
    scriptedPage(),
    evidence.sink,
    origin,
    () => Promise.resolve(scriptedSession()),
    scriptedProbe(),
  );
  await profile("profile save", () => Promise.resolve());
  const calls = new CallObserver();
  const headless = measurer(calls, evidence.sink, origin, scriptedProbe(), unexpectedBudgetFailure);
  await headless("service read", () =>
    calls.call("services", "readNotes", (traceparent) => {
      collector.tag(traceparent);
      return Promise.resolve();
    }),
  );

  const partial = Schema.decodeSync(MeasurementJson)(
    await evidence.attachment("measurement: partial save #1"),
  );
  const unavailable = Schema.decodeSync(MeasurementJson)(
    await evidence.attachment("measurement: unavailable save #1"),
  );
  const profiled = Schema.decodeSync(ProfileJson)(
    await evidence.attachment("profile: profile save #1"),
  );
  expect(partial.serverActivity).toMatchObject({
    kind: "captured",
    value: { unresolvedRequests: ["GET server function"] },
  });
  expect(unavailable.serverActivity.kind).toBe("unavailable");
  expect(unavailable.databaseActivity.kind).toBe("unavailable");
  expect(profiled.browserCpu.kind).toBe("captured");
  const results: Results = {
    verdict: "passed",
    attempts: [
      {
        title: "saves notes",
        status: "passed",
        expectedStatus: "passed",
        steps: [],
        attachments: evidence.attachments(),
      },
    ],
  };
  await writeFile(join(evidence.folder, "results.json"), JSON.stringify(results));

  await writeReport(evidence.folder, []);

  for (const file of ["report.md", "report.html"]) {
    const report = await readFile(join(evidence.folder, file), "utf8");
    expect(report).toContain("partial save");
    expect(report.replaceAll("&#39;", "'")).toContain(
      "Condition: Application requests were intercepted to tag them with a trace, which disables the page's HTTP cache.",
    );
    expect(report).toContain("server activity PARTIAL");
    expect(report).toContain("server activity unavailable");
    expect(report).toContain("database activity unavailable: database unavailable");
    expect(report).toContain("profile save");
    expect(report).toContain("Client-observed calls");
    expect(report).toContain("readNotes");
    expect(report).toContain("Parent span ID");
    expect(report).toContain("Full evidence (backend spans:");
    expect(report).toContain("Full evidence (database statements:");
    expect(report).not.toContain("missing or unreadable");
  }
});
