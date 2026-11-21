import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import jsonTools from "@lineupkeep/backend/runtime/JsonText";
import { EffectString } from "@lineupkeep/collections";
import { Option, Schema } from "effect";
import { Array as EffectArray } from "effect";
import { Order as EffectOrder } from "effect";
import { Option as EffectOption } from "effect";

import { ClaimsJson, resolveArtifact, ResultsJson } from "./evidence.ts";
import type { Claims, Results } from "./evidence.ts";
import { isMcpExchangeAttachment, McpExchangeJson } from "./mcpEvidence.ts";
import { Cpu, MeasurementJson, ProfileJson } from "./performanceEvidence.ts";
import type { DatabaseSummary, SpanGroup, PlanGroup } from "./performanceEvidence.ts";
import { isServiceCallAttachment, ServiceCallJson } from "./serviceEvidence.ts";

function sortWithComparator<A>(
  self: ReadonlyArray<A>,
  compare: (left: A, right: A) => number,
): ReadonlyArray<A> {
  return EffectArray.sort(
    self,
    EffectOrder.make<A>((left, right) => {
      const result = compare(left, right);
      return result < 0 ? -1 : result > 0 ? 1 : 0;
    }),
  );
}

function optionalArrayValue<A extends ReadonlyArray<unknown>, B>(value: A, f: (value: A) => B): B;
function optionalArrayValue<A extends ReadonlyArray<unknown>, B>(
  value: A | null | undefined,
  f: (value: A) => B,
): B | undefined;
function optionalArrayValue<A extends ReadonlyArray<unknown>, B>(
  value: A | null | undefined,
  f: (value: A) => B,
): B | undefined {
  return value === undefined || value === null ? undefined : f(value);
}

function arrayValueIsArray<A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> {
  return EffectArray.isArray(value);
}

export async function writeReport(
  directory: string,
  problems: ReadonlyArray<string>,
): Promise<void> {
  await rm(join(directory, "report.md"), { force: true });
  await rm(join(directory, "report.html"), { force: true });
  const model = await reportModel(directory, problems);
  const blocks = reportBlocks(model, directory);
  await writeFile(join(directory, "report.md"), renderMarkdown(blocks));
  await writeFile(join(directory, "report.html"), await renderHtml(blocks, model, directory));
}

async function reportModel(
  directory: string,
  problems: ReadonlyArray<string>,
): Promise<ReportModel> {
  const read = async <A>(name: string, schema: Schema.Codec<A, string>): Promise<A | undefined> => {
    const path = resolveArtifact(directory, name);
    return path === undefined
      ? undefined
      : Option.getOrUndefined(Schema.decodeOption(schema)(await readFile(path, "utf8")));
  };
  const results = await read("results.json", ResultsJson);
  const performance = await Promise.all(
    optionalArrayValue(results?.attempts ?? [], (value) =>
      EffectArray.flatMap(value, (attempt) => {
        const flatMapped1 = EffectArray.map(
          EffectArray.filter(
            attempt.attachments,
            (attachment) =>
              EffectString.startsWith(attachment.name, "measurement: ") ||
              EffectString.startsWith(attachment.name, "profile: "),
          ),
          async (attachment) => ({
            test: attempt.title,
            kind: EffectString.startsWith(attachment.name, "profile: ")
              ? ("profile" as const)
              : ("measurement" as const),
            file: attachment.path,
            attachments: attempt.attachments,
            result: EffectString.startsWith(attachment.name, "profile: ")
              ? await read(attachment.path, ProfileJson)
              : await read(attachment.path, MeasurementJson).then((result) =>
                  result === undefined
                    ? undefined
                    : { ...result, browserCpu: undefined, serverCpu: undefined },
                ),
          }),
        );
        return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
      }),
    ),
  );
  const spansPath = resolveArtifact(directory, "server-spans.jsonl");
  const spans =
    spansPath === undefined
      ? undefined
      : EffectArray.flatMap(EffectString.split(await readFile(spansPath, "utf8"), "\n"), (line) => {
          const flatMapped1 = Option.toArray(Schema.decodeOption(SpanLine)(line));
          return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
        });
  return {
    ready: problems.length === 0,
    problems,
    run: await read("run.json", RunJson),
    doctor: await read("doctor.json", DoctorJson),
    claims: await read("claims.json", ClaimsJson),
    results,
    cleanup: await read("cleanup.json", CleanupJson),
    performance,
    exchanges: await Promise.all(
      optionalArrayValue(results?.attempts ?? [], (value) =>
        EffectArray.flatMap(value, (attempt) => {
          const flatMapped2 = EffectArray.map(
            EffectArray.filter(attempt.attachments, isMcpExchangeAttachment),
            async (attachment) => ({
              test: attempt.title,
              name: attachment.name,
              file: attachment.path,
              exchange: await read(attachment.path, McpExchangeJson),
            }),
          );
          return arrayValueIsArray(flatMapped2) ? flatMapped2 : [flatMapped2];
        }),
      ),
    ),
    serviceCalls: await Promise.all(
      optionalArrayValue(results?.attempts ?? [], (value) =>
        EffectArray.flatMap(value, (attempt) => {
          const flatMapped3 = EffectArray.map(
            EffectArray.filter(attempt.attachments, isServiceCallAttachment),
            async (attachment) => ({
              test: attempt.title,
              name: attachment.name,
              file: attachment.path,
              call: await read(attachment.path, ServiceCallJson),
            }),
          );
          return arrayValueIsArray(flatMapped3) ? flatMapped3 : [flatMapped3];
        }),
      ),
    ),
    spans,
    video: existsSync(join(directory, "walkthrough.mp4")) ? "walkthrough.mp4" : undefined,
  };
}

