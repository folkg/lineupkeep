import { Exit, Option, Redacted, Tracer } from "effect";

const maximumAttributes = 64;
const maximumAttributeLength = 512;
const maximumArrayItems = 16;
const maximumSpansPerTrace = 4096;
const maximumTraces = 128;
const maximumSpanGroups = 24;
const maximumNameLength = 128;

export function makeWideEventTracer(options: {
  readonly inner: Tracer.Tracer;
  readonly write: (line: string) => void;
}): Tracer.Tracer {
  const recorder = makeRecorder(options.write);
  return Tracer.make({
    context: options.inner.context?.bind(options.inner),
    span(spanOptions) {
      const span = options.inner.span(spanOptions);
      const end = span.end.bind(span);
      span.end = (endTime, exit) => {
        end(endTime, exit);
        recorder.record(span, endTime, exit);
      };
      return span;
    },
  });
}

function makeRecorder(write: (line: string) => void): SpanRecorder {
  const traces = new Map<string, Map<string, SpanRecord>>();

  const bufferOf = (traceId: string): Map<string, SpanRecord> => {
    const existing = traces.get(traceId);
    if (existing !== undefined) {
      return existing;
    }
    if (traces.size >= maximumTraces) {
      const oldest = traces.keys().next();
      if (oldest.done === false) {
        traces.delete(oldest.value);
      }
    }
    const buffer = new Map<string, SpanRecord>();
    traces.set(traceId, buffer);
    return buffer;
  };

  return {
    record(span, endTime, exit) {
      try {
        const unitKind = unitKindOf(span.name);
        const record = recordOf(span, endTime, exit);
        const buffer = bufferOf(record.traceId);
        buffer.set(record.spanId, record);
        while (buffer.size > maximumSpansPerTrace) {
          const oldest = buffer.keys().next();
          if (oldest.done === true) {
            break;
          }
          buffer.delete(oldest.value);
        }
        if (unitKind === undefined) {
          return;
        }
        const spans = subtreeOf(buffer, record);
        if (!record.nested) {
          traces.delete(record.traceId);
        }
        write(JSON.stringify(entryOf(unitKind, spans, record)));
      } catch {
        return;
      }
    },
  };
}

function unitKindOf(spanName: string): UnitKind | undefined {
  switch (spanName) {
    case "http.server.request":
      return "http_request";
    case "LineupWorker.run":
      return "lineup_run";
    default:
      return undefined;
  }
}

function recordOf(
  span: Tracer.Span,
  endTime: bigint,
  exit: Exit.Exit<unknown, unknown>,
): SpanRecord {
  return {
    name: truncate(span.name, maximumNameLength),
    spanId: span.spanId,
    traceId: span.traceId,
    sampled: span.sampled,
    parentSpanId: Option.getOrUndefined(Option.map(span.parent, (parent) => parent.spanId)),
    nested: Option.exists(span.parent, (parent) => parent._tag === "Span"),
    startTime: span.status.startTime,
    endTime,
    exit,
    attributes: [...span.attributes],
  };
}

function subtreeOf(buffer: Map<string, SpanRecord>, root: SpanRecord): ReadonlyArray<SpanRecord> {
  const children = new Map<string, Array<SpanRecord>>();
  for (const record of buffer.values()) {
    if (record.parentSpanId === undefined) {
      continue;
    }
    const siblings = children.get(record.parentSpanId);
    if (siblings === undefined) {
      children.set(record.parentSpanId, [record]);
    } else {
      siblings.push(record);
    }
  }
  const spans: Array<SpanRecord> = [];
  const pending: Array<SpanRecord> = [root];
  while (pending.length > 0) {
    const record = pending.pop();
    if (record === undefined) {
      continue;
    }
    spans.push(record);
    for (const child of children.get(record.spanId) ?? []) {
      pending.push(child);
    }
  }
  return spans.sort((left, right) => (left.startTime < right.startTime ? -1 : 1));
}

