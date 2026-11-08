import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { Crypto, Effect } from "effect";

import { signInCodeQuotaKeyFor } from "#contexts/auth/SignInCodeQuotaKey.ts";
import { decodeUserId } from "#contexts/auth/User.ts";

import { PrivacyDatabase } from "./PrivacyDatabase.ts";

export const owner = {
  id: decodeUserId("owner-erasure"),
  email: "Owner@Example.test",
  name: "Erased Owner",
  sessionToken: "session-secret-owner",
  providerEnvelope: "provider-envelope-secret-owner",
  refreshToken: "grant-refresh-secret-owner",
  accessToken: "grant-access-secret-owner",
  clientSecret: "client-secret-owner",
  ticketHash: "hosted-ticket-hash-owner",
  codeValue: "sign-in-code-hash-owner",
  connectionId: "connection-owner",
  teamId: "11111111-1111-4111-8111-111111111111",
  otherTeamId: "11111111-1111-4111-8111-222222222222",
  runId: "22222222-2222-4222-8222-222222222222",
  deliveryId: "22222222-2222-4222-8222-333333333333",
  diagnosticId: "22222222-2222-4222-8222-444444444444",
  writeIntentId: "22222222-2222-4222-8222-555555555555",
  proposalSetId: "33333333-3333-4333-8333-333333333333",
  proposalSubmissionId: "33333333-3333-4333-8333-444444444444",
  proposalItemId: "44444444-4444-4444-8444-444444444444",
  proposalStepId: "44444444-4444-4444-8444-555555555555",
  incidentId: "55555555-5555-4555-8555-555555555555",
  notificationId: "66666666-6666-4666-8666-666666666666",
  hostedSessionId: "77777777-7777-4777-8777-777777777777",
  feedbackId: "99999999-9999-4999-8999-999999999999",
  agentNoteId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  agentNoteBody: "A durable agent note for the owner team",
  clientId: "agent-client-owner",
};

export const otherOwner = {
  id: decodeUserId("owner-untouched"),
  email: "Other@Example.test",
  name: "Untouched Owner",
  sessionToken: "session-secret-other",
  providerEnvelope: "provider-envelope-secret-other",
  connectionId: "connection-other",
  teamId: "11111111-1111-4111-8111-aaaaaaaaaaaa",
  runId: "22222222-2222-4222-8222-aaaaaaaaaaaa",
  agentNoteId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  agentNoteBody: "A note about the untouched owner's team",
  clientId: "agent-client-other",
};

const instant = "2026-10-01T12:00:00Z";