function reportBlocks(model: ReportModel, directory: string): ReadonlyArray<Block> {
  const criteria = model.claims?.criteria ?? [];
  return [
    heading(1, `Application verification: ${model.claims?.request ?? "unclaimed run"}`),
    {
      kind: "verdict",
      ready: model.ready,
      text: `${model.ready ? "Delivery gate: READY. The claims below are consistent with this run's evidence." : "Delivery gate: NOT READY. Do not present these results as verified until the problems below are resolved."} Criteria: ${statusCounts(model)}.`,
    },
    list(model.problems),
    table(
      ["Criterion", "Status", "Statement"],
      EffectArray.map(criteria, (criterion) => [
        criterion.id,
        status(criterion.status),
        criterion.statement,
      ]),
    ),
    heading(2, "Run"),
    table(["", ""], runRows(model)),
    heading(2, "Criteria"),
    ...EffectArray.flatMap(criteria, (criterion) => {
      const flatMapped2 = [
        heading(3, `${criterion.id} — ${EffectString.toUpperCase(criterion.status)}`),
        paragraph(criterion.statement),
        paragraph(`Observed: ${criterion.observation}`),
        table(
          ["Asserted in", "Status"],
          EffectArray.map(criterion.assertions, (assertion) => [
            citationText(assertion),
            stepStatus(model, assertion),
          ]),
        ),
        ...EffectArray.map(
          [
            ...citedAttachments(model, criterion, "mcp"),
            ...citedAttachments(model, criterion, "service"),
          ],
          (exchange): Block => ({
            kind: "link",
            text: exchange.name,
            href: exchange.anchor,
          }),
        ),
        ...EffectArray.map(criterion.artifacts, (artifact): Block =>
          resolveArtifact(directory, artifact) === undefined
            ? paragraph(`Rejected artifact (not a file inside this run): ${artifact}`)
            : extname(artifact) === ".png"
              ? { kind: "image", artifact, alt: criterion.id }
              : paragraph(`Artifact: ${artifact}`),
        ),
      ];
      return arrayValueIsArray(flatMapped2) ? flatMapped2 : [flatMapped2];
    }),
    heading(2, "Limitations"),
    list(model.claims?.limitations ?? []),
    heading(2, "Tests"),
    table(
      ["Test", "Status", "Steps"],
      optionalArrayValue(model.results?.attempts ?? [], (value) =>
        EffectArray.map(value, (attempt) => [
          attempt.title,
          status(attempt.status),
          String(attempt.steps.length),
        ]),
      ),
    ),
    ...phaseBlocks(model),
    ...mcpBlocks(model),
    ...serviceBlocks(model),
    ...performanceBlocks(model.performance),
    ...telemetryBlocks(model),
  ];
}

function citedAttachments(
  model: ReportModel,
  criterion: Claims["criteria"][number],
  kind: "mcp" | "service",
): ReadonlyArray<{ readonly name: string; readonly anchor: string }> {
  const citations = EffectArray.map(criterion.assertions, (assertion) => {
    const attempt = optionalArrayValue(model.results?.attempts, (value) =>
      EffectOption.getOrUndefined(
        EffectArray.findFirst(value, (candidate) => candidate.title === assertion.test),
      ),
    );
    const steps = EffectArray.filter(
      attempt?.steps ?? [],
      (step) => assertion.step === undefined || step.title === assertion.step,
    );
    return {
      test: assertion.test,
      names: new Set(
        assertion.step === undefined
          ? EffectArray.map(
              EffectArray.filter(
                attempt?.attachments ?? [],
                kind === "mcp" ? isMcpExchangeAttachment : isServiceCallAttachment,
              ),
              (attachment) => attachment.name,
            )
          : EffectArray.flatMap(
              steps,
              (step) => (kind === "mcp" ? step.mcpExchanges : step.serviceCalls) ?? [],
            ),
      ),
    };
  });
  const entries: ReadonlyArray<{ readonly test: string; readonly name: string }> =
    kind === "mcp" ? model.exchanges : model.serviceCalls;
  return EffectArray.flatMap(entries, (exchange, index) => {
    return EffectArray.some(
      citations,
      (citation) => citation.test === exchange.test && citation.names.has(exchange.name),
    )
      ? [{ name: exchange.name, anchor: `#${kind}-${index + 1}` }]
      : [];
  });
}

function mcpBlocks(model: ReportModel): ReadonlyArray<Block> {
  if (model.exchanges.length === 0) {
    return [];
  }
  return [
    heading(2, "MCP exchanges"),
    heading(3, "Non-setup steps with MCP exchanges"),
    table(
      ["Test", "Step", "Exchanges"],
      optionalArrayValue(model.results?.attempts ?? [], (value) =>
        EffectArray.flatMap(value, (attempt) => {
          const flatMapped4 = optionalArrayValue(
            EffectArray.filter(
              attempt.steps,
              (step) =>
                !EffectString.startsWith(step.title, "Setup") &&
                (step.mcpExchanges?.length ?? 0) > 0,
            ),
            (value) =>
              EffectArray.map(value, (step) => [
                attempt.title,
                step.title,
                String(step.mcpExchanges?.length),
              ]),
          );
          return arrayValueIsArray(flatMapped4) ? flatMapped4 : [flatMapped4];
        }),
      ),
    ),
    ...EffectArray.flatMap(model.exchanges, (entry, index): ReadonlyArray<Block> => {
      const exchange = entry.exchange;
      const spans =
        optionalArrayValue(model.spans, (value) =>
          EffectArray.filter(value, (span) => span.traceId === exchange?.traceId),
        ) ?? [];
      return [
        {
          kind: "transcript",
          id: `mcp-${index + 1}`,
          text: `${entry.test} — ${entry.name}\nArtifact: ${entry.file}\n${exchange === undefined ? "Missing or invalid transcript" : jsonTools.jsonString(exchange, null, 2)}`,
        },
        paragraph(
          spans.length === 0
            ? "Server spans unavailable for this exchange (not proof of zero server work)."
            : `Correlated server spans: ${EffectArray.join(
                EffectArray.map(spans, (span) => span.name),
                ", ",
              )}`,
        ),
      ];
    }),
  ];
}

