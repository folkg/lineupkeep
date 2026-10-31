import { Exit, Option, Redacted, Tracer } from "effect";

const maximumAttributes = 32;
const maximumAttributeLength = 512;
const maximumArrayItems = 16;
const maximumEvents = 8;
const maximumLinks = 4;
const maximumNameLength = 128;

export function makeCloudLoggingTracer(options: {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly write: (line: string) => void;
}): Tracer.Tracer {
  return Tracer.make({
    span: (spanOptions) => new CloudLoggingSpan(spanOptions, options),
  });
}

class CloudLoggingSpan extends Tracer.NativeSpan {
  constructor(
    options: Parameters<Tracer.Tracer["span"]>[0],
    private readonly sink: CloudLoggingSink,
  ) {
    super(options);
  }

  override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    super.end(endTime, exit);
    try {
      this.sink.write(JSON.stringify(entryOf(this, endTime, exit, this.sink)));
    } catch {
      return;
    }
  }
}

function entryOf(
  span: Tracer.NativeSpan,
  endTime: bigint,
  exit: Exit.Exit<unknown, unknown>,
  sink: CloudLoggingSink,
): CloudLoggingEntry {
  const attributes = safeAttributeEntries(span.attributes);
  const outcome = outcomeOf(exit, attributes["app.outcome"]);
  const durationMillis = Number(endTime - span.startTime) / 1_000_000;
  const parent = Option.getOrUndefined(span.parent);

  return {
    severity: severityOf(outcome),
    message: `${span.name} ${outcome} ${durationMillis.toFixed(1)}ms`,
    "logging.googleapis.com/trace": span.traceId,
    "logging.googleapis.com/spanId": span.spanId,
    "logging.googleapis.com/trace_sampled": span.sampled,
    span: {
      name: span.name,
      kind: span.kind,
      outcome,
      duration_ms: durationMillis,
      ...(parent === undefined ? {} : { parent_span_id: parent.spanId }),
      service: sink.serviceName,
      service_version: sink.serviceVersion,
      attributes,
      ...(span.events.length === 0 ? {} : { events: eventsOf(span) }),
      ...(span.links.length === 0 ? {} : { links: linksOf(span) }),
    },
  };
}

function eventsOf(span: Tracer.NativeSpan): ReadonlyArray<CloudLoggingEvent> {
  return span.events.slice(0, maximumEvents).map(([name, startTime, attributes]) => ({
    name: truncate(name, maximumNameLength),
    at_ms: Number(startTime - span.startTime) / 1_000_000,
    attributes: safeAttributes(attributes),
  }));
}

function linksOf(span: Tracer.NativeSpan): ReadonlyArray<CloudLoggingLink> {
  return span.links.slice(0, maximumLinks).map((link) => ({
    trace_id: link.span.traceId,
    span_id: link.span.spanId,
    attributes: safeAttributes(link.attributes),
  }));
}

function outcomeOf(exit: Exit.Exit<unknown, unknown>, applicationOutcome: unknown): Outcome {
  if (Exit.isFailure(exit)) {
    const kinds = new Set(exit.cause.reasons.map((reason) => reason._tag));
    if (kinds.has("Die")) {
      return "defect";
    }
    if (kinds.has("Fail")) {
      return "failed";
    }
    return "interrupted";
  }
  switch (applicationOutcome) {
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

function severityOf(outcome: Outcome): "INFO" | "WARNING" | "ERROR" {
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

function safeAttributes(attributes: Readonly<Record<string, unknown>>): SafeAttributes {
  return safeAttributeEntries(Object.entries(attributes));
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

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

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

type CloudLoggingSink = {
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly write: (line: string) => void;
};

type CloudLoggingEntry = {
  readonly severity: "INFO" | "WARNING" | "ERROR";
  readonly message: string;
  readonly "logging.googleapis.com/trace": string;
  readonly "logging.googleapis.com/spanId": string;
  readonly "logging.googleapis.com/trace_sampled": boolean;
  readonly span: {
    readonly name: string;
    readonly kind: Tracer.SpanKind;
    readonly outcome: Outcome;
    readonly duration_ms: number;
    readonly parent_span_id?: string;
    readonly service: string;
    readonly service_version: string;
    readonly attributes: SafeAttributes;
    readonly events?: ReadonlyArray<CloudLoggingEvent>;
    readonly links?: ReadonlyArray<CloudLoggingLink>;
  };
};

type CloudLoggingEvent = {
  readonly name: string;
  readonly at_ms: number;
  readonly attributes: SafeAttributes;
};

type CloudLoggingLink = {
  readonly trace_id: string;
  readonly span_id: string;
  readonly attributes: SafeAttributes;
};

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