export const seedOwnedAccount = Effect.gen(function* () {
  const database = yield* PrivacyDatabase;
  const crypto = yield* Crypto.Crypto;
  const ownerQuotaKey = yield* signInCodeQuotaKeyFor(crypto, owner.email).pipe(Effect.orDie);
  const otherQuotaKey = yield* signInCodeQuotaKeyFor(crypto, otherOwner.email).pipe(Effect.orDie);
  const run = (statement: SQL): ReturnType<typeof database.execute> => database.execute(statement);

  yield* run(
    sql`insert into ${sql.identifier("user")} (id, name, email) values
      (${owner.id}, ${owner.name}, ${owner.email}),
      (${otherOwner.id}, ${otherOwner.name}, ${otherOwner.email})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("account")}
      (id, account_id, provider_id, user_id, access_token, refresh_token, id_token, password)
      values
      (${"account-owner"}, ${"google-owner"}, ${"google"}, ${owner.id},
        ${owner.accessToken}, ${owner.refreshToken}, ${"identity-token-owner"}, ${"password-hash-owner"})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("session")} (id, expires_at, token, user_id) values
      (${"session-owner"}, ${instant}, ${owner.sessionToken}, ${owner.id}),
      (${"session-other"}, ${instant}, ${otherOwner.sessionToken}, ${otherOwner.id})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("verification")} (id, identifier, value, expires_at) values
      (${"verification-owner"}, ${"sign-in-otp-OWNER@Example.test"}, ${owner.codeValue}, ${instant})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("sign_in_code_quota")} (key, window_started_at, count) values
      (${ownerQuotaKey}, ${instant}, 3),
      (${otherQuotaKey}, ${instant}, 2)`,
  );
  yield* run(
    sql`insert into ${sql.identifier("provider_connections")}
      (id, user_id, request_id, provider, status) values
      (${owner.connectionId}, ${owner.id}, ${"request-owner"}, ${"fixture"}, ${"ready"}),
      (${otherOwner.connectionId}, ${otherOwner.id}, ${"request-other"}, ${"fixture"}, ${"ready"})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("provider_credentials")}
      (connection_id, user_id, provider, generation, envelope, proven_at) values
      (${owner.connectionId}, ${owner.id}, ${"fixture"}, 1, ${owner.providerEnvelope}, ${instant}),
      (${otherOwner.connectionId}, ${otherOwner.id}, ${"fixture"}, 1, ${otherOwner.providerEnvelope}, ${instant})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("provider_teams")}
      (id, connection_id, user_id, provider, provider_team_key, provider_league_key,
        league, sport, season, name, automation_state, automation_status, owner_note, last_seen_at)
      values
      (${owner.teamId}, ${owner.connectionId}, ${owner.id}, ${"fixture"}, ${"team-owner"},
        ${"league-owner"}, ${"nfl"}, ${"football"}, 2026, ${"Owner Team"},
        ${'{"enabled":true}'}::jsonb, ${"disabled"}, ${"a private note"}, ${instant}),
      (${otherOwner.teamId}, ${otherOwner.connectionId}, ${otherOwner.id}, ${"fixture"},
        ${"team-other"}, ${"league-other"}, ${"nfl"}, ${"football"}, 2026, ${"Other Team"},
        ${'{"enabled":false}'}::jsonb, ${"disabled"}, null, ${instant})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("provider_team_agent_notes")}
      (id, team_id, connection_id, user_id, body, author_name, author_client_id, written_at)
      values
      (${owner.agentNoteId}, ${owner.teamId}, ${owner.connectionId}, ${owner.id},
        ${owner.agentNoteBody}, ${"Owner's agent"}, ${owner.clientId}, ${instant}),
      (${otherOwner.agentNoteId}, ${otherOwner.teamId}, ${otherOwner.connectionId},
        ${otherOwner.id}, ${otherOwner.agentNoteBody}, ${"Other's agent"},
        ${otherOwner.clientId}, ${instant})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("lineup_requests")} (user_id, id, intent) values
      (${owner.id}, ${"lineup-request-owner"}, ${"{}"}),
      (${otherOwner.id}, ${"lineup-request-other"}, ${"{}"})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("lineup_runs")}
      (id, user_id, request_id, team_id, connection_id, trigger, target, status, state,
        implementation, implementation_version) values
      (${owner.runId}, ${owner.id}, ${"lineup-request-owner"}, ${owner.teamId},
        ${owner.connectionId}, ${"manual"}, ${"{}"}::jsonb, ${"completed"}, ${"{}"}::jsonb,
        ${"provider_native"}, ${"1"}),
      (${otherOwner.runId}, ${otherOwner.id}, ${"lineup-request-other"}, ${otherOwner.teamId},
        ${otherOwner.connectionId}, ${"manual"}, ${"{}"}::jsonb, ${"completed"}, ${"{}"}::jsonb,
        ${"provider_native"}, ${"1"})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("lineup_deliveries")}
      (id, user_id, request_id, status, run_ids) values
      (${owner.deliveryId}, ${owner.id}, ${"lineup-request-owner"}, ${"dispatched"},
        ${`["${owner.runId}"]`}::jsonb)`,
  );
  yield* run(
    sql`insert into ${sql.identifier("lineup_team_leases")}
      (team_id, user_id, run_id, token, generation, expires_at) values
      (${owner.teamId}, ${owner.id}, ${owner.runId}, ${"88888888-8888-4888-8888-888888888888"},
        1, ${instant})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("lineup_run_attempts")}
      (run_id, attempt, lease_token, lease_generation, started_at) values
      (${owner.runId}, 1, ${"88888888-8888-4888-8888-888888888888"}, 1, ${instant}),
      (${otherOwner.runId}, 1, ${"88888888-8888-4888-8888-999999999999"}, 1, ${instant})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("lineup_run_diagnostics")}
      (id, run_id, attempt, user_id, team_id, kind, data, created_at, expires_at) values
      (${owner.diagnosticId}, ${owner.runId}, 1, ${owner.id}, ${owner.teamId}, ${"observation"},
        ${"{}"}::jsonb, ${instant}, ${instant})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("lineup_write_intents")}
      (id, run_id, attempt, user_id, team_id, connection_id, connection_generation, lease_token,
        lease_generation, action, target, before, status) values
      (${owner.writeIntentId}, ${owner.runId}, 1, ${owner.id}, ${owner.teamId},
        ${owner.connectionId}, 1, ${"88888888-8888-4888-8888-888888888888"}, 1,
        ${"native_action"}, ${"{}"}::jsonb, ${"[]"}::jsonb, ${"accepted"})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("transaction_proposal_sets")}
      (id, user_id, proposer_kind, proposer_reference, surface, fingerprint, teams, expires_at)
      values
      (${owner.proposalSetId}, ${owner.id}, ${"user"}, ${"web"}, ${"app"}, ${"fingerprint-owner"},
        ${`["${owner.teamId}"]`}::jsonb, ${instant})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("transaction_proposal_submissions")}
      (id, set_id, user_id, ordinal, submitted_at, completed_at) values
      (${owner.proposalSubmissionId}, ${owner.proposalSetId}, ${owner.id}, 1, ${instant}, ${instant})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("transaction_proposal_items")}
      (id, set_id, position, user_id, team_id, connection_id, kind, add_players, drop_players,
        reason, state, staleness, stale_reasons, checked_at) values
      (${owner.proposalItemId}, ${owner.proposalSetId}, 0, ${owner.id}, ${owner.teamId},
        ${owner.connectionId}, ${"drop"}, ${"[]"}::jsonb, ${"[]"}::jsonb, ${"A reason"},
        ${"proposed"}, ${"current"}, ${"[]"}::jsonb, ${instant})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("transaction_proposal_steps")}
      (id, set_id, item_id, user_id, position, kind, player_key, outcome, decided_at) values
      (${owner.proposalStepId}, ${owner.proposalSetId}, ${owner.proposalItemId}, ${owner.id},
        0, ${"drop"}, ${"player-1"}, ${"executed"}, ${instant})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("connection_incidents")}
      (id, user_id, connection_id, credential_generation, status, opened_at) values
      (${owner.incidentId}, ${owner.id}, ${owner.connectionId}, 1, ${"open"}, ${instant})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("notifications")}
      (id, user_id, incident_id, kind, status, next_attempt_at, created_at, updated_at) values
      (${owner.notificationId}, ${owner.id}, ${owner.incidentId},
        ${"connection_reconnect_required"}, ${"pending"}, ${instant}, ${instant}, ${instant})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("hosted_linking_sessions")}
      (id, user_id, connection_id, provider, status, ticket_hash, started_at, expires_at) values
      (${owner.hostedSessionId}, ${owner.id}, ${owner.connectionId}, ${"fixture"}, ${"active"},
        ${owner.ticketHash}, ${instant}, ${instant})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("hosted_linking_session_locks")}
      (user_id, session_id) values (${owner.id}, ${owner.hostedSessionId})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("feedback")}
      (id, user_id, submitter_kind, submitter_reference, kind, status, title, body) values
      (${owner.feedbackId}, ${owner.id}, ${"user"}, ${"web"}, ${"bug"}, ${"open"},
        ${"A report"}, ${"A body"})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("feedback_quota")} (key, window_started_at, count) values
      (${`owner:${owner.id}:2026-10-01T12`}, ${instant}, 1),
      (${`owner:${otherOwner.id}:2026-10-01T12`}, ${instant}, 1)`,
  );
  yield* run(
    sql`insert into ${sql.identifier("tool_call_quota")} (key, window_started_at, count) values
      (${`owner:${owner.id}:read`}, ${instant}, 4),
      (${`owner:${otherOwner.id}:read`}, ${instant}, 2)`,
  );
  yield* run(
    sql`insert into ${sql.identifier("oauth_client")}
      (id, client_id, client_secret, user_id, name, redirect_uris, software_statement) values
      (${"client-row-owner"}, ${owner.clientId}, ${owner.clientSecret}, ${owner.id},
        ${"Owner's agent"}, ${'{"https://agent-owner.example/callback"}'}::text[],
        ${"software-statement-owner"}),
      (${"client-row-other"}, ${otherOwner.clientId}, ${"client-secret-other"}, ${otherOwner.id},
        ${"Other's agent"}, ${'{"https://agent-other.example/callback"}'}::text[],
        ${"software-statement-other"})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("oauth_client_resource")} (id, client_id, resource_id) values
      (${"client-resource-owner"}, ${owner.clientId}, ${"resource-owner"})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("oauth_consent")}
      (id, client_id, user_id, scopes, created_at, updated_at) values
      (${"consent-owner"}, ${owner.clientId}, ${owner.id}, ${"{fantasy:read}"}::text[],
        ${instant}, ${instant}),
      (${"consent-other"}, ${otherOwner.clientId}, ${otherOwner.id}, ${"{fantasy:read}"}::text[],
        ${instant}, ${instant})`,
  );
  yield* run(
    sql`insert into ${sql.identifier("oauth_refresh_token")}
      (id, token, client_id, user_id, expires_at, created_at, rotation_replay_response, scopes)
      values
      (${"refresh-row-owner"}, ${owner.refreshToken}, ${owner.clientId}, ${owner.id}, ${instant},
        ${instant}, ${"rotation-replay-owner"}, ${"{fantasy:read}"}::text[]),
      (${"refresh-row-other"}, ${"grant-refresh-secret-other"}, ${otherOwner.clientId},
        ${otherOwner.id}, ${instant}, ${instant}, ${"rotation-replay-other"},
        ${"{fantasy:read}"}::text[])`,
  );
  yield* run(
    sql`insert into ${sql.identifier("oauth_access_token")}
      (id, token, client_id, user_id, expires_at, created_at, scopes) values
      (${"access-row-owner"}, ${owner.accessToken}, ${owner.clientId}, ${owner.id}, ${instant},
        ${instant}, ${"{fantasy:read}"}::text[])`,
  );
});
