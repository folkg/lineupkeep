import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PgliteClient } from "@effect/sql-pglite";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";

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

describe("proposal submission history migration", () => {
  const submissionMigration = "20261107120001_proposal_submissions";

  it.effect("keeps each submitted set as one submission and marks ended moves settled", () =>
    Effect.gen(function* () {
      const sql = yield* PgliteClient.PgliteClient;

      for (const statement of migrationStatements((name) => name < submissionMigration)) {
        yield* sql.unsafe(statement);
      }

      yield* sql.unsafe(`
        insert into transaction_proposal_sets
          (id, user_id, proposer_kind, proposer_reference, surface, fingerprint, teams,
            submitted_by_user_id, submitted_at, completed_at, expires_at)
        values
          ('11111111-1111-4111-8111-111111111111', 'owner', 'agent', 'mcp', 'mcp', 'submitted',
            '[]'::jsonb, 'owner', '2026-11-01T10:00:00Z', '2026-11-01T11:00:00Z',
            '2026-11-02T10:00:00Z'),
          ('11111111-1111-4111-8111-222222222222', 'owner', 'agent', 'mcp', 'mcp', 'open',
            '[]'::jsonb, null, null, null, '2026-11-02T10:00:00Z')
      `);
      yield* sql.unsafe(`
        insert into transaction_proposal_items
          (id, set_id, position, user_id, team_id, connection_id, kind, add_players,
            drop_players, reason, state, staleness, stale_reasons)
        values
          ('22222222-2222-4222-8222-111111111111', '11111111-1111-4111-8111-111111111111', 0,
            'owner', '33333333-3333-4333-8333-111111111111', 'connection', 'drop',
            '[]'::jsonb, '[]'::jsonb, 'Executed move', 'executed', 'current', '[]'::jsonb),
          ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 1,
            'owner', '33333333-3333-4333-8333-111111111111', 'connection', 'drop',
            '[]'::jsonb, '[]'::jsonb, 'Failed move', 'failed', 'current', '[]'::jsonb),
          ('22222222-2222-4222-8222-333333333333', '11111111-1111-4111-8111-111111111111', 2,
            'owner', '33333333-3333-4333-8333-111111111111', 'connection', 'drop',
            '[]'::jsonb, '[]'::jsonb, 'Skipped move', 'skipped', 'current', '[]'::jsonb),
          ('22222222-2222-4222-8222-444444444444', '11111111-1111-4111-8111-222222222222', 0,
            'owner', '33333333-3333-4333-8333-111111111111', 'connection', 'drop',
            '[]'::jsonb, '[]'::jsonb, 'Open move', 'proposed', 'current', '[]'::jsonb)
      `);

      for (const statement of migrationStatements((name) => name === submissionMigration)) {
        yield* sql.unsafe(statement);
      }

      const submissions = yield* sql.unsafe<{
        readonly set_id: string;
        readonly user_id: string;
        readonly ordinal: number;
      }>("select set_id, user_id, ordinal from transaction_proposal_submissions");
      expect(submissions).toEqual([
        {
          set_id: "11111111-1111-4111-8111-111111111111",
          user_id: "owner",
          ordinal: 1,
        },
      ]);

      const settled = yield* sql.unsafe<{ readonly state: string; readonly settled: boolean }>(
        "select state, settled from transaction_proposal_items order by set_id, position, id",
      );
      expect(settled).toEqual([
        { state: "executed", settled: true },
        { state: "failed", settled: false },
        { state: "skipped", settled: false },
        { state: "proposed", settled: false },
      ]);

      const columns = yield* sql.unsafe<{ readonly column_name: string }>(
        "select column_name from information_schema.columns where table_name = 'transaction_proposal_sets'",
      );
      expect(columns.map((row) => row.column_name)).not.toContain("submitted_at");
      expect(columns.map((row) => row.column_name)).not.toContain("completed_at");
    }).pipe(Effect.provide(PgliteClient.layer())),
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
          ('lineup_write_intents', 'lease_token'),
          ('transaction_proposal_sets', 'id'),
          ('transaction_proposal_submissions', 'id'),
          ('transaction_proposal_submissions', 'set_id'),
          ('transaction_proposal_items', 'id'),
          ('transaction_proposal_items', 'set_id'),
          ('transaction_proposal_items', 'team_id'),
          ('transaction_proposal_steps', 'id'),
          ('transaction_proposal_steps', 'set_id'),
          ('transaction_proposal_steps', 'item_id')
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
    }).pipe(Effect.provide(PgliteClient.layer())),
  );
});

