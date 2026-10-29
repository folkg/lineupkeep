import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PgliteClient } from "@effect/sql-pglite";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";

const migrationsFolder = "packages/backend/migrations";
const targetMigration = "20261028220000_hosted_linking_connection_on_success";

describe("hosted linking connection migration", () => {
  it.effect("removes abandoned connections, keeps completed ones, and allows a null link", () =>
    Effect.gen(function* () {
      const sql = yield* PgliteClient.PgliteClient;

      for (const statement of migrationStatements((name) => name < targetMigration)) {
        yield* sql.unsafe(statement);
      }

      yield* sql.unsafe(`
        insert into provider_connections (id, user_id, request_id, provider, status, pairing_code, created_at, updated_at)
        values
          ('abandoned', 'owner', 'request-abandoned', 'yahoo', 'disconnected', 'hosted-abandoned', now(), now()),
          ('kept', 'owner', 'request-kept', 'yahoo', 'ready', 'hosted-kept', now(), now())
      `);
      yield* sql.unsafe(`
        insert into hosted_linking_sessions (id, user_id, connection_id, provider, status, ticket_hash, started_at, expires_at, created_at, updated_at)
        values
          ('session-abandoned', 'owner', 'abandoned', 'yahoo', 'cancelled', 'hash', now(), now(), now(), now()),
          ('session-kept', 'owner', 'kept', 'yahoo', 'completed', 'hash', now(), now(), now(), now())
      `);

      for (const statement of migrationStatements((name) => name === targetMigration)) {
        yield* sql.unsafe(statement);
      }

      const connections = yield* sql.unsafe<{ readonly id: string }>(
        "select id from provider_connections order by id",
      );
      expect(connections.map((row) => row.id)).toEqual(["kept"]);

      const sessions = yield* sql.unsafe<{
        readonly id: string;
        readonly connection_id: string | null;
      }>("select id, connection_id from hosted_linking_sessions order by id");
      expect(sessions).toEqual([
        { id: "session-abandoned", connection_id: null },
        { id: "session-kept", connection_id: "kept" },
      ]);
    }).pipe(Effect.provide(PgliteClient.layer())),
  );
});

function migrationStatements(select: (name: string) => boolean): ReadonlyArray<string> {
  const statements: string[] = [];
  for (const name of readdirSync(migrationsFolder).filter(select).sort()) {
    const contents = readFileSync(join(migrationsFolder, name, "migration.sql"), "utf8");
    for (const statement of contents.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
    }
  }
  return statements;
}
