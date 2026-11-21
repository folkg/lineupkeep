import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PgliteClient } from "@effect/sql-pglite";
import { describe, expect, it } from "@effect/vitest";
import { EffectString } from "@lineupkeep/collections";
import { Effect, Exit } from "effect";
import { Array as EffectArray } from "effect";

import layerTools from "#runtime/ProvideLayer.ts";

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
      expect(EffectArray.map(connections, (row) => row.id)).toEqual(["kept"]);

      const sessions = yield* sql.unsafe<{
        readonly id: string;
        readonly connection_id: string | null;
      }>("select id, connection_id from hosted_linking_sessions order by id");
      expect(sessions).toEqual([
        { id: "session-abandoned", connection_id: null },
        { id: "session-kept", connection_id: "kept" },
      ]);
    }).pipe(layerTools.provide(PgliteClient.layer())),
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
      expect(EffectArray.map(columns, (row) => row.column_name)).not.toContain("pairing_code");
      expect(EffectArray.map(columns, (row) => row.column_name)).not.toContain("reconnect_code");
      expect(EffectArray.map(columns, (row) => row.column_name)).not.toContain(
        "reconnect_expires_at",
      );
      expect(EffectArray.map(columns, (row) => row.column_name)).not.toContain(
        "reconnect_request_id",
      );

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
    }).pipe(layerTools.provide(PgliteClient.layer())),
  );
});