function entryOf(
  unitKind: UnitKind,
  spans: ReadonlyArray<SpanRecord>,
  root: SpanRecord,
): WideEventEntry {
  const attributes = mergedAttributes(spans);
  const outcome = outcomeOf(spans, root);
  const durationMillis = millis(root.endTime - root.startTime);
  const label =
    unitKind === "http_request"
      ? `${textOf(attributeOf(root, "http.request.method")) ?? "HTTP"} ${textOf(attributeOf(root, "url.path")) ?? "/"}`
      : `lineup run ${textOf(attributes["lineup.run"]) ?? "unknown"}`;

  const route = routeOf(unitKind, root);
  const tool = textOf(attributes["tool"]);
  const requestId = textOf(attributes["request.id"]);
  const lineupRequest = textOf(attributes["lineup.request"]);
  const runId = unitKind === "lineup_run" ? textOf(attributes["lineup.run"]) : undefined;
  const actor = textOf(attributes["user.id"]);
  const connectionId = textOf(attributes["connection.id"]);
  const teamId = textOf(attributes["team.id"]);
  const statusCode = statusCodeOf(root);

  return {
    severity: severityOf(outcome),
    message: `${label} ${outcome} ${durationMillis.toFixed(1)}ms`,
    "logging.googleapis.com/trace": root.traceId,
    "logging.googleapis.com/spanId": root.spanId,
    "logging.googleapis.com/trace_sampled": root.sampled,
    event: {
      kind: unitKind,
      operation: operationOf(unitKind, spans, root),
      ...(route === undefined ? {} : { route }),
      ...(tool === undefined ? {} : { tool }),
      ...(requestId === undefined ? {} : { request_id: requestId }),
      ...(lineupRequest === undefined ? {} : { lineup_request: lineupRequest }),
      ...(runId === undefined ? {} : { run_id: runId }),
      ...(actor === undefined ? {} : { actor }),
      ...(connectionId === undefined ? {} : { connection_id: connectionId }),
      ...(teamId === undefined ? {} : { team_id: teamId }),
      outcome,
      ...(statusCode === undefined ? {} : { status_code: statusCode }),
      duration_ms: roundMillis(durationMillis),
      span_count: spans.length,
      spans: spanGroupsOf(spans, root),
      attributes,
    },
  };
}

function operationOf(
  unitKind: UnitKind,
  spans: ReadonlyArray<SpanRecord>,
  root: SpanRecord,
): string {
  if (unitKind === "lineup_run") {
    return root.name;
  }
  const operation = spans.find((span) => attributeOf(span, "app.operation") !== undefined);
  return textOf(attributeOf(operation ?? root, "app.operation")) ?? root.name;
}

function routeOf(unitKind: UnitKind, root: SpanRecord): string | undefined {
  if (unitKind !== "http_request") {
    return undefined;
  }
  const method = textOf(attributeOf(root, "http.request.method"));
  const path = textOf(attributeOf(root, "url.path"));
  return method === undefined || path === undefined ? path : `${method} ${path}`;
}

function statusCodeOf(root: SpanRecord): number | undefined {
  const status = attributeOf(root, "http.response.status_code");
  return typeof status === "number" && Number.isFinite(status) ? status : undefined;
}

function mergedAttributes(spans: ReadonlyArray<SpanRecord>): SafeAttributes {
  const merged = new Map<string, unknown>();
  for (const span of [...spans].sort((left, right) => (left.endTime < right.endTime ? -1 : 1))) {
    for (const [key, value] of span.attributes) {
      if (!isTransportDetail(key)) {
        merged.set(key, value);
      }
    }
  }
  return safeAttributeEntries(merged);
}

function isTransportDetail(key: string): boolean {
  return (
    key.startsWith("db.") ||
    key.startsWith("effect.sql.") ||
    key.startsWith("network.") ||
    key.startsWith("server.") ||
    key === "url.path" ||
    key === "http.request.method" ||
    key === "http.response.status_code"
  );
}

function spanGroupsOf(
  spans: ReadonlyArray<SpanRecord>,
  root: SpanRecord,
): ReadonlyArray<SpanGroup> {
  const groups = new Map<string, { count: number; total: number; maximum: number }>();
  for (const span of spans) {
    if (span.spanId === root.spanId) {
      continue;
    }
    const duration = millis(span.endTime - span.startTime);
    const group = groups.get(span.name);
    if (group === undefined) {
      groups.set(span.name, { count: 1, total: duration, maximum: duration });
    } else {
      group.count += 1;
      group.total += duration;
      group.maximum = Math.max(group.maximum, duration);
    }
  }
  return [...groups]
    .sort((left, right) => right[1].total - left[1].total)
    .slice(0, maximumSpanGroups)
    .map(([name, group]) => ({
      name,
      count: group.count,
      total_ms: roundMillis(group.total),
      max_ms: roundMillis(group.maximum),
    }));
}

function outcomeOf(spans: ReadonlyArray<SpanRecord>, root: SpanRecord): Outcome {
  return spans
    .filter(
      (span) =>
        span.spanId === root.spanId ||
        attributeOf(span, "app.outcome") !== undefined ||
        attributeOf(span, "app.operation") !== undefined,
    )
    .map((span) => outcomeOfSpan(span))
    .reduce<Outcome>(
      (worst, outcome) => (outcomeRank[outcome] > outcomeRank[worst] ? outcome : worst),
      "ok",
    );
}

function outcomeOfSpan(span: SpanRecord): Outcome {
  if (Exit.isFailure(span.exit)) {
    const kinds = new Set(span.exit.cause.reasons.map((reason) => reason._tag));
    if (kinds.has("Die")) {
      return "defect";
    }
    if (kinds.has("Fail")) {
      return "failed";
    }
    return "interrupted";
  }
  switch (attributeOf(span, "app.outcome")) {
    case "failure":
      return "failed";
    case "uncertain":
      return "uncertain";
    case "blocked":
      return "blocked";
    case "retry":
      return "retry";
    case "rejected":
      return "rejected";
    default:
      return "ok";
  }
}

