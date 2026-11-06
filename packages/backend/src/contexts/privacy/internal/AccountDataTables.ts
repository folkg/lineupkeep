import { sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import type { UserId } from "#contexts/auth/User.ts";
import type { AccountExportArea } from "#contexts/privacy/AccountExport.ts";

import { accountExports } from "./AccountExportTable.ts";

export type OwnedAccount = {
  readonly userId: string;
  readonly email: string;
  readonly signInCodeQuotaKey: string;
};

type WithheldField = {
  readonly field: string;
  readonly reason: string;
};

export type OwnedDataClass = {
  readonly table: string;
  readonly label: string;
  readonly needsAccountIdentity: boolean;
  readonly where: (account: OwnedAccount) => SQL;
  readonly withheld: ReadonlyArray<WithheldField>;
};

const ownerRows =
  (column: string): ((account: OwnedAccount) => SQL) =>
  (account) =>
    sql`${sql.identifier(column)} = ${account.userId}`;

const quotaRowsForKeyOwner: OwnedDataClass["where"] = (account) =>
  sql`split_part(key, ':', 2) = ${account.userId}`;

export const ownedDataInventory: ReadonlyArray<OwnedDataClass> = [
  {
    table: "lineup_run_attempts",
    label: "Lineup run attempts",
    needsAccountIdentity: false,
    where: (account) =>
      sql`run_id in (select id from lineup_runs where user_id = ${account.userId})`,
    withheld: [],
  },
  {
    table: "lineup_run_diagnostics",
    label: "Lineup run diagnostics",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "lineup_write_intents",
    label: "Lineup write attempts",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "lineup_team_leases",
    label: "Team run locks",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "lineup_runs",
    label: "Lineup runs",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "lineup_deliveries",
    label: "Lineup deliveries",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "lineup_requests",
    label: "Lineup requests",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "transaction_proposal_steps",
    label: "Transaction proposal steps",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "transaction_proposal_items",
    label: "Transaction proposals",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "transaction_proposal_sets",
    label: "Transaction proposal sets",
    needsAccountIdentity: false,
    where: (account) =>
      sql`(user_id = ${account.userId} or submitted_by_user_id = ${account.userId})`,
    withheld: [],
  },
  {
    table: "notifications",
    label: "Notifications",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "connection_incidents",
    label: "Connection incidents",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "hosted_linking_session_locks",
    label: "Hosted sign-in locks",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "hosted_linking_sessions",
    label: "Hosted sign-in sessions",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [
      {
        field: "ticket_hash",
        reason: "it is the hash of a one-use hosted sign-in ticket",
      },
    ],
  },
  {
    table: "provider_credentials",
    label: "Provider sign-ins",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [
      {
        field: "envelope",
        reason: "it is the encrypted provider session, and the export must not become a sign-in",
      },
    ],
  },
  {
    table: "provider_team_agent_notes",
    label: "Agent team notes",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "provider_teams",
    label: "Fantasy teams",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "provider_connections",
    label: "Provider connections",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "feedback",
    label: "Feedback reports",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "feedback_quota",
    label: "Feedback rate limits",
    needsAccountIdentity: false,
    where: quotaRowsForKeyOwner,
    withheld: [],
  },
  {
    table: "tool_call_quota",
    label: "Agent rate limits",
    needsAccountIdentity: false,
    where: quotaRowsForKeyOwner,
    withheld: [],
  },
  {
    table: "oauth_access_token",
    label: "Agent access tokens",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [{ field: "token", reason: "it is a grant token" }],
  },
  {
    table: "oauth_refresh_token",
    label: "Agent refresh tokens",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [
      { field: "token", reason: "it is grant token material" },
      { field: "rotation_replay_response", reason: "it can replay a token rotation response" },
    ],
  },
  {
    table: "oauth_consent",
    label: "Agent grants",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "oauth_client_resource",
    label: "Agent client resources",
    needsAccountIdentity: false,
    where: (account) =>
      sql`client_id in (select client_id from oauth_client where user_id = ${account.userId})`,
    withheld: [],
  },
  {
    table: "oauth_client",
    label: "Agent client registrations",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [
      { field: "client_secret", reason: "it is a client secret" },
      {
        field: "software_statement",
        reason: "it can assert this client's software identity",
      },
    ],
  },
  {
    table: "verification",
    label: "Sign-in codes",
    needsAccountIdentity: true,
    where: (account) =>
      sql`lower(right(identifier, char_length(${account.email}) + 5)) = lower(${"-otp-" + account.email})`,
    withheld: [{ field: "value", reason: "it is the hash of a sign-in code" }],
  },
  {
    table: "sign_in_code_quota",
    label: "Sign-in code rate limits",
    needsAccountIdentity: true,
    where: (account) => sql`key = ${account.signInCodeQuotaKey}`,
    withheld: [{ field: "key", reason: "it is a hash of your sign-in address" }],
  },
  {
    table: "session",
    label: "Sign-in sessions",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [{ field: "token", reason: "it is the secret this browser uses to stay signed in" }],
  },
  {
    table: "account",
    label: "Linked sign-in accounts",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [
      { field: "access_token", reason: "it is identity provider credential material" },
      { field: "refresh_token", reason: "it is identity provider credential material" },
      { field: "id_token", reason: "it is identity provider credential material" },
      { field: "password", reason: "it is a password hash" },
    ],
  },
  {
    table: "account_exports",
    label: "Exports you downloaded",
    needsAccountIdentity: false,
    where: ownerRows("user_id"),
    withheld: [],
  },
  {
    table: "user",
    label: "Account",
    needsAccountIdentity: false,
    where: (account) => sql`id = ${account.userId}`,
    withheld: [],
  },
];

export function selectLatestExport(userId: UserId): SQL {
  return sql`
    select ${accountExports.takenAt} as taken_at, ${accountExports.contents} as contents
    from ${accountExports}
    where ${accountExports.userId} = ${userId}
  `;
}

export function deleteOwnerExport(userId: UserId): SQL {
  return sql`delete from ${accountExports} where ${accountExports.userId} = ${userId} returning 1`;
}

export function recordOwnerExport(
  userId: UserId,
  takenAt: Date,
  contents: ReadonlyArray<AccountExportArea>,
): SQL {
  return sql`
    insert into ${accountExports} (user_id, taken_at, contents)
    values (${userId}, ${takenAt}, ${JSON.stringify(contents)}::jsonb)
    on conflict (user_id) do update
      set taken_at = excluded.taken_at, contents = excluded.contents
  `;
}

export function deleteOwnedRows(table: string, account: OwnedAccount): SQL {
  return sql`delete from ${sql.identifier(table)} where ${ownedRowsWhere(table, account)} returning 1`;
}

export function selectOwnedRows(table: string, account: OwnedAccount): SQL {
  return sql`select * from ${sql.identifier(table)} where ${ownedRowsWhere(table, account)} order by 1`;
}

export function countOwnedRows(table: string, account: OwnedAccount): SQL {
  return sql`select count(*)::int as count from ${sql.identifier(table)} where ${ownedRowsWhere(table, account)}`;
}

export function countRowsCarryingOwnerColumn(table: string, column: string, userId: UserId): SQL {
  return sql`select count(*)::int as count from ${sql.identifier(table)} where ${sql.identifier(column)} = ${userId}`;
}

export function selectStoredEmail(userId: UserId): SQL {
  return sql`select email from ${sql.identifier("user")} where id = ${userId}`;
}

export function catalogTablesQuery(): SQL {
  return sql`select table_name from information_schema.tables where table_schema = 'public' order by table_name`;
}

export function catalogOwnerColumnsQuery(): SQL {
  return sql`
    select table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
      and column_name in ('user_id', 'owner_id', 'submitted_by_user_id')
    order by table_name, column_name
  `;
}

export const blockAccountErasureStatements = [
  sql.raw(`
    create function block_account_erasure() returns trigger language plpgsql as $$
    begin
      raise exception 'blocked for the rollback test';
    end
    $$;
  `),
  sql.raw(
    "create trigger feedback_block_delete before delete on feedback for each row execute function block_account_erasure();",
  ),
] as const;

function ownedRowsWhere(table: string, account: OwnedAccount): SQL {
  const ownedClass = ownedDataInventory.find((entry) => entry.table === table);
  if (ownedClass === undefined) {
    throw new Error(`The erasure inventory does not name ${table}.`);
  }
  return ownedClass.where(account);
}