describe("lineupgrade identifier storage migration", () => {
  const identifierMigration = "20261107141439_ordinary_thena";
  const oldConnection = "00000000-0000-7000-8000-000000000001";
  const oldTeam = "018f79ea-7d86-7c18-9b4a-8b4d0c916001";
  const oldNote = "018f79ea-7d86-7c18-9b4a-8b4d0c916002";
  const oldFeedback = "018f79ea-7d86-7c18-9b4a-8b4d0c916003";
  const newTeam = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
  const newNote = "01ARZ3NDEKTSV4RRFFQ69G5FAW";

  it.effect("keeps stored UUID values and accepts a ULID in the same columns", () =>
    Effect.gen(function* () {
      const sql = yield* PgliteClient.PgliteClient;

      for (const statement of migrationStatements((name) => name < identifierMigration)) {
        yield* sql.unsafe(statement);
      }

      yield* sql.unsafe(`
        insert into provider_connections (id, user_id, request_id, provider, status, created_at, updated_at)
        values ('${oldConnection}', 'owner', 'request-1', 'yahoo', 'ready', now(), now())
      `);
      yield* sql.unsafe(`
        insert into provider_teams (
          id, connection_id, user_id, provider, provider_team_key, provider_league_key,
          league, sport, season, name, automation_state, automation_status,
          last_seen_at, created_at, updated_at
        )
        values (
          '${oldTeam}', '${oldConnection}', 'owner', 'yahoo', 'nhl.l.1.t.1', 'nhl.l.1',
          'nhl', 'hockey', 2026, 'Red Line', '{}'::jsonb, 'disabled', now(), now(), now()
        )
      `);
      yield* sql.unsafe(`
        insert into provider_team_agent_notes (
          id, team_id, connection_id, user_id, body, author_client_id, written_at
        )
        values ('${oldNote}', '${oldTeam}', '${oldConnection}', 'owner', 'old note', 'client', now())
      `);
      yield* sql.unsafe(`
        insert into feedback (
          id, user_id, submitter_kind, submitter_reference, kind, status, title, body,
          created_at, updated_at
        )
        values ('${oldFeedback}', 'owner', 'user', 'web', 'bug', 'open', 'Old', 'Body', now(), now())
      `);

      for (const statement of migrationStatements((name) => name === identifierMigration)) {
        yield* sql.unsafe(statement);
      }

      expect(
        yield* sql.unsafe<{ readonly id: string }>("select id from provider_teams order by id"),
      ).toEqual([{ id: oldTeam }]);
      expect(
        yield* sql.unsafe<{ readonly id: string; readonly team_id: string }>(
          "select id, team_id from provider_team_agent_notes order by id",
        ),
      ).toEqual([{ id: oldNote, team_id: oldTeam }]);
      expect(
        yield* sql.unsafe<{ readonly id: string }>("select id from feedback order by id"),
      ).toEqual([{ id: oldFeedback }]);

      const converted = yield* sql.unsafe<{
        readonly table_name: string;
        readonly column_name: string;
      }>(`
        select table_name, column_name
        from information_schema.columns
        where data_type <> 'text' and (table_name, column_name) in (
          ('provider_teams', 'id'),
          ('provider_team_agent_notes', 'id'),
          ('provider_team_agent_notes', 'team_id'),
          ('feedback', 'id'),
          ('connection_incidents', 'id'),
          ('notifications', 'id'),
          ('notifications', 'incident_id'),
          ('lineup_runs', 'id'),
          ('lineup_runs', 'team_id'),
          ('lineup_deliveries', 'id'),
          ('lineup_team_leases', 'team_id'),
          ('lineup_team_leases', 'run_id'),
          ('lineup_team_leases', 'token'),
          ('lineup_run_attempts', 'run_id'),
          ('lineup_run_attempts', 'lease_token'),
          ('lineup_run_diagnostics', 'id'),
          ('lineup_run_diagnostics', 'run_id'),
          ('lineup_run_diagnostics', 'team_id'),
          ('lineup_write_intents', 'id'),
          ('lineup_write_intents', 'run_id'),
          ('lineup_write_intents', 'team_id'),
          ('lineup_write_intents', 'lease_token')
        )
        order by table_name, column_name
      `);
      expect(converted).toEqual([]);

      const missingTeam = yield* Effect.exit(
        sql.unsafe(`
          insert into provider_team_agent_notes (
            id, team_id, connection_id, user_id, body, author_client_id, written_at
          )
          values ('${newNote}', 'missing-team', '${oldConnection}', 'owner', 'note', 'client', now())
        `),
      );
      expect(Exit.isFailure(missingTeam)).toBe(true);

      yield* sql.unsafe(`
        insert into provider_teams (
          id, connection_id, user_id, provider, provider_team_key, provider_league_key,
          league, sport, season, name, automation_state, automation_status,
          last_seen_at, created_at, updated_at
        )
        values (
          '${newTeam}', '${oldConnection}', 'owner', 'yahoo', 'nhl.l.1.t.2', 'nhl.l.1',
          'nhl', 'hockey', 2026, 'New Line', '{}'::jsonb, 'disabled', now(), now(), now()
        )
      `);
      yield* sql.unsafe(`
        insert into provider_team_agent_notes (
          id, team_id, connection_id, user_id, body, author_client_id, written_at
        )
        values ('${newNote}', '${newTeam}', '${oldConnection}', 'owner', 'new note', 'client', now())
      `);

      expect(
        yield* sql.unsafe<{ readonly id: string }>("select id from provider_teams order by id"),
      ).toEqual([{ id: oldTeam }, { id: newTeam }]);
    }).pipe(layerTools.provide(PgliteClient.layer())),
  );
});

describe("ready connection approval backfill", () => {
  const backfillMigration = "20261112191452_backfill_ready_connection_approval";

  it.effect("records the last write as the approval time when a ready connection has none", () =>
    Effect.gen(function* () {
      const sql = yield* PgliteClient.PgliteClient;

      for (const statement of migrationStatements((name) => name < backfillMigration)) {
        yield* sql.unsafe(statement);
      }

      yield* sql.unsafe(`
        insert into provider_connections
          (id, user_id, request_id, provider, status, created_at, updated_at, approved_at)
        values
          ('ready-legacy', 'owner', 'request-legacy', 'yahoo', 'ready',
            '2026-10-25T12:51:57Z', '2026-11-10T02:17:47Z', null),
          ('ready-approved', 'owner', 'request-approved', 'yahoo', 'ready',
            '2026-11-01T10:00:00Z', '2026-11-02T10:00:00Z', '2026-11-01T10:30:00Z'),
          ('reconnecting', 'owner', 'request-reconnecting', 'yahoo', 'reconnect-required',
            '2026-11-01T10:00:00Z', '2026-11-03T10:00:00Z', null)
      `);

      for (const statement of migrationStatements((name) => name === backfillMigration)) {
        yield* sql.unsafe(statement);
      }

      const rows = yield* sql.unsafe<{
        readonly id: string;
        readonly missing: boolean;
        readonly matches_update: boolean;
      }>(
        "select id, approved_at is null as missing, coalesce(approved_at = updated_at, false) as matches_update from provider_connections order by id",
      );
      expect(rows).toEqual([
        { id: "ready-approved", missing: false, matches_update: false },
        { id: "ready-legacy", missing: false, matches_update: true },
        { id: "reconnecting", missing: true, matches_update: false },
      ]);
    }).pipe(layerTools.provide(PgliteClient.layer())),
  );
});

