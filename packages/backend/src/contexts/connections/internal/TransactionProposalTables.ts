import { createSelectSchema } from "drizzle-orm/effect-schema";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { Effect, Schema, SchemaParser, SchemaTransformation } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { ConnectionId } from "#contexts/connections/Connection.ts";
import { TeamId } from "#contexts/connections/FantasyTeam.ts";
import {
  ProposalItemId,
  ProposalItemKind,
  ProposalItemState,
  ProposalOutcome,
  ProposalSetId,
  ProposalStalenessStatus,
  ProposalTradeState,
} from "#contexts/connections/TransactionProposals.ts";

import {
  ProposalItemRecord,
  ProposalSetRecord,
  ProposalStepRecord,
  StoredProposalIntent,
  StoredProposalLineup,
  StoredProposalOrder,
  StoredProposalPlacement,
  StoredProposalSubmission,
  StoredReserveMove,
  StoredSlotMove,
  StoredProposalPlayer,
  StoredProposalStaleReason,
} from "./TransactionProposalRecord.ts";

export const transactionProposalSets = pgTable(
  "transaction_proposal_sets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    proposerKind: text("proposer_kind", { enum: ["user", "agent"] }).notNull(),
    proposerReference: text("proposer_reference").notNull(),
    surface: text("surface", { enum: ["app", "mcp"] }).notNull(),
    clientLabel: text("client_label"),
    fingerprint: text("fingerprint").notNull(),
    teams: jsonb("teams").notNull(),
    orders: jsonb("orders"),
    lineups: jsonb("lineups"),
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

export const transactionProposalSubmissions = pgTable(
  "transaction_proposal_submissions",
  {
    id: text("id").primaryKey(),
    setId: text("set_id").notNull(),
    userId: text("user_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("transaction_proposal_submissions_set_id_ordinal_idx").on(
      table.setId,
      table.ordinal,
    ),
    index("transaction_proposal_submissions_user_id_set_id_idx").on(table.userId, table.setId),
  ],
);

export const transactionProposalItems = pgTable(
  "transaction_proposal_items",
  {
    id: text("id").primaryKey(),
    setId: text("set_id").notNull(),
    position: integer("position").notNull(),
    userId: text("user_id").notNull(),
    teamId: text("team_id").notNull(),
    connectionId: text("connection_id").notNull(),
    kind: text("kind", {
      enum: ["free_agent_add", "waiver_claim", "drop", "trade", "activate", "stash", "slot_move"],
    }).notNull(),
    addPlayers: jsonb("add_players").notNull(),
    dropPlayers: jsonb("drop_players").notNull(),
    slotMove: jsonb("slot_move"),
    reserveMove: jsonb("reserve_move"),
    intent: jsonb("intent"),
    placement: jsonb("placement"),
    counterpartyTeamKey: text("counterparty_team_key"),
    counterpartyName: text("counterparty_name"),
    bid: integer("bid"),
    reason: text("reason").notNull(),
    state: text("state", {
      enum: [
        "proposed",
        "executed",
        "pending",
        "failed",
        "skipped",
        "unknown",
        "accepted",
        "withdrawn",
        "expired",
      ],
    }).notNull(),
    settled: boolean("settled").notNull().default(false),
    staleness: text("staleness", { enum: ["current", "stale", "illegal"] }).notNull(),
    staleReasons: jsonb("stale_reasons").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    outcome: text("outcome", {
      enum: ["executed", "pending", "failed", "skipped", "unknown"],
    }),
    outcomeDetail: text("outcome_detail"),
    outcomeAt: timestamp("outcome_at", { withTimezone: true }),
    executionPosition: integer("execution_position"),
    tradeProviderKey: text("trade_provider_key"),
    tradeState: text("trade_state", {
      enum: ["pending", "accepted", "withdrawn", "expired"],
    }),
    tradeRequestedAt: timestamp("trade_requested_at", { withTimezone: true }),
    tradeProposedAt: timestamp("trade_proposed_at", { withTimezone: true }),
    tradeSettledAt: timestamp("trade_settled_at", { withTimezone: true }),
    tradeDetail: text("trade_detail"),
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

export const transactionProposalSteps = pgTable(
  "transaction_proposal_steps",
  {
    id: text("id").primaryKey(),
    setId: text("set_id").notNull(),
    itemId: text("item_id").notNull(),
    userId: text("user_id").notNull(),
    position: integer("position").notNull(),
    kind: text("kind", { enum: ["reserve_move", "slot_move", "add", "drop"] }).notNull(),
    playerKey: text("player_key").notNull(),
    playerName: text("player_name"),
    fromSlot: text("from_slot"),
    toSlot: text("to_slot"),
    outcome: text("outcome", {
      enum: ["executed", "pending", "failed", "skipped", "unknown"],
    }).notNull(),
    detail: text("detail"),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    uniqueIndex("transaction_proposal_steps_item_id_position_idx").on(table.itemId, table.position),
    index("transaction_proposal_steps_user_id_set_id_idx").on(table.userId, table.setId),
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
  orders: Schema.Unknown,
  lineups: Schema.Unknown,
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
          const orders =
            row.orders === null
              ? []
              : yield* SchemaParser.decodeUnknownEffect(Schema.Array(StoredProposalOrder))(
                  row.orders,
                );
          const lineups =
            row.lineups === null
              ? []
              : yield* SchemaParser.decodeUnknownEffect(Schema.Array(StoredProposalLineup))(
                  row.lineups,
                );
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
            orders,
            lineups,
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
            orders: record.orders.length === 0 ? null : record.orders,
            lineups: record.lineups.length === 0 ? null : record.lineups,
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
  connectionId: ConnectionId,
  kind: ProposalItemKind,
  addPlayers: Schema.Unknown,
  dropPlayers: Schema.Unknown,
  slotMove: Schema.Unknown,
  reserveMove: Schema.Unknown,
  intent: Schema.Unknown,
  placement: Schema.Unknown,
  counterpartyTeamKey: Schema.NullOr(Schema.NonEmptyString),
  counterpartyName: Schema.NullOr(Schema.NonEmptyString),
  bid: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  reason: Schema.NonEmptyString,
  state: ProposalItemState,
  settled: Schema.Boolean,
  staleness: ProposalStalenessStatus,
  staleReasons: Schema.Unknown,
  checkedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  outcome: Schema.NullOr(ProposalOutcome),
  outcomeDetail: Schema.NullOr(Schema.NonEmptyString),
  outcomeAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  executionPosition: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  tradeProviderKey: Schema.NullOr(Schema.NonEmptyString),
  tradeState: Schema.NullOr(ProposalTradeState),
  tradeRequestedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  tradeProposedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  tradeSettledAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
  tradeDetail: Schema.NullOr(Schema.NonEmptyString),
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
          const slotMove = yield* SchemaParser.decodeUnknownEffect(Schema.NullOr(StoredSlotMove))(
            row.slotMove,
          );
          const reserveMove = yield* SchemaParser.decodeUnknownEffect(
            Schema.NullOr(StoredReserveMove),
          )(row.reserveMove);
          const intent = yield* SchemaParser.decodeUnknownEffect(
            Schema.NullOr(StoredProposalIntent),
          )(row.intent);
          const placement = yield* SchemaParser.decodeUnknownEffect(
            Schema.NullOr(StoredProposalPlacement),
          )(row.placement);
          if (row.checkedAt === null) {
            return yield* Effect.die(
              new Error("A stored proposal item requires the time of its check"),
            );
          }
          if ((row.staleness === "stale" || row.staleness === "illegal") !== reasons.length > 0) {
            return yield* Effect.die(
              new Error("A stale or illegal proposal item must carry its reasons"),
            );
          }
          if (row.kind === "trade" && row.counterpartyTeamKey === null) {
            return yield* Effect.die(new Error("A trade proposal item requires a counterparty"));
          }
          if (row.kind !== "trade" && row.counterpartyTeamKey !== null) {
            return yield* Effect.die(
              new Error("Only a trade proposal item can carry a counterparty"),
            );
          }
          if (row.kind === "slot_move" && slotMove === null) {
            return yield* Effect.die(
              new Error("A slot move proposal item requires its destination slot"),
            );
          }
          if (row.kind !== "slot_move" && slotMove !== null) {
            return yield* Effect.die(
              new Error("Only a slot move proposal item can carry a slot move"),
            );
          }
          if (row.kind === "slot_move" && (adds.length > 0 || drops.length > 0)) {
            return yield* Effect.die(
              new Error("A slot move proposal item cannot add or drop a player"),
            );
          }
          if ((row.tradeProviderKey === null) !== (row.tradeState === null)) {
            return yield* Effect.die(
              new Error("A trade provider key and trade state must appear together"),
            );
          }
          if (row.tradeState === null && row.tradeRequestedAt !== null) {
            return yield* Effect.die(
              new Error("A trade without a provider key cannot carry a request time"),
            );
          }
          return {
            id: row.id,
            setId: row.setId,
            position: row.position,
            userId: row.userId,
            team: row.teamId,
            connection: row.connectionId,
            kind: row.kind,
            adds,
            drops,
            ...(slotMove === null ? {} : { slotMove }),
            ...(reserveMove === null ? {} : { reserveMove }),
            ...(intent === null ? {} : { intent }),
            ...(placement === null ? {} : { placement }),
            ...(row.counterpartyTeamKey === null
              ? {}
              : { counterpartyKey: row.counterpartyTeamKey }),
            ...(row.counterpartyName === null ? {} : { counterpartyName: row.counterpartyName }),
            ...(row.bid === null ? {} : { bid: row.bid }),
            reason: row.reason,
            state: row.state,
            settled: row.settled,
            staleness: {
              status: row.staleness,
              checkedAt: row.checkedAt,
              reasons,
            },
            ...(row.outcome === null ? {} : { outcome: row.outcome }),
            ...(row.outcomeDetail === null ? {} : { outcomeDetail: row.outcomeDetail }),
            ...(row.outcomeAt === null ? {} : { outcomeAt: row.outcomeAt }),
            ...(row.executionPosition === null ? {} : { executionPosition: row.executionPosition }),
            ...(row.tradeProviderKey === null || row.tradeState === null
              ? {}
              : {
                  trade: {
                    providerKey: row.tradeProviderKey,
                    state: row.tradeState,
                    requestedAt: row.tradeRequestedAt ?? row.createdAt,
                    ...(row.tradeProposedAt === null ? {} : { proposedAt: row.tradeProposedAt }),
                    ...(row.tradeSettledAt === null ? {} : { settledAt: row.tradeSettledAt }),
                    ...(row.tradeDetail === null ? {} : { detail: row.tradeDetail }),
                  },
                }),
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
            connectionId: record.connection,
            kind: record.kind,
            addPlayers: adds,
            dropPlayers: drops,
            slotMove: record.slotMove ?? null,
            reserveMove: record.reserveMove ?? null,
            intent: record.intent ?? null,
            placement: record.placement ?? null,
            counterpartyTeamKey: record.counterpartyKey ?? null,
            counterpartyName: record.counterpartyName ?? null,
            bid: record.bid ?? null,
            reason: record.reason,
            state: record.state,
            settled: record.settled,
            staleness: record.staleness.status,
            staleReasons: reasons,
            checkedAt: record.staleness.checkedAt ?? null,
            outcome: record.outcome ?? null,
            outcomeDetail: record.outcomeDetail ?? null,
            outcomeAt: record.outcomeAt ?? null,
            executionPosition: record.executionPosition ?? null,
            tradeProviderKey: record.trade?.providerKey ?? null,
            tradeState: record.trade?.state ?? null,
            tradeRequestedAt: record.trade?.requestedAt ?? null,
            tradeProposedAt: record.trade?.proposedAt ?? null,
            tradeSettledAt: record.trade?.settledAt ?? null,
            tradeDetail: record.trade?.detail ?? null,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          };
        }),
    }),
  ),
);

