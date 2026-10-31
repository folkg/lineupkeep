import { createSelectSchema } from "drizzle-orm/effect-schema";
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { Effect, Schema, SchemaParser, SchemaTransformation } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { TeamId } from "#contexts/connections/FantasyTeam.ts";
import {
  ProposalItemId,
  ProposalItemKind,
  ProposalItemState,
  ProposalSetId,
  ProposalStalenessStatus,
} from "#contexts/connections/TransactionProposals.ts";

import {
  ProposalItemRecord,
  ProposalSetRecord,
  StoredProposalPlayer,
  StoredProposalStaleReason,
} from "./TransactionProposalRecord.ts";

export const transactionProposalSets = pgTable(
  "transaction_proposal_sets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    proposerKind: text("proposer_kind", { enum: ["user", "agent"] }).notNull(),
    proposerReference: text("proposer_reference").notNull(),
    surface: text("surface", { enum: ["app", "mcp"] }).notNull(),
    clientLabel: text("client_label"),
    fingerprint: text("fingerprint").notNull(),
    teams: jsonb("teams").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("transaction_proposal_sets_user_id_fingerprint_idx").on(
      table.userId,
      table.fingerprint,
    ),
    index("transaction_proposal_sets_user_id_created_at_idx").on(table.userId, table.createdAt),
  ],
);

export const transactionProposalItems = pgTable(
  "transaction_proposal_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    setId: uuid("set_id").notNull(),
    position: integer("position").notNull(),
    userId: text("user_id").notNull(),
    teamId: uuid("team_id").notNull(),
    kind: text("kind", { enum: ["free_agent_add", "waiver_claim", "drop"] }).notNull(),
    addPlayers: jsonb("add_players").notNull(),
    dropPlayers: jsonb("drop_players").notNull(),
    bid: integer("bid"),
    reason: text("reason").notNull(),
    state: text("state", {
      enum: ["proposed", "approved", "executed", "failed", "skipped"],
    }).notNull(),
    staleness: text("staleness", { enum: ["unchecked", "current", "stale"] }).notNull(),
    staleReasons: jsonb("stale_reasons").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("transaction_proposal_items_set_id_position_idx").on(table.setId, table.position),
    index("transaction_proposal_items_user_id_team_id_state_idx").on(
      table.userId,
      table.teamId,
      table.state,
    ),
  ],
);

const ProposalSetSelect = createSelectSchema(transactionProposalSets, {
  id: ProposalSetId,
  userId: UserId,
  proposerKind: Schema.Literals(["user", "agent"]),
  proposerReference: Schema.NonEmptyString,
  surface: Schema.Literals(["app", "mcp"]),
  clientLabel: Schema.NullOr(Schema.NonEmptyString),
  fingerprint: Schema.NonEmptyString,
  teams: Schema.Unknown,
  createdAt: Schema.DateTimeUtcFromDate,
  expiresAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
});

export const ProposalSetRow = ProposalSetSelect.pipe(
  Schema.decodeTo(
    ProposalSetRecord,
    SchemaTransformation.transformEffect<ProposalSetRecord, typeof ProposalSetSelect.Type>({
      decode: (row) =>
        Effect.gen(function* () {
          const teams = yield* SchemaParser.decodeUnknownEffect(Schema.Array(TeamId))(row.teams);
          return {
            id: row.id,
            userId: row.userId,
            proposedBy: {
              kind: row.proposerKind,
              reference: row.proposerReference,
              surface: row.surface,
              ...(row.clientLabel === null ? {} : { client: row.clientLabel }),
            },
            fingerprint: row.fingerprint,
            teams,
            createdAt: row.createdAt,
            expiresAt: row.expiresAt,
            updatedAt: row.updatedAt,
          };
        }),
      encode: (record) =>
        Effect.gen(function* () {
          const teams = yield* SchemaParser.encodeEffect(Schema.Array(TeamId))(record.teams);
          return {
            id: record.id,
            userId: record.userId,
            proposerKind: record.proposedBy.kind,
            proposerReference: record.proposedBy.reference,
            surface: record.proposedBy.surface,
            clientLabel: record.proposedBy.client ?? null,
            fingerprint: record.fingerprint,
            teams,
            createdAt: record.createdAt,
            expiresAt: record.expiresAt,
            updatedAt: record.updatedAt,
          };
        }),
    }),
  ),
);

const ProposalItemSelect = createSelectSchema(transactionProposalItems, {
  id: ProposalItemId,
  setId: ProposalSetId,
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  userId: UserId,
  teamId: TeamId,
  kind: ProposalItemKind,
  addPlayers: Schema.Unknown,
  dropPlayers: Schema.Unknown,
  bid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  reason: Schema.NonEmptyString,
  state: ProposalItemState,
  staleness: ProposalStalenessStatus,
  staleReasons: Schema.Unknown,
  checkedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  createdAt: Schema.DateTimeUtcFromDate,
  updatedAt: Schema.DateTimeUtcFromDate,
});

export const ProposalItemRow = ProposalItemSelect.pipe(
  Schema.decodeTo(
    ProposalItemRecord,
    SchemaTransformation.transformEffect<ProposalItemRecord, typeof ProposalItemSelect.Type>({
      decode: (row) =>
        Effect.gen(function* () {
          const adds = yield* SchemaParser.decodeUnknownEffect(Schema.Array(StoredProposalPlayer))(
            row.addPlayers,
          );
          const drops = yield* SchemaParser.decodeUnknownEffect(Schema.Array(StoredProposalPlayer))(
            row.dropPlayers,
          );
          const reasons = yield* SchemaParser.decodeUnknownEffect(
            Schema.Array(StoredProposalStaleReason),
          )(row.staleReasons);
          if (row.staleness === "unchecked" && (row.checkedAt !== null || reasons.length > 0)) {
            return yield* Effect.die(
              new Error("An unchecked proposal item cannot carry a check time or a stale reason"),
            );
          }
          if (row.staleness !== "unchecked" && row.checkedAt === null) {
            return yield* Effect.die(
              new Error("A checked proposal item requires the time of its check"),
            );
          }
          if ((row.staleness === "stale") !== reasons.length > 0) {
            return yield* Effect.die(
              new Error("Proposal item staleness must match whether it carries stale reasons"),
            );
          }
          return {
            id: row.id,
            setId: row.setId,
            position: row.position,
            userId: row.userId,
            team: row.teamId,
            kind: row.kind,
            adds,
            drops,
            ...(row.bid === null ? {} : { bid: row.bid }),
            reason: row.reason,
            state: row.state,
            staleness: {
              status: row.staleness,
              ...(row.checkedAt === null ? {} : { checkedAt: row.checkedAt }),
              reasons,
            },
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
        }),
      encode: (record) =>
        Effect.gen(function* () {
          const adds = yield* SchemaParser.encodeEffect(Schema.Array(StoredProposalPlayer))(
            record.adds,
          );
          const drops = yield* SchemaParser.encodeEffect(Schema.Array(StoredProposalPlayer))(
            record.drops,
          );
          const reasons = yield* SchemaParser.encodeEffect(Schema.Array(StoredProposalStaleReason))(
            record.staleness.reasons,
          );
          return {
            id: record.id,
            setId: record.setId,
            position: record.position,
            userId: record.userId,
            teamId: record.team,
            kind: record.kind,
            addPlayers: adds,
            dropPlayers: drops,
            bid: record.bid ?? null,
            reason: record.reason,
            state: record.state,
            staleness: record.staleness.status,
            staleReasons: reasons,
            checkedAt: record.staleness.checkedAt ?? null,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          };
        }),
    }),
  ),
);
