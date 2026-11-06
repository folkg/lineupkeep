import { assert, it } from "@effect/vitest";
import { DateTime, Effect, Layer } from "effect";

import type { AuthorizationScope } from "#contexts/auth/AuthorizationScopes.ts";

import { AuthDatabase } from "./AuthDatabase.ts";
import { AuthDatabaseTest } from "./AuthDatabaseTest.ts";
import { OAuthClientRepository } from "./OAuthClientRepository.ts";
import { oauthClient } from "./OAuthTables.ts";

const registeredAt = DateTime.toDateUtc(DateTime.makeUnsafe("2026-01-01T00:00:00.000Z"));

const advertised: ReadonlyArray<AuthorizationScope> = [
  { name: "fantasy:read", description: "Read fantasy data." },
  { name: "lineups:write", description: "Change lineups." },
  { name: "offline_access", description: "Stay connected." },
];

const advertisedNames = advertised.map((scope) => scope.name);
const registrableNames = [...advertisedNames, "connections:read"];

it.effect(
  "widens only dynamic registrations whose scopes are a strict subset of the registrable scopes",
  () =>
    Effect.gen(function* () {
      const database = yield* AuthDatabase;
      const repository = yield* OAuthClientRepository;

      yield* Effect.promise(() =>
        database.insert(oauthClient).values([
          registration("dynamic-subset", { scopes: ["fantasy:read"] }),
          registration("dynamic-reordered", {
            scopes: ["offline_access", "lineups:write", "fantasy:read"],
          }),
          registration("dynamic-current", { scopes: [...advertisedNames] }),
          registration("dynamic-retired", { scopes: ["fantasy:read", "connections:read"] }),
          registration("owner-client", {
            scopes: ["fantasy:read"],
            userId: "user-1",
          }),
          registration("discovered-client", {
            scopes: ["fantasy:read"],
            clientDiscoveryId: "https://client.test/metadata.json",
          }),
          registration("resource-client", { scopes: ["fantasy:read"], referenceId: "resource-1" }),
          registration("unscoped-client", { scopes: null }),
        ]),
      );
      const before = yield* Effect.promise(() => database.select().from(oauthClient));

      yield* repository.widenDynamicRegistrations(advertised);

      const after = yield* Effect.promise(() => database.select().from(oauthClient));
      assert.deepStrictEqual(scopesById(after), {
        "dynamic-subset": registrableNames,
        "dynamic-reordered": ["offline_access", "lineups:write", "fantasy:read"],
        "dynamic-current": advertisedNames,
        "dynamic-retired": registrableNames,
        "owner-client": ["fantasy:read"],
        "discovered-client": ["fantasy:read"],
        "resource-client": ["fantasy:read"],
        "unscoped-client": null,
      });
      assert.deepStrictEqual(
        untouchedTimestamps(after, ["dynamic-subset", "dynamic-retired"]),
        untouchedTimestamps(before, ["dynamic-subset", "dynamic-retired"]),
      );
    }).pipe(Effect.provide(OAuthClientRepository.layer.pipe(Layer.provideMerge(AuthDatabaseTest)))),
  30_000,
);

function registration(
  id: string,
  options: {
    readonly scopes: ReadonlyArray<string> | null;
    readonly userId?: string;
    readonly clientDiscoveryId?: string;
    readonly referenceId?: string;
  },
): typeof oauthClient.$inferInsert {
  return {
    id,
    clientId: `client-${id}`,
    redirectUris: [`https://${id}.test/callback`],
    scopes: options.scopes === null ? null : [...options.scopes],
    createdAt: registeredAt,
    updatedAt: registeredAt,
    userId: options.userId ?? null,
    clientDiscoveryId: options.clientDiscoveryId ?? null,
    referenceId: options.referenceId ?? null,
  };
}

function scopesById(
  rows: ReadonlyArray<typeof oauthClient.$inferSelect>,
): Record<string, ReadonlyArray<string> | null> {
  return Object.fromEntries(rows.map((row) => [row.id, row.scopes]));
}

function untouchedTimestamps(
  rows: ReadonlyArray<typeof oauthClient.$inferSelect>,
  widened: ReadonlyArray<string>,
): Record<string, Date | null> {
  return Object.fromEntries(
    rows.filter((row) => !widened.includes(row.id)).map((row) => [row.id, row.updatedAt]),
  );
}