describe("plan lifetime removal migration", () => {
  const planMigration = "20261112142048_abnormal_puma";

  it.effect("drops the set expiry and keeps the plan and its moves", () =>
    Effect.gen(function* () {
      const sql = yield* PgliteClient.PgliteClient;

      for (const statement of migrationStatements((name) => name < planMigration)) {
        yield* sql.unsafe(statement);
      }

      yield* sql.unsafe(`
        insert into transaction_proposal_sets
          (id, user_id, proposer_kind, proposer_reference, surface, fingerprint, teams,
            created_at, expires_at, updated_at)
        values
          ('11111111-1111-4111-8111-111111111111', 'owner', 'agent', 'mcp', 'mcp', 'plan',
            '[]'::jsonb, '2026-11-01T10:00:00Z', '2026-11-02T10:00:00Z',
            '2026-11-01T10:00:00Z')
      `);
      yield* sql.unsafe(`
        insert into transaction_proposal_items
          (id, set_id, position, user_id, team_id, connection_id, kind, add_players,
            drop_players, reason, state, staleness, stale_reasons)
        values
          ('22222222-2222-4222-8222-111111111111', '11111111-1111-4111-8111-111111111111', 0,
            'owner', '33333333-3333-4333-8333-111111111111', 'connection', 'drop',
            '[]'::jsonb, '[]'::jsonb, 'Still open', 'proposed', 'current', '[]'::jsonb),
          ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 1,
            'owner', '33333333-3333-4333-8333-111111111111', 'connection', 'drop',
            '[]'::jsonb, '[]'::jsonb, 'Already ran', 'executed', 'current', '[]'::jsonb)
      `);

      for (const statement of migrationStatements((name) => name === planMigration)) {
        yield* sql.unsafe(statement);
      }

      const columns = yield* sql.unsafe<{ readonly column_name: string }>(
        "select column_name from information_schema.columns where table_name = 'transaction_proposal_sets'",
      );
      expect(columns.map((row) => row.column_name)).not.toContain("expires_at");

      const sets = yield* sql.unsafe<{ readonly id: string; readonly surface: string }>(
        "select id, surface from transaction_proposal_sets",
      );
      expect(sets).toEqual([{ id: "11111111-1111-4111-8111-111111111111", surface: "mcp" }]);

      const items = yield* sql.unsafe<{
        readonly reason: string;
        readonly state: string;
        readonly settled: boolean;
      }>("select reason, state, settled from transaction_proposal_items order by position");
      expect(items).toEqual([
        { reason: "Still open", state: "proposed", settled: false },
        { reason: "Already ran", state: "executed", settled: false },
      ]);

      yield* sql.unsafe(`
        insert into transaction_proposal_items
          (id, set_id, position, user_id, team_id, connection_id, kind, add_players,
            drop_players, reason, state, settled, staleness, stale_reasons)
        values
          ('22222222-2222-4222-8222-333333333333', '11111111-1111-4111-8111-111111111111', 2,
            'owner', '33333333-3333-4333-8333-111111111111', 'connection', 'drop',
            '[]'::jsonb, '[]'::jsonb, 'Dismissed by the owner', 'dismissed', true,
            'current', '[]'::jsonb)
      `);
      const dismissed = yield* sql.unsafe<{ readonly state: string; readonly settled: boolean }>(
        "select state, settled from transaction_proposal_items where id = '22222222-2222-4222-8222-333333333333'",
      );
      expect(dismissed).toEqual([{ state: "dismissed", settled: true }]);
    }).pipe(Effect.provide(PgliteClient.layer())),
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
    }).pipe(Effect.provide(PgliteClient.layer())),
  );
});