function serviceBlocks(model: ReportModel): ReadonlyArray<Block> {
  if (model.serviceCalls.length === 0) {
    return [];
  }
  return [
    heading(2, "Service calls"),
    paragraph(
      "Named service programs execute through a test-build-only authenticated route in the target application: the Node server (plain or containerized) or Cloudflare workerd. They use the application's production services, request context, and exported spans; they do not prove browser/MCP adapter behavior or background scheduling.",
    ),
    heading(3, "Non-setup steps with service calls"),
    table(
      ["Test", "Step", "Calls"],
      optionalArrayValue(model.results?.attempts ?? [], (value) =>
        EffectArray.flatMap(value, (attempt) => {
          const flatMapped5 = optionalArrayValue(
            EffectArray.filter(
              attempt.steps,
              (step) =>
                !EffectString.startsWith(step.title, "Setup") &&
                (step.serviceCalls?.length ?? 0) > 0,
            ),
            (value) =>
              EffectArray.map(value, (step) => [
                attempt.title,
                step.title,
                String(step.serviceCalls?.length),
              ]),
          );
          return arrayValueIsArray(flatMapped5) ? flatMapped5 : [flatMapped5];
        }),
      ),
    ),
    ...EffectArray.flatMap(model.serviceCalls, (entry, index): ReadonlyArray<Block> => {
      const spans =
        optionalArrayValue(model.spans, (value) =>
          EffectArray.filter(value, (span) => span.traceId === entry.call?.traceId),
        ) ?? [];
      return [
        {
          kind: "transcript",
          id: `service-${index + 1}`,
          text: `${entry.test} — ${entry.name}\nArtifact: ${entry.file}\n${entry.call === undefined ? "Missing or invalid service evidence" : jsonTools.jsonString(entry.call, null, 2)}`,
        },
        paragraph(
          spans.length === 0
            ? "Application server spans unavailable for this service call (not proof of zero work)."
            : `Correlated server spans: ${EffectArray.join(
                EffectArray.map(spans, (span) => span.name),
                ", ",
              )}`,
        ),
      ];
    }),
  ];
}

function runRows(model: ReportModel): Array<Array<Cell>> {
  const run = model.run;
  if (run === undefined) {
    return [["run.json", "missing"]];
  }
  return [
    ["Run", run.runId],
    ["Started", run.startedAt],
    ["Target", run.target],
    ...(model.serviceCalls.length > 0
      ? [
          [
            "Service execution",
            `Target application (${run.target === "cloudflare" ? "workerd" : run.target === "container" ? "containerized Node server" : "Node server"})`,
          ],
        ]
      : []),
    ["Composition", run.composition ?? "not recorded"],
    ...(run.servicePrograms === undefined ? [] : [["Service programs", run.servicePrograms]]),
    [
      "Build difference",
      "PublicInternet test routing and an authenticated verification-only service route differ from a deployable build; never deploy this build.",
    ],
    [
      "Source",
      `${run.versionControl ?? "git"} revision ${run.revision}${run.workingTree === "" ? "" : ", with working-copy changes (source.patch)"}`,
    ],
    ["Fingerprint", run.sourceFingerprint],
    [
      "Selection",
      EffectArray.join(
        [
          ...run.selection.files,
          ...(run.selection.grep === undefined ? [] : [`--grep ${run.selection.grep}`]),
        ],
        " ",
      ) || "all committed tests",
    ],
    ["Application", model.doctor?.origin ?? "not recorded"],
    ["Database", model.doctor?.databaseName ?? "not recorded"],
    ["Automated verdict", model.results?.verdict ?? "no results"],
    ["Video", model.video ?? (run.video ? "recorded, not rendered" : "not recorded")],
  ];
}

function phaseBlocks(model: ReportModel): ReadonlyArray<Block> {
  const cleanup = model.cleanup;
  if (cleanup === undefined) {
    return [heading(2, "Phases and cleanup"), paragraph("cleanup.json is missing.")];
  }
  return [
    heading(2, "Phases"),
    ...(cleanup.recoveredRun === undefined
      ? []
      : [paragraph(`Recovered abandoned run ${cleanup.recoveredRun} before starting.`)]),
    table(
      ["Phase", "Status", "Duration"],
      EffectArray.map(cleanup.commands, (command) => [
        command.name,
        status(command.status),
        `${(command.durationMs / 1000).toFixed(1)} s`,
      ]),
    ),
    heading(2, "Cleanup"),
    paragraph(cleanup.cleanupComplete ? "Cleanup complete." : "Cleanup INCOMPLETE."),
    table(
      ["Step", "Status", "Detail"],
      EffectArray.map(cleanup.steps, (step) => [step.name, status(step.status), step.detail ?? ""]),
    ),
  ];
}

