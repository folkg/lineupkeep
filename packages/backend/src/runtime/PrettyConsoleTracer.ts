import { Duration, Exit, Option, Redacted, Tracer } from "effect";

export function makePrettyConsoleTracer(options: PrettyConsoleTracerOptions): Tracer.Tracer {
  return Tracer.make({
    span: (spanOptions) => new PrettySpan(spanOptions, options),
  });
}

class PrettySpan extends Tracer.NativeSpan {
  constructor(
    options: Parameters<Tracer.Tracer["span"]>[0],
    private readonly renderOptions: PrettyConsoleTracerOptions,
  ) {
    super(options);
  }

  override end(endTime: bigint, exit: Exit.Exit<unknown, unknown>): void {
    super.end(endTime, exit);
    if (this.sampled) {
      this.renderOptions.write(formatCompletedSpan(this, endTime, exit, this.renderOptions));
    }
  }
}

function formatCompletedSpan(
  span: Tracer.NativeSpan,
  endTime: bigint,
  exit: Exit.Exit<unknown, unknown>,
  options: PrettyConsoleTracerOptions,
): string {
  const millis = Number(endTime - span.startTime) / 1_000_000;
  const status = formatStatus(span, exit, millis >= Duration.toMillis(options.slowSpanThreshold));
  const { indentation, clipped } = spanIndentation(span);
  const parent = Option.getOrUndefined(span.parent);
  const identity = `[${text(span.traceId)}/${text(span.spanId)}${parent !== undefined ? ` parent=${text(parent.spanId)}` : ""}]`;
  const summary = `${indentation}${clipped ? "… " : ""}${status} ${identity} ${text(span.name)} kind=${span.kind} ${millis.toFixed(1)}ms${formatAttributes([...span.attributes])}`;
  const events = span.events
    .slice(0, maxDetails)
    .map(
      ([name, , attributes]) =>
        `${indentation}  · ${text(name)}${formatAttributes(Object.entries(attributes))}`,
    );
  const links = span.links
    .slice(0, maxLinks)
    .map(
      (link) =>
        `${indentation}  ↗ [${text(link.span.traceId)}/${text(link.span.spanId)}]${formatAttributes(Object.entries(link.attributes))}`,
    );
  if (span.events.length > maxDetails) {
    events.push(`${indentation}  … ${span.events.length - maxDetails} more events`);
  }
  if (span.links.length > maxLinks) {
    links.push(`${indentation}  … ${span.links.length - maxLinks} more links`);
  }
  return [summary, ...events, ...links].map((line) => truncate(line, maxLineLength)).join("\n");
}

function formatStatus(span: Tracer.Span, exit: Exit.Exit<unknown, unknown>, slow: boolean): string {
  if (Exit.isFailure(exit)) {
    const kinds = new Set(exit.cause.reasons.map((reason) => reason._tag));
    const diagnostics = [
      ...(kinds.has("Fail") ? ["operation.failed"] : []),
      ...(kinds.has("Die") ? ["operation.defect"] : []),
      ...(kinds.has("Interrupt") ? ["interrupted"] : []),
    ];
    return `${kinds.size === 1 && kinds.has("Interrupt") ? "⊘" : "✗"} ${diagnostics.join("+")}`;
  }
  const outcome = span.attributes.get("app.outcome");
  if (outcome === "failure") {
    return "✗";
  }
  if (typeof outcome === "string" && outcome !== "success") {
    return "↩";
  }
  return slow ? "⚠" : "✓";
}

function spanIndentation(span: Tracer.Span): {
  indentation: string;
  clipped: boolean;
} {
  let depth = 0;
  let parent = Option.getOrUndefined(span.parent);
  while (parent?._tag === "Span" && depth < maxDepth) {
    depth += 1;
    parent = Option.getOrUndefined(parent.parent);
  }
  return { indentation: "  ".repeat(depth), clipped: parent?._tag === "Span" };
}

function formatAttributes(entries: ReadonlyArray<readonly [string, unknown]>): string {
  const sorted = entries
    .filter(([key]) => key !== "effect.fiberId" && key !== "effect.logLevel")
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const rendered = sorted.slice(0, maxDetails).map(([key, value]) => {
    const normalized =
      key === "db.query.text" && typeof value === "string"
        ? value.replaceAll(/\s+/gu, " ").trim()
        : value;
    return `${text(key)}=${truncate(renderValue(normalized, 0), maxDetailLength)}`;
  });
  if (sorted.length > maxDetails) {
    rendered.push(`… ${sorted.length - maxDetails} more attributes`);
  }
  return rendered.length === 0 ? "" : ` ${rendered.join(" ")}`;
}

function renderValue(value: unknown, depth: number): string {
  if (typeof value === "string") {
    return text(JSON.stringify(truncate(value, maxDetailLength)));
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value === null) {
    return "null";
  }
  if (typeof value !== "object") {
    return "[unsupported]";
  }
  if (Redacted.isRedacted(value)) {
    return "[Redacted]";
  }
  if (depth >= maxValueDepth) {
    return "…";
  }
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    return "[unsupported]";
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Array.isArray(value)
    ? Array.from({ length: Math.min(value.length, maxItems) }, (_, index) => String(index))
    : Object.keys(descriptors)
        .filter((key) => descriptors[key]?.enumerable === true)
        .sort()
        .slice(0, maxItems);
  const items = keys.map((key) => {
    const descriptor = descriptors[key];
    const rendered =
      descriptor !== undefined && "value" in descriptor
        ? renderValue(descriptor.value, depth + 1)
        : "[unsupported]";
    return Array.isArray(value) ? rendered : `${JSON.stringify(text(key))}:${rendered}`;
  });
  const count = Array.isArray(value) ? value.length : Object.keys(descriptors).length;
  if (count > maxItems) {
    items.push(`… ${count - maxItems} more`);
  }
  return Array.isArray(value) ? `[${items.join(",")}]` : `{${items.join(",")}}`;
}

function text(value: string): string {
  return truncate(
    value.replaceAll(
      /[\p{Cc}\p{Zl}\p{Zp}]/gu,
      (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
    ),
    maxDetailLength,
  );
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

const maxDetailLength = 160;
const maxLineLength = 2048;
const maxDetails = 12;
const maxLinks = 4;
const maxDepth = 6;
const maxValueDepth = 3;
const maxItems = 6;

type PrettyConsoleTracerOptions = {
  readonly slowSpanThreshold: Duration.Duration;
  readonly write: (line: string) => void;
};
