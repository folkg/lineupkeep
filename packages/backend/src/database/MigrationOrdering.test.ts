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

describe("local linking helper removal migration", () => {
  const removeHelperMigration = "20261029120000_remove_linking_helper";

  it.effect("drops the pairing state and removes the first-party device client", () =>
    Effect.gen(function* () {
      const sql = yield* PgliteClient.PgliteClient;

      for (const statement of migrationStatements((name) => name < removeHelperMigration)) {
        yield* sql.unsafe(statement);
      }

      yield* sql.unsafe(`
        insert into provider_connections (id, user_id, request_id, provider, status, pairing_code, reconnect_code, created_at, updated_at)
        values ('kept', 'owner', 'request-kept', 'yahoo', 'ready', 'ABCD2345', 'WXYZ6789', now(), now())
      `);
      yield* sql.unsafe(`
        insert into device_code (id, device_code, user_code, expires_at, status)
        values ('device', 'device-code', 'ABCD2345', now(), 'pending')
      `);
      yield* sql.unsafe(`
        insert into oauth_client (id, client_id, redirect_uris)
        values ('helper', 'lineupkeep-linking-helper', '{}')
      `);
      yield* sql.unsafe(`
        insert into oauth_client_resource (id, client_id, resource_id)
        values ('helper-resource', 'lineupkeep-linking-helper', 'http://localhost:5173/mcp')
      `);
      yield* sql.unsafe(`
        insert into oauth_consent (id, client_id, scopes, created_at, updated_at)
        values ('helper-consent', 'lineupkeep-linking-helper', '{connections:link}', now(), now())
      `);

      for (const statement of migrationStatements((name) => name === removeHelperMigration)) {
        yield* sql.unsafe(statement);
      }

      const columns = yield* sql.unsafe<{ readonly column_name: string }>(
        "select column_name from information_schema.columns where table_name = 'provider_connections'",
      );
      expect(columns.map((row) => row.column_name)).not.toContain("pairing_code");
      expect(columns.map((row) => row.column_name)).not.toContain("reconnect_code");
      expect(columns.map((row) => row.column_name)).not.toContain("reconnect_expires_at");
      expect(columns.map((row) => row.column_name)).not.toContain("reconnect_request_id");

      const kept = yield* sql.unsafe<{ readonly id: string }>(
        "select id from provider_connections order by id",
      );
      expect(kept).toEqual([{ id: "kept" }]);

      const deviceTable = yield* sql.unsafe<{ readonly table: string | null }>(
        "select to_regclass('public.device_code')::text as table",
      );
      expect(deviceTable).toEqual([{ table: null }]);

      for (const table of ["oauth_client", "oauth_client_resource", "oauth_consent"]) {
        const rows = yield* sql.unsafe<{ readonly count: number }>(
          `select count(*)::int as count from "${table}" where client_id = 'lineupkeep-linking-helper'`,
        );
        expect(rows).toEqual([{ count: 0 }]);
      }
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
