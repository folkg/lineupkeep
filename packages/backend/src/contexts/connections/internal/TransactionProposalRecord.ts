import { Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { ProviderKey } from "#contexts/connections/Connection.ts";
import { FantasyLeague, FantasySport, TeamId } from "#contexts/connections/FantasyTeam.ts";
import {
  ProposalItemId,
  ProposalItemKind,
  ProposalItemState,
  ProposalSetId,
  ProposalSetProvenance,
  ProposalStaleCode,
  ProposalStalenessStatus,
} from "#contexts/connections/TransactionProposals.ts";

export const StoredProposalPlayer = Schema.Struct({
  key: Schema.NonEmptyString,
  name: Schema.optional(Schema.NonEmptyString),
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
  createdAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).pipe(Schema.toType);
export type ProposalSetRecord = typeof ProposalSetRecord.Type;

export const ProposalItemRecord = Schema.Struct({
  id: ProposalItemId,
  setId: ProposalSetId,
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  userId: UserId,
  team: TeamId,
  kind: ProposalItemKind,
  adds: Schema.Array(StoredProposalPlayer),
  drops: Schema.Array(StoredProposalPlayer),
  bid: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  reason: Schema.NonEmptyString,
  state: ProposalItemState,
  staleness: StoredProposalStaleness,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).pipe(Schema.toType);
export type ProposalItemRecord = typeof ProposalItemRecord.Type;

export type ProposalTeamRecord = {
  readonly id: TeamId;
  readonly name: string;
  readonly provider: ProviderKey;
  readonly providerLeagueKey: string;
  readonly league: FantasyLeague;
  readonly sport: FantasySport;
  readonly season: number;
};