function performanceBlocks(entries: ReadonlyArray<PerformanceEntry>): ReadonlyArray<Block> {
  if (entries.length === 0) {
    return [];
  }
  const groups = new Map<string, Array<PerformanceEntry>>();
  for (const entry of entries) {
    const key = `${entry.kind}\n${entry.test}\n${entry.result?.name ?? entry.file}\n${entry.result?.budgetMs ?? "none"}`;
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  const summaries = EffectArray.map([...groups.values()], groupSummary);
  return [
    heading(2, "Performance"),
    paragraph(performanceNote),
    list(
      optionalArrayValue(
        [
          ...new Set(
            EffectArray.flatMap(entries, (entry) => {
              const flatMapped4 = entry.result?.conditions ?? [];
              return arrayValueIsArray(flatMapped4) ? flatMapped4 : [flatMapped4];
            }),
          ),
        ],
        (value) => EffectArray.map(value, (condition) => `Condition: ${condition}`),
      ),
    ),
    table(
      ["Interaction", "Test", "Kind", "Samples", "Median", "Range", "Budget"],
      EffectArray.map(summaries, (summary) => [
        summary.name,
        summary.test,
        summary.kind,
        String(summary.durations.length),
        summary.median === undefined ? "" : `${summary.median} ms`,
        summary.durations.length === 0
          ? ""
          : `${Math.min(...summary.durations)}–${Math.max(...summary.durations)} ms`,
        summary.budget === undefined
          ? ""
          : `${summary.over} of ${summary.durations.length} over ${summary.budget} ms`,
      ]),
    ),
    ...EffectArray.flatMap(summaries, groupBlocks),
  ];
}

function groupSummary(samples: ReadonlyArray<PerformanceEntry>): GroupSummary {
  const [first] = samples;
  const durations = EffectArray.flatMap(samples, (sample) => {
    const flatMapped5 = sample.result === undefined ? [] : [sample.result.durationMs];
    return arrayValueIsArray(flatMapped5) ? flatMapped5 : [flatMapped5];
  });
  const budget = first?.result?.budgetMs;
  return {
    name: first?.result?.name ?? "unreadable result",
    test: first?.test ?? "",
    kind: first?.kind === "profile" ? "profile" : "measurement",
    durations,
    median: durations.length === 0 ? undefined : median(durations),
    budget,
    over:
      budget === undefined
        ? 0
        : EffectArray.filter(durations, (duration) => duration > budget).length,
    samples,
  };
}

function groupBlocks(group: GroupSummary): ReadonlyArray<Block> {
  const results = EffectArray.flatMap(group.samples, (sample) => {
    const flatMapped6 = sample.result === undefined ? [] : [sample.result];
    return arrayValueIsArray(flatMapped6) ? flatMapped6 : [flatMapped6];
  });
  const servers = EffectArray.flatMap(results, (result) => {
    const flatMapped7 =
      result.serverActivity.kind === "captured" ? [result.serverActivity.value] : [];
    return arrayValueIsArray(flatMapped7) ? flatMapped7 : [flatMapped7];
  });
  const databases = EffectArray.flatMap(results, (result) => {
    const flatMapped8 =
      result.databaseActivity.kind === "captured" ? [result.databaseActivity.value] : [];
    return arrayValueIsArray(flatMapped8) ? flatMapped8 : [flatMapped8];
  });
  const notes = [
    ...(group.durations.length >= 2 && group.kind === "profile"
      ? ["Profiled durations include profiler overhead and are not comparable with measurements."]
      : []),
    ...EffectArray.flatMap(group.samples, (sample) => {
      const flatMapped9 =
        sample.result === undefined
          ? [`A result file is missing or unreadable: ${sample.file}`]
          : [];
      return arrayValueIsArray(flatMapped9) ? flatMapped9 : [flatMapped9];
    }),
    ...EffectArray.flatMap(results, (result) => {
      const flatMapped10 = [
        ...(result.serverActivity.kind === "unavailable"
          ? [
              `Sample ${result.sample}: server activity unavailable: ${result.serverActivity.reason}`,
            ]
          : result.serverActivity.value.unresolvedRequests.length === 0
            ? []
            : [
                `Sample ${result.sample}: server activity PARTIAL: totals exclude ${result.serverActivity.value.unresolvedRequests.length} cancelled request(s) whose server work is unknown: ${EffectArray.join(result.serverActivity.value.unresolvedRequests, ", ")}`,
              ]),
        ...(result.databaseActivity.kind === "unavailable"
          ? [
              `Sample ${result.sample}: database activity unavailable: ${result.databaseActivity.reason}`,
            ]
          : []),
        ...EffectArray.flatMap([result.browserCpu, result.serverCpu], (cpu, index) => {
          const flatMapped1 =
            cpu?.kind === "unavailable"
              ? [
                  `Sample ${result.sample}: ${index === 0 ? "browser" : "server"} CPU unavailable: ${cpu.reason}`,
                ]
              : [];
          return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
        }),
      ];
      return arrayValueIsArray(flatMapped10) ? flatMapped10 : [flatMapped10];
    }),
  ];
  return [
    heading(
      3,
      `${group.kind === "profile" ? "Profile" : "Measurement"} "${group.name}" in "${group.test}"`,
    ),
    list(notes),
    table(
      [
        "Sample",
        "Duration",
        "Requests",
        "Server operations",
        "Traced SQL",
        "Database (database-wide)",
        ...(group.kind === "profile" ? ["Browser CPU", "Server CPU"] : []),
      ],
      EffectArray.map(results, (result) => [
        String(result.sample),
        `${result.outcome === "failed" ? "failed after " : ""}${result.durationMs} ms${result.budgetMs === undefined ? "" : result.durationMs > result.budgetMs ? ` (OVER ${result.budgetMs} ms)` : ` (within ${result.budgetMs} ms)`}`,
        EffectArray.join(result.requests, ", ") || "none",
        result.serverActivity.kind === "captured"
          ? EffectArray.join(
              EffectArray.map(
                result.serverActivity.value.operations,
                (operation) => `${operation.name} ×${operation.calls} ${operation.totalMs} ms`,
              ),
              "; ",
            ) || "none"
          : "unavailable",
        result.serverActivity.kind === "captured"
          ? `${count(result.serverActivity.value.sql.statements, "statement")}, ${result.serverActivity.value.sql.totalMs} ms`
          : "unavailable",
        result.databaseActivity.kind === "captured"
          ? databaseCell(result.databaseActivity.value)
          : "unavailable",
        ...(group.kind === "profile"
          ? [cpuCell(result.browserCpu), cpuCell(result.serverCpu)]
          : []),
      ]),
    ),
    ...(EffectArray.some(results, (result) => (result.calls?.length ?? 0) > 0)
      ? [
          heading(4, "Client-observed calls"),
          table(
            ["Sample", "Surface", "Call", "Duration", "Outcome", "Trace ID", "Parent span ID"],
            EffectArray.flatMap(results, (result) => {
              const flatMapped11 = EffectArray.map(result.calls ?? [], (call) => [
                String(result.sample),
                call.surface,
                call.description,
                `${call.durationMs} ms`,
                call.outcome,
                code(call.traceId),
                code(call.spanId),
              ]);
              return arrayValueIsArray(flatMapped11) ? flatMapped11 : [flatMapped11];
            }),
          ),
        ]
      : []),
    ...combinedTable(
      "Server operations",
      ["Operation", "Ran in samples", "Calls", "Median total per sample", "Slowest call"],
      EffectArray.map(servers, (server) => server.operations),
      (operations) => [
        operations.name,
        `${operations.samples} of ${servers.length}`,
        String(operations.calls),
        `${operations.medianTotalMs} ms`,
        `${operations.maxMs} ms`,
      ],
    ),
    ...combinedTable(
      "Traced SQL statements",
      ["Statement", "Ran in samples", "Calls", "Median total per sample", "Slowest call"],
      EffectArray.map(servers, (server) => server.sql.slowest),
      (statement) => [
        code(statement.name),
        `${statement.samples} of ${servers.length}`,
        String(statement.calls),
        `${statement.medianTotalMs} ms`,
        `${statement.maxMs} ms`,
      ],
    ),
    ...(databases.length === 0
      ? []
      : [
          heading(
            4,
            "Database statements (database-wide, combined across samples; the slowest 15 of each sample)",
          ),
          table(
            ["Statement", "Calls", "Total", "Mean", "Rows", "Blocks hit", "Blocks read"],
            EffectArray.map(
              combineStatements(
                EffectArray.flatMap(databases, (database) => {
                  const flatMapped2 = database.statements;
                  return arrayValueIsArray(flatMapped2) ? flatMapped2 : [flatMapped2];
                }),
              ),
              (statement) => [
                code(statement.query),
                String(statement.calls),
                `${statement.totalMs} ms`,
                `${tenths(statement.totalMs / Math.max(statement.calls, 1))} ms`,
                String(statement.rows),
                String(statement.sharedBlocksHit),
                String(statement.sharedBlocksRead),
              ],
            ),
          ),
          heading(4, "Query plans (combined across samples; the slowest 15 of each sample)"),
          table(
            ["Statement", "Plan", "Executions", "Total", "Most rows", "Sequential scans"],
            EffectArray.map(
              combinePlans(
                EffectArray.flatMap(databases, (database) => {
                  const flatMapped3 = database.plans;
                  return arrayValueIsArray(flatMapped3) ? flatMapped3 : [flatMapped3];
                }),
              ),
              (plan) => [
                code(plan.query),
                plan.plan,
                String(plan.executions),
                `${plan.totalMs} ms`,
                String(plan.maxRows),
                EffectArray.join(plan.sequentialScans, ", "),
              ],
            ),
          ),
        ]),
    ...(EffectArray.some(servers, (server) => server.logs.length > 0)
      ? [
          heading(4, "Server logs"),
          table(
            ["Level", "Message", "Span", "Occurrences"],
            countRows(
              EffectArray.flatMap(servers, (server) => {
                const flatMapped12 = EffectArray.map(server.logs, (log) => [
                  log.level,
                  log.message,
                  log.span,
                ]);
                return arrayValueIsArray(flatMapped12) ? flatMapped12 : [flatMapped12];
              }),
            ),
          ),
        ]
      : []),
    ...(EffectArray.some(servers, (server) => server.errors.length > 0)
      ? [
          heading(4, "Failed spans"),
          table(
            ["Span", "Error", "Occurrences"],
            countRows(
              EffectArray.flatMap(servers, (server) => {
                const flatMapped13 = EffectArray.map(server.errors, (error) => [
                  error.span,
                  error.error,
                ]);
                return arrayValueIsArray(flatMapped13) ? flatMapped13 : [flatMapped13];
              }),
            ),
          ),
        ]
      : []),
    ...cpuBlocks(
      "Browser CPU",
      EffectArray.map(results, (result) => result.browserCpu),
    ),
    ...cpuBlocks(
      "Server CPU",
      EffectArray.map(results, (result) => result.serverCpu),
    ),
    list(
      EffectArray.flatMap(group.samples, (sample) => {
        const plans = sample.result?.databaseActivity;
        const plansAttachment =
          plans?.kind === "captured" ? plans.value.plansAttachment : undefined;
        const planFile = EffectOption.getOrUndefined(
          EffectArray.findFirst(
            sample.attachments,
            (attachment) => attachment.name === plansAttachment,
          ),
        )?.path;
        return [
          `Full result: ${sample.file}`,
          ...(planFile === undefined ? [] : [`Full query plans: ${planFile}`]),
          ...EffectArray.map(
            EffectArray.filter(
              sample.attachments,
              (attachment) =>
                EffectString.startsWith(attachment.name, "backend spans: ") ||
                EffectString.startsWith(attachment.name, "database statements: "),
            ),
            (attachment) => `Full evidence (${attachment.name}): ${attachment.path}`,
          ),
        ];
      }),
    ),
  ];
}

function combinedTable(
  title: string,
  columns: ReadonlyArray<string>,
  perSample: ReadonlyArray<ReadonlyArray<SpanGroup>>,
  row: (combined: CombinedGroup) => Array<Cell>,
): ReadonlyArray<Block> {
  const names = new Map<string, Array<SpanGroup>>();
  for (const groups of perSample) {
    for (const group of groups) {
      names.set(group.name, [...(names.get(group.name) ?? []), group]);
    }
  }
  if (names.size === 0) {
    return [];
  }

  const combined = sortWithComparator(
    EffectArray.map([...names.entries()], ([name, groups]) => ({
      name,
      samples: groups.length,
      calls: EffectArray.reduce(groups, 0, (total, group) => total + group.calls),
      medianTotalMs: tenths(
        median([
          ...EffectArray.map(groups, (group) => group.totalMs),
          ...Array.from({ length: perSample.length - groups.length }, () => 0),
        ]),
      ),
      maxMs: Math.max(...EffectArray.map(groups, (group) => group.maxMs)),
    })),
    (left, right) => right.medianTotalMs - left.medianTotalMs,
  );
  return [
    heading(
      4,
      `${title} (combined across ${perSample.length} sample${perSample.length === 1 ? "" : "s"})`,
    ),
    table(columns, EffectArray.map(combined, row)),
  ];
}

function combineStatements(
  statements: ReadonlyArray<DatabaseSummary["statements"][number]>,
): ReadonlyArray<DatabaseSummary["statements"][number]> {
  const combined = new Map<string, DatabaseSummary["statements"][number]>();
  for (const statement of statements) {
    const entry = combined.get(statement.query);
    combined.set(
      statement.query,
      entry === undefined
        ? statement
        : {
            ...entry,
            calls: entry.calls + statement.calls,
            totalMs: tenths(entry.totalMs + statement.totalMs),
            rows: entry.rows + statement.rows,
            sharedBlocksHit: entry.sharedBlocksHit + statement.sharedBlocksHit,
            sharedBlocksRead: entry.sharedBlocksRead + statement.sharedBlocksRead,
          },
    );
  }
  return sortWithComparator(
    [...combined.values()],
    (left, right) => right.totalMs - left.totalMs,
  ).slice(0, 15);
}

function combinePlans(plans: ReadonlyArray<PlanGroup>): ReadonlyArray<PlanGroup> {
  const combined = new Map<string, PlanGroup>();
  for (const plan of plans) {
    const key = `${plan.query}\n${plan.plan}`;
    const entry = combined.get(key);
    combined.set(
      key,
      entry === undefined
        ? plan
        : {
            ...entry,
            executions: entry.executions + plan.executions,
            totalMs: tenths(entry.totalMs + plan.totalMs),
            maxRows: Math.max(entry.maxRows, plan.maxRows),
          },
    );
  }
  return sortWithComparator(
    [...combined.values()],
    (left, right) => right.totalMs - left.totalMs,
  ).slice(0, 15);
}

function cpuBlocks(
  title: string,
  profiles: ReadonlyArray<typeof Cpu.Type | undefined>,
): ReadonlyArray<Block> {
  const captured = EffectArray.flatMap(profiles, (profile) => {
    const flatMapped14 = profile?.kind === "captured" ? [profile.value] : [];
    return arrayValueIsArray(flatMapped14) ? flatMapped14 : [flatMapped14];
  });
  if (captured.length === 0) {
    return [];
  }
  const functions = new Map<
    string,
    { function: string; location: string; selfMs: number; samples: number }
  >();
  for (const profile of captured) {
    for (const entry of profile.functions) {
      const key = `${entry.function}\n${entry.location}`;
      const existing = functions.get(key);
      functions.set(key, {
        function: entry.function,
        location: entry.location,
        selfMs: tenths((existing?.selfMs ?? 0) + entry.selfMs),
        samples: (existing?.samples ?? 0) + 1,
      });
    }
  }
  return [
    heading(
      4,
      `${title}: busiest functions with source (combined across ${captured.length} sample${captured.length === 1 ? "" : "s"})`,
    ),
    table(
      ["Function", "Location", "Self time", "Samples"],
      EffectArray.map(
        sortWithComparator(
          [...functions.values()],
          (left, right) => right.selfMs - left.selfMs,
        ).slice(0, 10),
        (entry) => [
          code(entry.function),
          entry.location,
          `${entry.selfMs} ms`,
          String(entry.samples),
        ],
      ),
    ),
  ];
}

function databaseCell(database: DatabaseSummary): string {
  const totals = database.totals;
  return `${count(totals.statements, "statement")} (${totals.distinct} distinct), ${totals.totalMs} ms`;
}

function cpuCell(profile: typeof Cpu.Type | undefined): string {
  if (profile === undefined || profile.kind === "unavailable") {
    return "unavailable";
  }
  const unattributed = profile.value.unattributedMs;
  return `${profile.value.busyMs} ms busy${unattributed > 0 ? `, ${unattributed} ms without a script URL` : ""}`;
}

function telemetryBlocks(model: ReportModel): ReadonlyArray<Block> {
  if (model.spans === undefined) {
    return [];
  }
  const reports = EffectArray.filter(model.spans, (span) =>
    EffectString.startsWith(span.name, "telemetry."),
  );
  const failed = EffectArray.filter(model.spans, (span) => span.error !== undefined);
  return [
    heading(2, "Application telemetry"),
    ...(model.spans.length === 0
      ? [
          paragraph(
            model.run?.target === "cloudflare"
              ? "No server spans were collected: the workerd target does not export them to the run's collector."
              : "No server spans were collected.",
          ),
        ]
      : [
          paragraph(
            reports.length === 0 && failed.length === 0
              ? `${count(model.spans.length, "server span")} collected: no telemetry reports, and no span ended in error.`
              : `${count(model.spans.length, "server span")} collected, with ${count(reports.length, "telemetry report")} and ${count(failed.length, "failed span")}:`,
          ),
          ...(reports.length === 0
            ? []
            : [
                table(
                  ["Report", "Outcome", "Details"],
                  EffectArray.map(reports, (span) => [
                    span.name,
                    text(span.attributes["app.outcome"]),
                    EffectArray.join(
                      EffectArray.map(
                        EffectArray.filter(Object.entries(span.attributes), ([key]) =>
                          /^(ui|error|telemetry)\./u.test(key),
                        ),
                        ([key, value]) =>
                          `${key}=${typeof value === "string" ? value : jsonTools.jsonString(value)}`,
                      ),
                      "; ",
                    ),
                  ]),
                ),
              ]),
          ...(failed.length === 0
            ? []
            : [
                table(
                  ["Span", "Error", "Occurrences"],
                  countRows(EffectArray.map(failed, (span) => [span.name, span.error ?? ""])),
                ),
              ]),
        ]),
  ];
}

function countRows(rows: ReadonlyArray<ReadonlyArray<string>>): Array<Array<Cell>> {
  const counts = new Map<string, { cells: ReadonlyArray<string>; count: number }>();
  for (const cells of rows) {
    const key = EffectArray.join(cells, "\n");
    counts.set(key, { cells, count: (counts.get(key)?.count ?? 0) + 1 });
  }
  return EffectArray.map(
    sortWithComparator([...counts.values()], (left, right) => right.count - left.count).slice(
      0,
      30,
    ),
    (entry) => [...entry.cells, String(entry.count)],
  );
}

const performanceNote =
  "Single local runs are noisy: judge repeated samples by their median, and never compare profiled durations with measured ones. Database statements and plans are database-wide during each interaction; traced server operations and SQL belong to the interaction's own requests.";

function statusCounts(model: ReportModel): string {
  const criteria = model.claims?.criteria ?? [];
  const counts = EffectArray.flatMap(["passed", "failed", "blocked", "not-tested"], (name) => {
    const count = EffectArray.filter(criteria, (criterion) => criterion.status === name).length;
    return count === 0 ? [] : [`${count} ${name}`];
  });
  return EffectArray.join(counts, ", ") || "none claimed";
}

function citationText(assertion: { readonly test: string; readonly step?: string }): string {
  return assertion.step === undefined
    ? `the whole test "${assertion.test}"`
    : `"${assertion.test}" › "${assertion.step}"`;
}

function stepStatus(
  model: ReportModel,
  assertion: { readonly test: string; readonly step?: string },
): string {
  const attempt = optionalArrayValue(model.results?.attempts, (value) =>
    EffectOption.getOrUndefined(
      EffectArray.findFirst(value, (candidate) => candidate.title === assertion.test),
    ),
  );
  if (assertion.step === undefined) {
    return attempt === undefined ? "not executed" : `test ${attempt.status}`;
  }
  const step = optionalArrayValue(attempt?.steps, (value) =>
    EffectOption.getOrUndefined(
      EffectArray.findFirst(value, (candidate) => candidate.title === assertion.step),
    ),
  );
  if (step === undefined) {
    return "not executed";
  }
  const timing =
    model.run?.video === true && step.videoSeconds !== undefined
      ? `, about ${step.videoSeconds.start}–${step.videoSeconds.end} s in the test's video`
      : "";
  const protocol = (step.mcpExchanges?.length ?? 0) > 0 ? "; includes MCP exchanges" : "";
  const services = (step.serviceCalls?.length ?? 0) > 0 ? "; includes service calls" : "";
  const personas =
    (step.personas?.length ?? 0) === 0
      ? ""
      : `; personas: ${optionalArrayValue(step.personas, (value) => EffectArray.join(value, ", "))}`;
  return `${step.status}${timing}${protocol}${services}${personas}`;
}

function median(values: ReadonlyArray<number>): number {
  const sorted = sortWithComparator(values, (left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function tenths(value: number): number {
  return Math.round(value * 10) / 10;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function heading(level: 1 | 2 | 3 | 4, content: string): Block {
  return { kind: "heading", level, text: content };
}

function paragraph(content: string): Block {
  return { kind: "paragraph", text: content };
}

function list(items: ReadonlyArray<string>): Block {
  return { kind: "list", items };
}

function table(columns: ReadonlyArray<string>, rows: ReadonlyArray<ReadonlyArray<Cell>>): Block {
  return { kind: "table", columns, rows };
}

function status(value: string): Cell {
  return { text: EffectString.toUpperCase(value), status: value };
}

function code(value: string): Cell {
  const line = EffectString.trim(EffectString.replaceAll(value, /\s+/gu, " "));
  const elided = EffectString.replace(line, /^select (.{40,}?) from /iu, "select … from ");
  return {
    text: elided.length > 300 ? `${EffectString.slice(elided, 0, 299)}…` : elided,
    code: true,
  };
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function renderMarkdown(blocks: ReadonlyArray<Block>): string {
  const cell = (value: Cell): string => {
    const content = EffectString.replaceAll(
      EffectString.replaceAll(typeof value === "string" ? value : value.text, "|", "\\|"),
      /\s*\n\s*/gu,
      " ",
    );
    return typeof value !== "string" && value.code === true && content !== ""
      ? `\`${EffectString.replaceAll(content, "`", "'")}\``
      : content;
  };
  return `${EffectArray.join(
    EffectArray.flatMap(blocks, (block) => {
      switch (block.kind) {
        case "heading":
          return [`${EffectString.repeat("#", block.level)} ${block.text}`];
        case "verdict":
          return [`**${block.text}**`];
        case "paragraph":
          return [block.text];
        case "list":
          return block.items.length === 0
            ? []
            : [
                EffectArray.join(
                  EffectArray.map(block.items, (item) => `- ${item}`),
                  "\n",
                ),
              ];
        case "table":
          return block.rows.length === 0
            ? []
            : [
                EffectArray.join(
                  [
                    `| ${EffectArray.join(block.columns, " | ")} |`,
                    `| ${EffectArray.join(
                      EffectArray.map(block.columns, () => "---"),
                      " | ",
                    )} |`,
                    ...EffectArray.map(
                      block.rows,
                      (row) => `| ${EffectArray.join(EffectArray.map(row, cell), " | ")} |`,
                    ),
                  ],
                  "\n",
                ),
              ];
        case "link":
          return [`[${block.text}](${block.href})`];
        case "transcript":
          return [
            `<a id="${block.id}"></a>\n\n\`\`\`\`json\n${EffectString.replaceAll(block.text, "`", "\\u0060")}\n\`\`\`\``,
          ];
        case "image":
          return [`![${block.alt}](${block.artifact})`];
      }
    }),
    "\n\n",
  )}\n`;
}

async function renderHtml(
  blocks: ReadonlyArray<Block>,
  model: ReportModel,
  directory: string,
): Promise<string> {
  const cell = (value: Cell): string => {
    if (typeof value === "string") {
      return `<td>${escape(value)}</td>`;
    }
    const content = value.code === true ? `<code>${escape(value.text)}</code>` : escape(value.text);
    return `<td${value.status === undefined ? "" : ` class="${escape(value.status)}"`}>${content}</td>`;
  };
  const rendered = await Promise.all(
    EffectArray.map(blocks, async (block) => {
      switch (block.kind) {
        case "heading":
          return `<h${block.level}>${escape(block.text)}</h${block.level}>`;
        case "verdict":
          return `<p class="verdict ${block.ready ? "ready" : "not-ready"}">${escape(block.text)}</p>`;
        case "paragraph":
          return `<p>${escape(block.text)}</p>`;
        case "list":
          return block.items.length === 0
            ? ""
            : `<ul>${EffectArray.join(
                EffectArray.map(block.items, (item) => `<li>${escape(item)}</li>`),
                "",
              )}</ul>`;
        case "table":
          return block.rows.length === 0
            ? ""
            : `<table><thead><tr>${EffectArray.join(
                EffectArray.map(block.columns, (column) => `<th>${escape(column)}</th>`),
                "",
              )}</tr></thead><tbody>${EffectArray.join(
                EffectArray.map(
                  block.rows,
                  (row) => `<tr>${EffectArray.join(EffectArray.map(row, cell), "")}</tr>`,
                ),
                "",
              )}</tbody></table>`;
        case "link":
          return `<p><a href="${escape(block.href)}">${escape(block.text)}</a></p>`;
        case "transcript":
          return `<pre id="${block.id}">${escape(block.text)}</pre>`;
        case "image": {
          const path = resolveArtifact(directory, block.artifact);
          return path === undefined
            ? `<p>Rejected artifact (not a file inside this run): ${escape(block.artifact)}</p>`
            : `<img alt="${escape(block.artifact)}" src="data:image/png;base64,${(await readFile(path)).toString("base64")}">`;
        }
      }
    }),
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Application verification: ${escape(model.claims?.request ?? "unclaimed run")}</title>
<style>
body { font: 15px/1.5 system-ui, sans-serif; max-width: 1200px; margin: 2rem auto; padding: 0 1rem; color: #1d2433; }
.verdict { padding: 0.75rem 1rem; border-radius: 6px; font-weight: 600; }
.ready { background: #e6f4ea; } .not-ready { background: #fde8e8; }
.passed, .completed, .done { color: #137333; } .failed, .stopped, .interrupted { color: #b3261e; } .blocked, .not-tested, .skipped { color: #8a5a00; }
img { max-width: 100%; border: 1px solid #d0d7de; border-radius: 4px; margin: 0.5rem 0; }
table { border-collapse: collapse; margin: 0.75rem 0 1.25rem; font-size: 14px; }
th, td { border: 1px solid #d0d7de; padding: 0.35rem 0.6rem; text-align: left; vertical-align: top; }
th { background: #f3f5f8; }
pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #f3f5f8; padding: 1rem; }
code { font-size: 12.5px; word-break: break-word; }
</style>
</head>
<body>
${EffectArray.join(EffectArray.filter(rendered, Boolean), "\n")}
</body>
</html>
`;
}