describe("transaction plan storage migration", () => {
  const planMigration = "20261114173618_transaction_plans";
  const team = "01ARZ3NDEKTSV4RRFFQ69G5FAV";

  it.effect("adds the plan tables and refuses a second plan for one owner and team", () =>
    Effect.gen(function* () {
      const sql = yield* PgliteClient.PgliteClient;

      for (const statement of migrationStatements((name) => name < planMigration)) {
        yield* sql.unsafe(statement);
      }

      yield* sql.unsafe(`
        insert into provider_teams (
          id, connection_id, user_id, provider, provider_team_key, provider_league_key,
          league, sport, season, name, automation_state, automation_status,
          last_seen_at, created_at, updated_at
        )
        values (
          '${team}', 'connection', 'owner', 'yahoo', 'nhl.l.1.t.1', 'nhl.l.1',
          'nhl', 'hockey', 2026, 'Red Line', '{}'::jsonb, 'disabled', now(), now(), now()
        )
      `);

      for (const statement of migrationStatements((name) => name === planMigration)) {
        yield* sql.unsafe(statement);
      }

      for (const table of [
        "transaction_plans",
        "transaction_moves",
        "transaction_move_claims",
        "transaction_move_steps",
      ]) {
        const found = yield* sql.unsafe<{ readonly table: string | null }>(
          `select to_regclass('public.${table}')::text as "table"`,
        );
        expect(found).toEqual([{ table }]);
      }

      yield* sql.unsafe(`
        insert into transaction_plans (user_id, team_id) values ('owner', '${team}')
      `);
      const duplicate = yield* Effect.exit(
        sql.unsafe(`
          insert into transaction_plans (user_id, team_id) values ('owner', '${team}')
        `),
      );
      expect(Exit.isFailure(duplicate)).toBe(true);

      const plans = yield* sql.unsafe<{ readonly user_id: string; readonly team_id: string }>(
        "select user_id, team_id from transaction_plans",
      );
      expect(plans).toEqual([{ user_id: "owner", team_id: team }]);
    }).pipe(layerTools.provide(PgliteClient.layer())),
  );
});