const ProposalSubmissionSelect = createSelectSchema(transactionProposalSubmissions, {
  id: Schema.String,
  setId: ProposalSetId,
  userId: UserId,
  ordinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  submittedAt: Schema.DateTimeUtcFromDate,
  completedAt: Schema.NullOr(Schema.DateTimeUtcFromDate),
});

export const ProposalSubmissionRow = ProposalSubmissionSelect.pipe(
  Schema.decodeTo(
    StoredProposalSubmission,
    SchemaTransformation.transform<StoredProposalSubmission, typeof ProposalSubmissionSelect.Type>({
      decode: (row) => ({
        id: row.id,
        setId: row.setId,
        userId: row.userId,
        ordinal: row.ordinal,
        submittedAt: row.submittedAt,
        ...(row.completedAt === null ? {} : { completedAt: row.completedAt }),
      }),
      encode: (record) => ({
        id: record.id,
        setId: record.setId,
        userId: record.userId,
        ordinal: record.ordinal,
        submittedAt: record.submittedAt,
        completedAt: record.completedAt ?? null,
      }),
    }),
  ),
);

const ProposalStepId = Schema.Union([
  Schema.String.pipe(Schema.check(Schema.isUUID())),
  Schema.String.pipe(Schema.check(Schema.isULID())),
]);

