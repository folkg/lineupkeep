import { DateTime, Effect, Schema, SchemaIssue, SchemaTransformation } from "effect";

import { YahooParseError } from "./errors.ts";

export const IntFromStringOrNumber: Schema.Codec<number, number | string> = Schema.Union([
  Schema.Finite,
  Schema.String,
]).pipe(
  Schema.decodeTo(
    Schema.Int,
    SchemaTransformation.transform({
      decode: (value) => (typeof value === "number" ? value : Number(value)),
      encode: (value) => value,
    }),
  ),
);

export const NumberFromStringOrNumber: Schema.Codec<number, number | string> = Schema.Union([
  Schema.Finite,
  Schema.String,
]).pipe(
  Schema.decodeTo(
    Schema.Finite,
    SchemaTransformation.transform({
      decode: (value) => (typeof value === "number" ? value : Number(value)),
      encode: (value) => value,
    }),
  ),
);

export const Flag: Schema.Codec<boolean, boolean | number | string> = Schema.Union([
  Schema.Boolean,
  Schema.Finite,
  Schema.String,
]).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (value) =>
        typeof value === "boolean"
          ? value
          : typeof value === "number"
            ? value !== 0
            : value === "1",
      encode: (value) => value,
    }),
  ),
);

export function singleEntry<A>(value: ReadonlyArray<A> | A): A | undefined {
  return isReadonlyArray(value) ? value[0] : value;
}

export function isReadonlyArray<A>(value: ReadonlyArray<A> | A): value is ReadonlyArray<A> {
  return Array.isArray(value);
}

export function optionalNonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

export function numberOrNull(value: number | string | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && /^-?(?:\d+(?:\.\d*)?|\.\d+)$/u.test(value)) {
    return Number(value);
  }
  return null;
}

export function percentOrNull(
  value: number | string | null | undefined,
  operation: string,
  field: string,
): Effect.Effect<number | null, YahooParseError> {
  if (value === undefined || value === null) {
    return Effect.succeed(null);
  }
  const percent =
    typeof value === "number"
      ? Number.isFinite(value)
        ? value
        : undefined
      : /^-?\d+(?:\.\d+)?$/u.test(value)
        ? Number(value)
        : undefined;
  return percent === undefined || percent < 0 || percent > 100
    ? Effect.fail(new YahooParseError({ operation, field }))
    : Effect.succeed(percent);
}

export function timestampIso(
  seconds: number,
  operation: string,
  field: string,
): Effect.Effect<string, YahooParseError> {
  return Effect.fromOption(
    DateTime.make(seconds * 1_000),
    () => new YahooParseError({ operation, field }),
  ).pipe(Effect.map((instant) => DateTime.formatIso(instant)));
}

export function decodePayload<A, E>(
  schema: Schema.Codec<A, E>,
  payload: unknown,
  operation: string,
): Effect.Effect<A, YahooParseError> {
  return Schema.decodeUnknownEffect(schema)(payload).pipe(
    Effect.catchTag("SchemaError", (error) =>
      Effect.fail(new YahooParseError({ operation, field: invalidField(error.issue) })),
    ),
  );
}

export function invalidField(issue: SchemaIssue.Issue): string | undefined {
  const path = issuePath(issue);
  return path.length === 0 ? undefined : path.map(String).join(".");
}

function issuePath(root: SchemaIssue.Issue): ReadonlyArray<PropertyKey> {
  const path: Array<PropertyKey> = [];
  const pending: Array<SchemaIssue.Issue> = [root];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    switch (current._tag) {
      case "Pointer":
        for (const segment of current.path) {
          path.push(segment);
        }
        pending.push(current.issue);
        break;
      case "Filter":
      case "Encoding":
        pending.push(current.issue);
        break;
      case "Composite":
      case "AnyOf": {
        const first = current.issues.at(0);
        if (first !== undefined) {
          pending.push(first);
        }
        break;
      }
      case "Forbidden":
      case "InvalidType":
      case "InvalidValue":
      case "MissingKey":
      case "OneOf":
      case "UnexpectedKey":
        break;
    }
  }
  return path;
}
