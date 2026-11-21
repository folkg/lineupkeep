import { EffectString } from "@lineupkeep/collections";
import { Duration, Exit, Option, Redacted, Tracer } from "effect";
import { Array as EffectArray } from "effect";
import { Order as EffectOrder } from "effect";
import { Record as EffectRecord } from "effect";

import jsonTools from "#runtime/JsonText.ts";

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
  const events = EffectArray.map(
    span.events.slice(0, maxDetails),
    ([name, , attributes]) =>
      `${indentation}  · ${text(name)}${formatAttributes(EffectRecord.toEntries(attributes))}`,
  );
  const links = EffectArray.map(
    span.links.slice(0, maxLinks),
    (link) =>
      `${indentation}  ↗ [${text(link.span.traceId)}/${text(link.span.spanId)}]${formatAttributes(EffectRecord.toEntries(link.attributes))}`,
  );
  if (span.events.length > maxDetails) {
    events.push(`${indentation}  … ${span.events.length - maxDetails} more events`);
  }
  if (span.links.length > maxLinks) {
    links.push(`${indentation}  … ${span.links.length - maxLinks} more links`);
  }
  return EffectArray.join(
    EffectArray.map([summary, ...events, ...links], (line) => truncate(line, maxLineLength)),
    "\n",
  );
}

function formatStatus(span: Tracer.Span, exit: Exit.Exit<unknown, unknown>, slow: boolean): string {
  if (Exit.isFailure(exit)) {
    const kinds = new Set(EffectArray.map(exit.cause.reasons, (reason) => reason._tag));
    const diagnostics = [
      ...(kinds.has("Fail") ? ["operation.failed"] : []),
      ...(kinds.has("Die") ? ["operation.defect"] : []),
      ...(kinds.has("Interrupt") ? ["interrupted"] : []),
    ];
    return `${kinds.size === 1 && kinds.has("Interrupt") ? "⊘" : "✗"} ${EffectArray.join(diagnostics, "+")}`;
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
  return { indentation: EffectString.repeat("  ", depth), clipped: parent?._tag === "Span" };
}

function formatAttributes(entries: ReadonlyArray<readonly [string, unknown]>): string {
  const sorted = sortWithComparator(
    EffectArray.filter(entries, ([key]) => key !== "effect.fiberId" && key !== "effect.logLevel"),
    ([left], [right]) => (left < right ? -1 : left > right ? 1 : 0),
  );
  const rendered = EffectArray.map(sorted.slice(0, maxDetails), ([key, value]) => {
    const normalized =
      key === "db.query.text" && typeof value === "string"
        ? EffectString.trim(EffectString.replaceAll(value, /\s+/gu, " "))
        : value;
    return `${text(key)}=${truncate(renderValue(normalized, 0), maxDetailLength)}`;
  });
  if (sorted.length > maxDetails) {
    rendered.push(`… ${sorted.length - maxDetails} more attributes`);
  }
  return rendered.length === 0 ? "" : ` ${EffectArray.join(rendered, " ")}`;
}

function renderValue(value: unknown, depth: number): string {
  if (typeof value === "string") {
    return text(jsonTools.jsonString(truncate(value, maxDetailLength)));
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
    !EffectArray.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  ) {
    return "[unsupported]";
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = EffectArray.isArray(value)
    ? Array.from({ length: Math.min(value.length, maxItems) }, (_, index) => String(index))
    : optionalArrayValue(
        EffectArray.filter(
          EffectRecord.keys(descriptors),
          (key) => descriptors[key]?.enumerable === true,
        ),
        (value) => EffectArray.sort(value, EffectOrder.String),
      ).slice(0, maxItems);
  const items = EffectArray.map(keys, (key) => {
    const descriptor = descriptors[key];
    const rendered =
      descriptor !== undefined && "value" in descriptor
        ? renderValue(descriptor.value, depth + 1)
        : "[unsupported]";
    return EffectArray.isArray(value) ? rendered : `${jsonTools.jsonString(text(key))}:${rendered}`;
  });
  const count = EffectArray.isArray(value) ? value.length : EffectRecord.keys(descriptors).length;
  if (count > maxItems) {
    items.push(`… ${count - maxItems} more`);
  }
  return EffectArray.isArray(value)
    ? `[${EffectArray.join(items, ",")}]`
    : `{${EffectArray.join(items, ",")}}`;
}

function text(value: string): string {
  return truncate(
    EffectString.replaceAll(
      value,
      /[\p{Cc}\p{Zl}\p{Zp}]/gu,
      (character) =>
        `\\u${EffectString.padStart(EffectString.charCodeAt(character, 0).toString(16), 4, "0")}`,
    ),
    maxDetailLength,
  );
}

function truncate(value: string, length: number): string {
  return value.length <= length ? value : `${EffectString.slice(value, 0, length - 1)}…`;
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