function escape(value: string): string {
  return EffectString.replaceAll(
    EffectString.replaceAll(
      EffectString.replaceAll(
        EffectString.replaceAll(EffectString.replaceAll(value, "&", "&amp;"), "<", "&lt;"),
        ">",
        "&gt;",
      ),
      '"',
      "&quot;",
    ),
    "'",
    "&#39;",
  );
}

const SpanLine = Schema.fromJsonString(
  Schema.Struct({
    name: Schema.String,
    traceId: Schema.optional(Schema.String),
    attributes: Schema.Record(Schema.String, Schema.Unknown),
    error: Schema.optional(Schema.String),
  }),
);

const RunJson = Schema.fromJsonString(
  Schema.Struct({
    runId: Schema.String,
    composition: Schema.optional(Schema.String),
    servicePrograms: Schema.optional(Schema.String),
    startedAt: Schema.String,
    target: Schema.String,
    versionControl: Schema.optional(Schema.String),
    revision: Schema.String,
    workingTree: Schema.String,
    sourceFingerprint: Schema.String,
    video: Schema.Boolean,
    selection: Schema.Struct({
      files: Schema.Array(Schema.String),
      grep: Schema.optional(Schema.String),
    }),
  }),
);

const DoctorJson = Schema.fromJsonString(
  Schema.Struct({ origin: Schema.String, databaseName: Schema.String }),
);