describe("transaction proposal storage removal migration", () => {
  const removalMigration = "20261115030613_chilly_sway";
  const team = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
  const move = "01ARZ3NDEKTSV4RRFFQ69G5FAW";

  it.effect("drops the proposal tables and leaves the plan tables and their rows", () =>
    Effect.gen(function* () {
      const sql = yield* PgliteClient.PgliteClient;

      for (const statement of migrationStatements((name) => name < removalMigration)) {
        yield* sql.unsafe(statement);
      }

      yield* sql.unsafe(`
        insert into provider_teams (
          id, connection_id, user_id, provider, provider_team_key, provider_league_key,
          league, sport, season, name, automation_state, automation_status,
          last_seen_at, created_at, updated_at
        )
        values (
          '${team}', 'connection', 'owner', 'yahoo', 'nhl.l.1.t.1', 'nhl.l.1',
          'nhl', 'hockey', 2026, 'Red Line', '{}'::jsonb, 'disabled', now(), now(), now()
        )
      `);
      yield* sql.unsafe(`
        insert into transaction_plans (user_id, team_id) values ('owner', '${team}')
      `);
      yield* sql.unsafe(`
        insert into transaction_moves
          (id, user_id, team_id, position, kind, adds, fallbacks, drops, picks, reason, decision,
            validation, validation_reasons, proposed_by)
        values
          ('${move}', 'owner', '${team}', 0, 'drop', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
            '[]'::jsonb, 'Keep the queue.', 'undecided', 'checked', '[]'::jsonb,
            '{"kind":"user","reference":"web","surface":"app"}'::jsonb)
      `);
      yield* sql.unsafe(`
        insert into transaction_move_claims (user_id, team_id, claim_kind, claim_key, move_id)
        values ('owner', '${team}', 'player', 'p.1', '${move}')
      `);
      yield* sql.unsafe(`
        insert into transaction_move_steps
          (id, move_id, position, kind, player_key, outcome, decided_at)
        values
          ('01ARZ3NDEKTSV4RRFFQ69G5FAX', '${move}', 0, 'drop', 'p.1', 'executed', now())
      `);

      yield* sql.unsafe(`
        insert into transaction_proposal_sets
          (id, user_id, proposer_kind, proposer_reference, surface, fingerprint, teams)
        values
          ('11111111-1111-4111-8111-111111111111', 'owner', 'agent', 'mcp', 'mcp', 'old',
            '[]'::jsonb)
      `);
      yield* sql.unsafe(`
        insert into transaction_proposal_submissions
          (id, set_id, user_id, ordinal, submitted_at)
        values
          ('44444444-4444-4444-8444-111111111111', '11111111-1111-4111-8111-111111111111',
            'owner', 1, now())
      `);
      yield* sql.unsafe(`
        insert into transaction_proposal_items
          (id, set_id, position, user_id, team_id, connection_id, kind, add_players, drop_players,
            reason, state, staleness, stale_reasons)
        values
          ('22222222-2222-4222-8222-111111111111', '11111111-1111-4111-8111-111111111111', 0,
            'owner', '${team}', 'connection', 'drop', '[]'::jsonb, '[]'::jsonb, 'Old move',
            'proposed', 'current', '[]'::jsonb)
      `);
      yield* sql.unsafe(`
        insert into transaction_proposal_steps
          (id, set_id, item_id, user_id, position, kind, player_key, outcome, decided_at)
        values
          ('33333333-3333-4333-8333-111111111111', '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-111111111111', 'owner', 0, 'drop', 'p.1', 'proposed', now())
      `);

      for (const statement of migrationStatements((name) => name === removalMigration)) {
        yield* sql.unsafe(statement);
      }

      for (const table of [
        "transaction_proposal_sets",
        "transaction_proposal_items",
        "transaction_proposal_submissions",
        "transaction_proposal_steps",
      ]) {
        const found = yield* sql.unsafe<{ readonly table: string | null }>(
          `select to_regclass('public.${table}')::text as "table"`,
        );
        expect(found).toEqual([{ table: null }]);
      }

      const counts = yield* sql.unsafe<{
        readonly plans: number;
        readonly moves: number;
        readonly claims: number;
        readonly steps: number;
      }>(`
        select
          (select count(*)::int from transaction_plans) as plans,
          (select count(*)::int from transaction_moves) as moves,
          (select count(*)::int from transaction_move_claims) as claims,
          (select count(*)::int from transaction_move_steps) as steps
      `);
      expect(counts).toEqual([{ plans: 1, moves: 1, claims: 1, steps: 1 }]);

      const stored = yield* sql.unsafe<{ readonly reason: string; readonly decision: string }>(
        `select reason, decision from transaction_moves where id = '${move}'`,
      );
      expect(stored).toEqual([{ reason: "Keep the queue.", decision: "undecided" }]);
    }).pipe(layerTools.provide(PgliteClient.layer())),
  );
});

function migrationStatements(select: (name: string) => boolean): ReadonlyArray<string> {
  const statements: string[] = [];
  for (const name of EffectArray.filter(readdirSync(migrationsFolder), select).sort()) {
    const contents = readFileSync(join(migrationsFolder, name, "migration.sql"), "utf8");
    for (const statement of EffectString.split(contents, "--> statement-breakpoint")) {
      const trimmed = EffectString.trim(statement);
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
    }
  }
  return statements;
}
