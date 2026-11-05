import { Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { ConnectionId, ProviderKey } from "#contexts/connections/Connection.ts";
import { FantasyLeague, FantasySport, TeamId } from "#contexts/connections/FantasyTeam.ts";
import {
  ProposalItemId,
  ProposalItemKind,
  ProposalItemState,
  ProposalOutcome,
  ProposalSetId,
  ProposalSetProvenance,
  ProposalStaleCode,
  ProposalStalenessStatus,
  ProposalTradeState,
} from "#contexts/connections/TransactionProposals.ts";

export const StoredProposalPlayer = Schema.Struct({
  key: Schema.NonEmptyString,
  name: Schema.optional(Schema.NonEmptyString),
  position: Schema.optional(Schema.NonEmptyString),
  proTeam: Schema.optional(Schema.NonEmptyString),
  availability: Schema.optional(Schema.NonEmptyString),
}).pipe(Schema.toType);
export type StoredProposalPlayer = typeof StoredProposalPlayer.Type;

export const StoredProposalStaleReason = Schema.Struct({
  code: ProposalStaleCode,
  playerKey: Schema.optional(Schema.NonEmptyString),
  detail: Schema.NonEmptyString,
}).pipe(Schema.toType);
export type StoredProposalStaleReason = typeof StoredProposalStaleReason.Type;

export const StoredProposalStaleness = Schema.Struct({
  status: ProposalStalenessStatus,
  checkedAt: Schema.optional(Schema.DateTimeUtc),
  reasons: Schema.Array(StoredProposalStaleReason),
}).pipe(Schema.toType);
export type StoredProposalStaleness = typeof StoredProposalStaleness.Type;

export const ProposalSetRecord = Schema.Struct({
  id: ProposalSetId,
  userId: UserId,
  proposedBy: ProposalSetProvenance,
  fingerprint: Schema.NonEmptyString,
  teams: Schema.Array(TeamId),
  submittedBy: Schema.optional(UserId),
  submittedAt: Schema.optional(Schema.DateTimeUtc),
  completedAt: Schema.optional(Schema.DateTimeUtc),
  createdAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).pipe(Schema.toType);
export type ProposalSetRecord = typeof ProposalSetRecord.Type;

export const StoredProposalTrade = Schema.Struct({
  providerKey: Schema.NonEmptyString,
  state: ProposalTradeState,
  requestedAt: Schema.DateTimeUtc,
  proposedAt: Schema.optional(Schema.DateTimeUtc),
  settledAt: Schema.optional(Schema.DateTimeUtc),
  detail: Schema.optional(Schema.NonEmptyString),
}).pipe(Schema.toType);
export type StoredProposalTrade = typeof StoredProposalTrade.Type;

export const StoredSlotMove = Schema.Struct({
  playerKey: Schema.NonEmptyString,
  playerName: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.NonEmptyString,
}).pipe(Schema.toType);
export type StoredSlotMove = typeof StoredSlotMove.Type;

export const ProposalItemRecord = Schema.Struct({
  id: ProposalItemId,
  setId: ProposalSetId,
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  userId: UserId,
  team: TeamId,
  connection: ConnectionId,
  kind: ProposalItemKind,
  adds: Schema.Array(StoredProposalPlayer),
  drops: Schema.Array(StoredProposalPlayer),
  slotMove: Schema.optional(StoredSlotMove),
  counterpartyKey: Schema.optional(Schema.NonEmptyString),
  counterpartyName: Schema.optional(Schema.NonEmptyString),
  bid: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  reason: Schema.NonEmptyString,
  state: ProposalItemState,
  staleness: StoredProposalStaleness,
  outcome: Schema.optional(ProposalOutcome),
  outcomeDetail: Schema.optional(Schema.NonEmptyString),
  outcomeAt: Schema.optional(Schema.DateTimeUtc),
  trade: Schema.optional(StoredProposalTrade),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).pipe(Schema.toType);
export type ProposalItemRecord = typeof ProposalItemRecord.Type;

export const ProposalStepRecord = Schema.Struct({
  id: Schema.String,
  setId: ProposalSetId,
  itemId: ProposalItemId,
  userId: UserId,
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  kind: Schema.Literals(["reserve_move", "add", "drop"]),
  playerKey: Schema.NonEmptyString,
  playerName: Schema.optional(Schema.NonEmptyString),
  fromSlot: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.optional(Schema.NonEmptyString),
  outcome: ProposalOutcome,
  detail: Schema.optional(Schema.NonEmptyString),
  decidedAt: Schema.DateTimeUtc,
}).pipe(Schema.toType);
export type ProposalStepRecord = typeof ProposalStepRecord.Type;

export type StoredReserveMove = {
  readonly playerKey: string;
  readonly playerName?: string;
  readonly fromSlot: string;
  readonly toSlot: string;
};

export type ProposalTeamRecord = {
  readonly id: TeamId;
  readonly connection: ConnectionId;
  readonly name: string;
  readonly provider: ProviderKey;
  readonly providerLeagueKey: string;
  readonly league: FantasyLeague;
  readonly sport: FantasySport;
  readonly season: number;
};
