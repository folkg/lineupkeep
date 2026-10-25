import { Effect, Schema } from "effect";

import {
  NarrowingResult,
  QueryBudget,
  QueryCursorInvalid,
  QueryPage,
  type QueryError,
} from "#contexts/connections/QueryValues.ts";

const queryResultTargetBytes = 12 * 1024;
const queryResultHardLimitBytes = 16 * 1024;

const envelopeAllowanceBytes = 1_024;
const cursorPlaceholder = "x".repeat(256);
const utf8 = new TextEncoder();

export const queryBudget: QueryBudget = {
  targetBytes: queryResultTargetBytes,
  hardLimitBytes: queryResultHardLimitBytes,
};

export type FitPageInput<Row, Result> = {
  readonly schema: Schema.Codec<Result, unknown>;
  readonly rows: ReadonlyArray<Row>;
  readonly offset: number;
  readonly limit: number;
  readonly resource: string;
  readonly groups: ReadonlyArray<string> | undefined;
  readonly build: (rows: ReadonlyArray<Row>, page: QueryPage) => Result;
  readonly makeNext: (offset: number) => Effect.Effect<string, QueryError>;
  readonly recordLabel: (row: Row) => string;
};

export function fitPage<Row, Result>(
  input: FitPageInput<Row, Result>,
): Effect.Effect<Result | NarrowingResult, QueryError> {
  return Effect.gen(function* () {
    const available = input.rows.length - input.offset;
    if (available < 0) {
      return yield* QueryCursorInvalid.make({ reason: "invalid" });
    }
    const maximum = Math.min(input.limit, available);
    if (maximum === 0) {
      const base = input.build([], {
        returned: 0,
        complete: true,
        remaining: 0,
      });
      return clientResultBytes(input.schema, base) <= queryResultHardLimitBytes
        ? base
        : narrowing(input, undefined);
    }

    const pageFor = (returned: number, next: string | undefined): QueryPage => {
      const remaining = available - returned;
      return {
        returned,
        complete: remaining === 0,
        remaining,
        ...(next === undefined ? {} : { next }),
      };
    };

    const choose = (budgetBytes: number): number | undefined => {
      for (let returned = maximum; returned >= 1; returned -= 1) {
        const remaining = available - returned;
        const page = pageFor(returned, remaining === 0 ? undefined : cursorPlaceholder);
        const candidate = input.build(
          input.rows.slice(input.offset, input.offset + returned),
          page,
        );
        if (clientResultBytes(input.schema, candidate) <= budgetBytes) {
          return returned;
        }
      }
      return undefined;
    };

    let returned = choose(queryResultTargetBytes) ?? choose(queryResultHardLimitBytes);
    if (returned === undefined) {
      return narrowing(input, input.rows[input.offset]);
    }

    while (returned >= 1) {
      const remaining = available - returned;
      const next = remaining === 0 ? undefined : yield* input.makeNext(input.offset + returned);
      const result = input.build(
        input.rows.slice(input.offset, input.offset + returned),
        pageFor(returned, next),
      );
      if (clientResultBytes(input.schema, result) <= queryResultHardLimitBytes) {
        return result;
      }
      returned -= 1;
    }
    return narrowing(input, input.rows[input.offset]);
  });
}

function clientResultBytes(schema: Schema.Codec<unknown, unknown>, value: unknown): number {
  const encoded = Schema.encodeSync(Schema.toCodecJson(schema))(value);
  const structuredContent = JSON.stringify(encoded);
  const textContent = escapedTextContent(structuredContent);
  return (
    utf8.encode(structuredContent).length + utf8.encode(textContent).length + envelopeAllowanceBytes
  );
}

function escapedTextContent(json: string): string {
  return JSON.stringify(json).slice(1, -1);
}

function narrowing<Row, Result>(
  input: FitPageInput<Row, Result>,
  record: Row | undefined,
): NarrowingResult {
  return {
    status: "narrowing_required",
    resource: input.resource,
    ...(record === undefined ? {} : { record: input.recordLabel(record) }),
    ...(input.groups === undefined ? {} : { groups: [...input.groups] }),
    detail:
      "A complete record cannot fit inside the response budget. Request fewer groups or a narrower selection.",
    budget: queryBudget,
  };
}