const CleanupJson = Schema.fromJsonString(
  Schema.Struct({
    cleanupComplete: Schema.Boolean,
    recoveredRun: Schema.optional(Schema.String),
    steps: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        status: Schema.String,
        detail: Schema.optional(Schema.String),
      }),
    ),
    commands: Schema.Array(
      Schema.Struct({ name: Schema.String, status: Schema.String, durationMs: Schema.Number }),
    ),
  }),
);

type Cell = string | { readonly text: string; readonly status?: string; readonly code?: boolean };

type Block =
  | { readonly kind: "heading"; readonly level: 1 | 2 | 3 | 4; readonly text: string }
  | { readonly kind: "verdict"; readonly ready: boolean; readonly text: string }
  | { readonly kind: "paragraph"; readonly text: string }
  | { readonly kind: "list"; readonly items: ReadonlyArray<string> }
  | {
      readonly kind: "table";
      readonly columns: ReadonlyArray<string>;
      readonly rows: ReadonlyArray<ReadonlyArray<Cell>>;
    }
  | { readonly kind: "image"; readonly artifact: string; readonly alt: string }
  | { readonly kind: "link"; readonly href: string; readonly text: string }
  | { readonly kind: "transcript"; readonly id: string; readonly text: string };

type PerformanceEntry = {
  readonly test: string;
  readonly kind: "measurement" | "profile";
  readonly file: string;
  readonly attachments: Results["attempts"][number]["attachments"];
  readonly result:
    | (typeof MeasurementJson.Type & {
        readonly browserCpu?: typeof Cpu.Type;
        readonly serverCpu?: typeof Cpu.Type;
      })
    | undefined;
};

