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

const StoredProposalOrderStep = Schema.Struct({
  item: ProposalItemId,
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  rosterPlace: Schema.optional(Schema.Literals(["frees", "consumes"])),
});

const StoredProposalOrderConflict = Schema.Struct({
  items: Schema.Array(ProposalItemId),
  detail: Schema.NonEmptyString,
});

const StoredProposalOrderTiming = Schema.Literals([
  "same_day",
  "next_day",
  "weekly_lock",
  "not_published",
]);

export const StoredProposalOrderPlan = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("ordered"),
    timing: StoredProposalOrderTiming,
    effectiveDate: Schema.optional(Schema.NonEmptyString),
    rosterPlaces: Schema.Struct({
      maximum: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      occupied: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      net: Schema.Int,
    }),
    steps: Schema.Array(StoredProposalOrderStep),
  }),
  Schema.Struct({
    status: Schema.Literal("conflict"),
    timing: StoredProposalOrderTiming,
    effectiveDate: Schema.optional(Schema.NonEmptyString),
    conflicts: Schema.Array(StoredProposalOrderConflict),
  }),
  Schema.Struct({
    status: Schema.Literal("unresolved"),
    timing: StoredProposalOrderTiming,
    effectiveDate: Schema.optional(Schema.NonEmptyString),
    detail: Schema.NonEmptyString,
  }),
]);
export type StoredProposalOrderPlan = typeof StoredProposalOrderPlan.Type;

export const StoredProposalOrder = Schema.Struct({
  team: TeamId,
  order: StoredProposalOrderPlan,
});
export type StoredProposalOrder = typeof StoredProposalOrder.Type;

const StoredProposalLineupStatus = Schema.Literals([
  "settled",
  "pending",
  "blocked",
  "failed",
  "uncertain",
  "not_started",
  "not_needed",
  "superseded",
]);
type StoredProposalLineupStatus = typeof StoredProposalLineupStatus.Type;

export const StoredProposalLineup = Schema.Struct({
  team: TeamId,
  status: StoredProposalLineupStatus,
  detail: Schema.NonEmptyString,
  run: Schema.optional(Schema.NonEmptyString),
  at: Schema.NonEmptyString,
});
export type StoredProposalLineup = typeof StoredProposalLineup.Type;

export const ProposalSetRecord = Schema.Struct({
  id: ProposalSetId,
  userId: UserId,
  proposedBy: ProposalSetProvenance,
  fingerprint: Schema.NonEmptyString,
  teams: Schema.Array(TeamId),
  orders: Schema.Array(StoredProposalOrder),
  lineups: Schema.Array(StoredProposalLineup),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}).pipe(Schema.toType);
export type ProposalSetRecord = typeof ProposalSetRecord.Type;

export const StoredProposalSubmission = Schema.Struct({
  id: Schema.String,
  setId: ProposalSetId,
  userId: UserId,
  ordinal: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  submittedAt: Schema.DateTimeUtc,
  completedAt: Schema.optional(Schema.DateTimeUtc),
}).pipe(Schema.toType);
export type StoredProposalSubmission = typeof StoredProposalSubmission.Type;

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

export const StoredReserveMove = Schema.Struct({
  playerKey: Schema.NonEmptyString,
  playerName: Schema.optional(Schema.NonEmptyString),
  fromSlot: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.NonEmptyString,
  order: Schema.Literals(["before", "after"]),
});
export type StoredReserveMove = typeof StoredReserveMove.Type;

export const StoredProposalIntent = Schema.Struct({
  kind: Schema.Literals(["add", "activate", "stash"]),
  player: Schema.optional(StoredProposalPlayer),
  to: Schema.optional(Schema.Literals(["active", "reserve"])),
});
export type StoredProposalIntent = typeof StoredProposalIntent.Type;

export const StoredProposalPlacement = Schema.Struct({
  playerKey: Schema.NonEmptyString,
  playerName: Schema.optional(Schema.NonEmptyString),
  fromSlot: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.NonEmptyString,
  detail: Schema.NonEmptyString,
});
export type StoredProposalPlacement = typeof StoredProposalPlacement.Type;

export const StoredProposalTradePick = Schema.Struct({
  round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  sourceTeamKey: Schema.NonEmptyString,
  destinationTeamKey: Schema.NonEmptyString,
  sourceName: Schema.NonEmptyString,
  destinationName: Schema.NonEmptyString,
}).pipe(Schema.toType);
export type StoredProposalTradePick = typeof StoredProposalTradePick.Type;

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
  picks: Schema.Array(StoredProposalTradePick),
  slotMove: Schema.optional(StoredSlotMove),
  reserveMove: Schema.optional(StoredReserveMove),
  intent: Schema.optional(StoredProposalIntent),
  placement: Schema.optional(StoredProposalPlacement),
  counterpartyKey: Schema.optional(Schema.NonEmptyString),
  counterpartyName: Schema.optional(Schema.NonEmptyString),
  bid: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  reason: Schema.NonEmptyString,
  state: ProposalItemState,
  settled: Schema.Boolean,
  staleness: StoredProposalStaleness,
  outcome: Schema.optional(ProposalOutcome),
  outcomeDetail: Schema.optional(Schema.NonEmptyString),
  outcomeAt: Schema.optional(Schema.DateTimeUtc),
  executionPosition: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
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
  kind: Schema.Literals(["reserve_move", "slot_move", "add", "drop"]),
  playerKey: Schema.NonEmptyString,
  playerName: Schema.optional(Schema.NonEmptyString),
  fromSlot: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.optional(Schema.NonEmptyString),
  outcome: ProposalOutcome,
  detail: Schema.optional(Schema.NonEmptyString),
  decidedAt: Schema.DateTimeUtc,
}).pipe(Schema.toType);
export type ProposalStepRecord = typeof ProposalStepRecord.Type;

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

export function isSettledItem(item: {
  readonly state: ProposalItemState;
  readonly settled: boolean;
}): boolean {
  return (
    item.state === "executed" ||
    item.state === "accepted" ||
    item.state === "withdrawn" ||
    item.state === "expired" ||
    item.state === "dismissed" ||
    item.state === "skipped" ||
    item.settled
  );
}

export function isClosedSet(items: ReadonlyArray<ProposalItemRecord>): boolean {
  return items.every(isSettledItem);
}

export function isDismissibleItem(state: ProposalItemState): boolean {
  return state === "proposed" || state === "failed";
}