const ProposalStepSelect = createSelectSchema(transactionProposalSteps, {
  id: ProposalStepId,
  setId: ProposalSetId,
  itemId: ProposalItemId,
  userId: UserId,
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  kind: Schema.Literals(["reserve_move", "slot_move", "add", "drop"]),
  playerKey: Schema.NonEmptyString,
  playerName: Schema.NullOr(Schema.NonEmptyString),
  fromSlot: Schema.NullOr(Schema.NonEmptyString),
  toSlot: Schema.NullOr(Schema.NonEmptyString),
  outcome: ProposalOutcome,
  detail: Schema.NullOr(Schema.NonEmptyString),
  decidedAt: Schema.DateTimeUtcFromDate,
});

export const ProposalStepRow = ProposalStepSelect.pipe(
  Schema.decodeTo(
    ProposalStepRecord,
    SchemaTransformation.transform<ProposalStepRecord, typeof ProposalStepSelect.Type>({
      decode: (row) => ({
        id: row.id,
        setId: row.setId,
        itemId: row.itemId,
        userId: row.userId,
        position: row.position,
        kind: row.kind,
        playerKey: row.playerKey,
        ...(row.playerName === null ? {} : { playerName: row.playerName }),
        ...(row.fromSlot === null ? {} : { fromSlot: row.fromSlot }),
        ...(row.toSlot === null ? {} : { toSlot: row.toSlot }),
        outcome: row.outcome,
        ...(row.detail === null ? {} : { detail: row.detail }),
        decidedAt: row.decidedAt,
      }),
      encode: (record) => ({
        id: record.id,
        setId: record.setId,
        itemId: record.itemId,
        userId: record.userId,
        position: record.position,
        kind: record.kind,
        playerKey: record.playerKey,
        playerName: record.playerName ?? null,
        fromSlot: record.fromSlot ?? null,
        toSlot: record.toSlot ?? null,
        outcome: record.outcome,
        detail: record.detail ?? null,
        decidedAt: record.decidedAt,
      }),
    }),
  ),
);
