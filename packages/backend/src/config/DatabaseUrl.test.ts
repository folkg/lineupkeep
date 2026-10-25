import { inspect } from "node:util";

import { expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";

import { databaseUrlConfig } from "./DatabaseUrl.ts";

it.effect("decodes a PostgreSQL database URL from Effect configuration", () =>
  Effect.gen(function* () {
    const provider = ConfigProvider.fromUnknown({
      DATABASE_URL: "postgres://user:password@localhost:5432/lineupkeep_app",
    });

    const databaseUrl = yield* databaseUrlConfig.parse(provider);

    expect(Redacted.value(databaseUrl)).toBe(
      "postgres://user:password@localhost:5432/lineupkeep_app",
    );
  }),
);

it.effect("keeps database credentials redacted in diagnostics", () =>
  Effect.gen(function* () {
    const provider = ConfigProvider.fromUnknown({
      DATABASE_URL: "postgres://reader:diagnostic-secret@db.test/lineupkeep",
    });

    const url = yield* databaseUrlConfig.parse(provider);

    expect(Redacted.isRedacted(url)).toBe(true);
    expect(String(url)).toBe("<redacted>");
    expect(JSON.stringify({ url })).toBe('{"url":"<redacted>"}');
    expect(inspect(url)).toBe("<redacted>");
  }),
);

it.effect("rejects a non-PostgreSQL database URL", () =>
  Effect.gen(function* () {
    const provider = ConfigProvider.fromUnknown({ DATABASE_URL: "https://example.com" });

    const exit = yield* Effect.exit(databaseUrlConfig.parse(provider));

    expect(Exit.isFailure(exit)).toBe(true);
  }),
);
