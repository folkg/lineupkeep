import { createHash } from "node:crypto";

import {
  postgresConnection,
  postgresContainer,
  testContainers,
} from "@lineupkeep/tools/local-stack/postgresContainer.ts";
import * as Provider from "alchemy/Provider";
import { Resource } from "alchemy/Resource";
import { Effect, Redacted } from "effect";

export const Postgres = Resource<PostgresResource>("Lineupgrade.LocalPostgres");

export const postgresProvider = Provider.succeed(Postgres, {
  read: ({ olds }) => inspect(olds),
  diff: () => Effect.succeed({ action: "update" as const }),
  reconcile: ({ news }) =>
    Effect.gen(function* () {
      const existing = yield* inspect(news);
      if (existing !== undefined) {
        return existing;
      }
      return yield* Effect.tryPromise(async () => {
        const database = postgresContainer(news.name, news.lockDirectory);
        const url = await database.create(AbortSignal.timeout(120_000));
        return { name: news.name, url: Redacted.make(url.href) };
      });
    }),
  delete: ({ olds }) =>
    Effect.tryPromise(() =>
      postgresContainer(olds.name, olds.lockDirectory).remove(AbortSignal.timeout(50_000), false),
    ),
});

export function localDatabaseName(stage: string): string {
  const checkout = createHash("sha256")
    .update(new URL("../../", import.meta.url).pathname)
    .digest("hex")
    .slice(0, 10);
  return `lineupkeep-alchemy-${checkout}-${stage}`;
}

function inspect(properties: { name: string; lockDirectory: string }): Effect.Effect<
  | {
      name: string;
      url: Redacted.Redacted<string>;
    }
  | undefined,
  import("effect/Cause").UnknownError,
  never
> {
  return Effect.tryPromise(async () => {
    const signal = AbortSignal.timeout(60_000);
    const container = (await testContainers(signal)).find(
      (entry) => entry.name === properties.name,
    );
    if (container === undefined) {
      return undefined;
    }
    if (container.lockDirectory !== properties.lockDirectory) {
      throw new Error("Refusing a Postgres container owned by another checkout");
    }
    return {
      name: properties.name,
      url: Redacted.make((await postgresConnection(properties.name, signal)).href),
    };
  });
}

type PostgresResource = Resource<
  "Lineupgrade.LocalPostgres",
  { name: string; lockDirectory: string },
  { name: string; url: Redacted.Redacted<string> }
>;