function severityOf(outcome: Outcome): Severity {
  switch (outcome) {
    case "failed":
    case "defect":
      return "ERROR";
    case "uncertain":
    case "blocked":
    case "retry":
    case "rejected":
    case "interrupted":
      return "WARNING";
    case "ok":
      return "INFO";
  }
}

function safeAttributeEntries(attributes: Iterable<readonly [string, unknown]>): SafeAttributes {
  return Object.fromEntries(
    [...attributes]
      .filter(([key]) => !suppressedKeys.has(key) && !isSuppressedKey(key))
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .slice(0, maximumAttributes)
      .flatMap(([key, value]) => {
        const safe = safeValue(value);
        return safe === undefined ? [] : [[key, safe]];
      }),
  );
}

function safeValue(value: unknown): SafeValue | undefined {
  if (Redacted.isRedacted(value)) {
    return "[REDACTED]";
  }
  if (typeof value === "string") {
    return truncate(value, maximumAttributeLength);
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : String(value);
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.slice(0, maximumArrayItems).flatMap((item) => {
      const safe = safeValue(item);
      return safe === undefined ? [] : [safe];
    });
  }
  return undefined;
}

function isSuppressedKey(key: string): boolean {
  const lower = key.toLowerCase();
  return (
    lower.endsWith(".cookie") ||
    lower.endsWith(".crumb") ||
    lower.endsWith(".token") ||
    lower.endsWith(".secret") ||
    lower.endsWith(".password") ||
    lower.endsWith(".email") ||
    lower.endsWith(".note") ||
    lower.endsWith(".body") ||
    lower.endsWith(".payload")
  );
}

function attributeOf(span: SpanRecord, key: string): unknown {
  return span.attributes.find(([name]) => name === key)?.[1];
}

function textOf(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function millis(nanoseconds: bigint): number {
  return Number(nanoseconds) / 1_000_000;
}

function roundMillis(value: number): number {
  return Math.round(value * 10) / 10;
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

const outcomeRank: Readonly<Record<Outcome, number>> = {
  ok: 0,
  rejected: 1,
  interrupted: 2,
  retry: 3,
  blocked: 4,
  uncertain: 5,
  failed: 6,
  defect: 7,
};

const suppressedKeys = new Set([
  "authorization",
  "body",
  "cookie",
  "set-cookie",
  "crumb",
  "credentials",
  "email",
  "note",
  "parameters",
  "password",
  "payload",
  "secret",
  "session",
  "token",
  "effect.cause",
  "effect.fiberId",
  "effect.logLevel",
]);

type SpanRecorder = {
  readonly record: (span: Tracer.Span, endTime: bigint, exit: Exit.Exit<unknown, unknown>) => void;
};

type SpanRecord = {
  readonly name: string;
  readonly spanId: string;
  readonly traceId: string;
  readonly sampled: boolean;
  readonly parentSpanId: string | undefined;
  readonly nested: boolean;
  readonly startTime: bigint;
  readonly endTime: bigint;
  readonly exit: Exit.Exit<unknown, unknown>;
  readonly attributes: ReadonlyArray<readonly [string, unknown]>;
};

type UnitKind = "http_request" | "lineup_run";

type WideEventEntry = {
  readonly severity: Severity;
  readonly message: string;
  readonly "logging.googleapis.com/trace": string;
  readonly "logging.googleapis.com/spanId": string;
  readonly "logging.googleapis.com/trace_sampled": boolean;
  readonly event: WideEvent;
};

type WideEvent = {
  readonly kind: UnitKind;
  readonly operation: string;
  readonly route?: string;
  readonly tool?: string;
  readonly request_id?: string;
  readonly lineup_request?: string;
  readonly run_id?: string;
  readonly actor?: string;
  readonly connection_id?: string;
  readonly team_id?: string;
  readonly outcome: Outcome;
  readonly status_code?: number;
  readonly duration_ms: number;
  readonly span_count: number;
  readonly spans: ReadonlyArray<SpanGroup>;
  readonly attributes: SafeAttributes;
};

type SpanGroup = {
  readonly name: string;
  readonly count: number;
  readonly total_ms: number;
  readonly max_ms: number;
};

type Severity = "INFO" | "WARNING" | "ERROR";

type Outcome =
  | "ok"
  | "failed"
  | "defect"
  | "interrupted"
  | "uncertain"
  | "blocked"
  | "retry"
  | "rejected";

type SafeValue = string | number | boolean | ReadonlyArray<SafeValue>;

type SafeAttributes = Record<string, SafeValue>;