type GroupSummary = {
  readonly name: string;
  readonly test: string;
  readonly kind: "measurement" | "profile";
  readonly durations: ReadonlyArray<number>;
  readonly median: number | undefined;
  readonly budget: number | undefined;
  readonly over: number;
  readonly samples: ReadonlyArray<PerformanceEntry>;
};

type CombinedGroup = {
  readonly name: string;
  readonly samples: number;
  readonly calls: number;
  readonly medianTotalMs: number;
  readonly maxMs: number;
};

type ReportModel = {
  readonly ready: boolean;
  readonly problems: ReadonlyArray<string>;
  readonly run: typeof RunJson.Type | undefined;
  readonly doctor: typeof DoctorJson.Type | undefined;
  readonly claims: Claims | undefined;
  readonly results: Results | undefined;
  readonly cleanup: typeof CleanupJson.Type | undefined;
  readonly performance: ReadonlyArray<PerformanceEntry>;
  readonly serviceCalls: ReadonlyArray<{
    readonly test: string;
    readonly name: string;
    readonly file: string;
    readonly call: typeof ServiceCallJson.Type | undefined;
  }>;
  readonly exchanges: ReadonlyArray<{
    readonly test: string;
    readonly name: string;
    readonly file: string;
    readonly exchange: typeof McpExchangeJson.Type | undefined;
  }>;
  readonly spans: ReadonlyArray<typeof SpanLine.Type> | undefined;
  readonly video: string | undefined;
};