describe("proposal window and approval migration", () => {
  const windowMigration = "20261113003301_curly_silhouette";

  it.effect("keeps an old move valid and stores a waiting move's date and approval", () =>
    Effect.gen(function* () {
      const sql = yield* PgliteClient.PgliteClient;

      for (const statement of migrationStatements((name) => name < windowMigration)) {
        yield* sql.unsafe(statement);
      }

      yield* sql.unsafe(`
        insert into transaction_proposal_sets
          (id, user_id, proposer_kind, proposer_reference, surface, fingerprint, teams)
        values
          ('11111111-1111-4111-8111-111111111111', 'owner', 'agent', 'mcp', 'mcp', 'windowed',
            '[]'::jsonb)
      `);
      yield* sql.unsafe(`
        insert into transaction_proposal_items
          (id, set_id, position, user_id, team_id, connection_id, kind, add_players,
            drop_players, reason, state, staleness, stale_reasons)
        values
          ('22222222-2222-4222-8222-111111111111', '11111111-1111-4111-8111-111111111111', 0,
            'owner', '33333333-3333-4333-8333-111111111111', 'connection', 'drop',
            '[]'::jsonb, '[]'::jsonb, 'Old move', 'proposed', 'current', '[]'::jsonb)
      `);

      for (const statement of migrationStatements((name) => name === windowMigration)) {
        yield* sql.unsafe(statement);
      }

      const old = yield* sql.unsafe<{
        readonly window_date: string | null;
        readonly approved_at: Date | null;
      }>(
        "select window_date, approved_at from transaction_proposal_items where id = '22222222-2222-4222-8222-111111111111'",
      );
      expect(old).toEqual([{ window_date: null, approved_at: null }]);

      yield* sql.unsafe(`
        insert into transaction_proposal_items
          (id, set_id, position, user_id, team_id, connection_id, kind, add_players,
            drop_players, reason, state, staleness, stale_reasons, window_date, approved_at)
        values
          ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 1,
            'owner', '33333333-3333-4333-8333-111111111111', 'connection', 'drop',
            '[]'::jsonb, '[]'::jsonb, 'Waiting move', 'proposed', 'current', '[]'::jsonb,
            '2026-11-14', '2026-11-12T10:00:00Z')
      `);

      const waiting = yield* sql.unsafe<{
        readonly window_date: string | null;
        readonly approved_at: string | null;
      }>(
        "select window_date, coalesce(to_char(approved_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS'), '') as approved_at from transaction_proposal_items where id = '22222222-2222-4222-8222-222222222222'",
      );
      expect(waiting).toEqual([{ window_date: "2026-11-14", approved_at: "2026-11-12T10:00:00" }]);
    }).pipe(Effect.provide(PgliteClient.layer())),
  );
});

describe("plan window migration", () => {
  const windowMigration = "20261113003301_curly_silhouette";

  it.effect("adds a window and an approval time and leaves an old move with neither", () =>
    Effect.gen(function* () {
      const sql = yield* PgliteClient.PgliteClient;

      for (const statement of migrationStatements((name) => name < windowMigration)) {
        yield* sql.unsafe(statement);
      }

      yield* sql.unsafe(`
        insert into transaction_proposal_sets
          (id, user_id, proposer_kind, proposer_reference, surface, fingerprint, teams,
            created_at, updated_at)
        values
          ('11111111-1111-4111-8111-333333333333', 'owner', 'agent', 'mcp', 'mcp', 'window',
            '[]'::jsonb, '2026-11-01T10:00:00Z', '2026-11-01T10:00:00Z')
      `);
      yield* sql.unsafe(`
        insert into transaction_proposal_items
          (id, set_id, position, user_id, team_id, connection_id, kind, add_players,
            drop_players, reason, state, staleness, stale_reasons)
        values
          ('22222222-2222-4222-8222-444444444444', '11111111-1111-4111-8111-333333333333', 0,
            'owner', '33333333-3333-4333-8333-111111111111', 'connection', 'drop',
            '[]'::jsonb, '[]'::jsonb, 'Drop the center next week.', 'proposed', 'current',
            '[]'::jsonb)
      `);

      for (const statement of migrationStatements((name) => name === windowMigration)) {
        yield* sql.unsafe(statement);
      }

      const columns = yield* sql.unsafe<{ readonly column_name: string }>(
        "select column_name from information_schema.columns where table_name = 'transaction_proposal_items'",
      );
      expect(columns.map((row) => row.column_name)).toContain("window_date");
      expect(columns.map((row) => row.column_name)).toContain("approved_at");

      const legacy = yield* sql.unsafe<{
        readonly window_date: string | null;
        readonly approved: boolean;
      }>(
        "select window_date, approved_at is not null as approved from transaction_proposal_items where id = '22222222-2222-4222-8222-444444444444'",
      );
      expect(legacy).toEqual([{ window_date: null, approved: false }]);

      yield* sql.unsafe(`
        update transaction_proposal_items
        set window_date = '2026-11-14', approved_at = '2026-11-01T10:00:00Z'
        where id = '22222222-2222-4222-8222-444444444444'
      `);
      const scheduled = yield* sql.unsafe<{
        readonly window_date: string | null;
        readonly approved: boolean;
      }>(
        "select window_date, approved_at is not null as approved from transaction_proposal_items where id = '22222222-2222-4222-8222-444444444444'",
      );
      expect(scheduled).toEqual([{ window_date: "2026-11-14", approved: true }]);
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
