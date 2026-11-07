import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { UserId } from "#contexts/auth/User.ts";

import { TeamAgentNote } from "./AgentNote.ts";
import { TeamId } from "./FantasyTeam.ts";
import {
  CounterpartyRef,
  PlayerRef,
  QueryCoverage,
  QueryTeam,
  TeamOwnerNote,
  TradeOfferRef,
} from "./QueryValues.ts";

export const proposalSetLifetimeMillis = 24 * 60 * 60 * 1000;

const LineupgradeId = Schema.Union([
  Schema.String.pipe(Schema.check(Schema.isUUID())),
  Schema.String.pipe(Schema.check(Schema.isULID())),
]);

export const ProposalSetId = LineupgradeId.pipe(Schema.brand("ProposalSetId"));
export type ProposalSetId = typeof ProposalSetId.Type;

export const ProposalItemId = LineupgradeId.pipe(Schema.brand("ProposalItemId"));
export type ProposalItemId = typeof ProposalItemId.Type;

export const ProposalItemKind = Schema.Literals([
  "free_agent_add",
  "waiver_claim",
  "drop",
  "trade",
  "slot_move",
]);
export type ProposalItemKind = typeof ProposalItemKind.Type;

export const ProposalTradeState = Schema.Literals(["pending", "accepted", "withdrawn", "expired"]);
export type ProposalTradeState = typeof ProposalTradeState.Type;

export const ProposalItemState = Schema.Literals([
  "proposed",
  "executed",
  "pending",
  "failed",
  "skipped",
  "unknown",
  "accepted",
  "withdrawn",
  "expired",
]);
export type ProposalItemState = typeof ProposalItemState.Type;

export const ProposalOutcome = Schema.Literals([
  "executed",
  "pending",
  "failed",
  "skipped",
  "unknown",
]);
export type ProposalOutcome = typeof ProposalOutcome.Type;

export const ProposalStalenessStatus = Schema.Literals(["current", "stale", "illegal"]);
export type ProposalStalenessStatus = typeof ProposalStalenessStatus.Type;

export const ProposalStaleCode = Schema.Literals([
  "player_unavailable",
  "drop_not_rostered",
  "move_not_rostered",
  "move_slot_unknown",
  "roster_full",
  "slot_illegal",
  "order_conflict",
  "order_unresolved",
  "period_closed",
  "bid_exceeds_budget",
  "bid_not_available",
  "state_unavailable",
  "trade_window_closed",
  "trade_counterparty_missing",
  "trade_player_not_rostered",
]);
export type ProposalStaleCode = typeof ProposalStaleCode.Type;

const ProposalProposerKind = Schema.Literals(["user", "agent"]);
type ProposalProposerKind = typeof ProposalProposerKind.Type;

const ProposalSurface = Schema.Literals(["app", "mcp"]);
type ProposalSurface = typeof ProposalSurface.Type;

const ProposalPlayer = Schema.Struct({
  ref: PlayerRef,
  name: Schema.optional(Schema.NonEmptyString),
  position: Schema.optional(Schema.NonEmptyString),
  proTeam: Schema.optional(Schema.NonEmptyString),
  availability: Schema.optional(Schema.NonEmptyString),
});
type ProposalPlayer = typeof ProposalPlayer.Type;

const ProposalStepPlayer = Schema.Struct({
  ref: PlayerRef,
  name: Schema.optional(Schema.NonEmptyString),
});
type ProposalStepPlayer = typeof ProposalStepPlayer.Type;

const ProposalExecutionStep = Schema.Struct({
  kind: Schema.Literals(["reserve_move", "slot_move", "add", "drop"]),
  player: ProposalStepPlayer,
  fromSlot: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.optional(Schema.NonEmptyString),
  outcome: ProposalOutcome,
  detail: Schema.optional(Schema.NonEmptyString),
  decidedAt: Schema.DateTimeUtc,
});
export type ProposalExecutionStep = typeof ProposalExecutionStep.Type;

const ProposalItemExecution = Schema.Struct({
  position: Schema.optional(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
      description:
        "The move's position in the team order of the submission that sent it, counted from zero. Positions restart with each submission.",
    }),
  ),
  outcome: ProposalOutcome,
  detail: Schema.optional(Schema.NonEmptyString),
  decidedAt: Schema.DateTimeUtc,
  steps: Schema.Array(ProposalExecutionStep),
});
type ProposalItemExecution = typeof ProposalItemExecution.Type;

const ProposalReserveMove = Schema.Struct({
  player: ProposalStepPlayer,
  fromSlot: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.NonEmptyString,
});
type ProposalReserveMove = typeof ProposalReserveMove.Type;

const ProposalSlotMove = Schema.Struct({
  player: ProposalStepPlayer,
  fromSlot: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.NonEmptyString,
});
type ProposalSlotMove = typeof ProposalSlotMove.Type;

const ProposalStaleReason = Schema.Struct({
  code: ProposalStaleCode,
  player: Schema.optional(PlayerRef),
  detail: Schema.NonEmptyString,
});
export type ProposalStaleReason = typeof ProposalStaleReason.Type;

const ProposalStaleness = Schema.Struct({
  status: ProposalStalenessStatus,
  checkedAt: Schema.optional(Schema.DateTimeUtc),
  reasons: Schema.Array(ProposalStaleReason),
});
type ProposalStaleness = typeof ProposalStaleness.Type;

const ProposalCounterparty = Schema.Struct({
  ref: CounterpartyRef,
  name: Schema.optional(Schema.NonEmptyString),
  managerName: Schema.optional(Schema.NonEmptyString),
});
type ProposalCounterparty = typeof ProposalCounterparty.Type;

const ProposalTrade = Schema.Struct({
  state: ProposalTradeState,
  requestedAt: Schema.DateTimeUtc,
  proposedAt: Schema.optional(Schema.DateTimeUtc),
  settledAt: Schema.optional(Schema.DateTimeUtc),
  detail: Schema.optional(Schema.NonEmptyString),
});
type ProposalTrade = typeof ProposalTrade.Type;

export const ProposalItem = Schema.Struct({
  id: ProposalItemId,
  team: TeamId,
  kind: ProposalItemKind,
  adds: Schema.Array(ProposalPlayer),
  drops: Schema.Array(ProposalPlayer),
  bid: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  reason: Schema.NonEmptyString,
  state: ProposalItemState,
  settled: Schema.Boolean.annotate({
    description:
      "Whether this move will never run again: it executed, its trade offer ended, or it was skipped for a reason that cannot change. A failed move is not settled, so it can be replaced in the same set.",
  }),
  staleness: ProposalStaleness,
  execution: Schema.optional(ProposalItemExecution),
  reserveMove: Schema.optional(ProposalReserveMove),
  slotMove: Schema.optional(ProposalSlotMove),
  counterparty: Schema.optional(ProposalCounterparty),
  trade: Schema.optional(ProposalTrade),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
});
export type ProposalItem = typeof ProposalItem.Type;

export const ProposalBudget = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("published"),
    remaining: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  }),
  Schema.Struct({
    status: Schema.Literal("not_published"),
    detail: Schema.NonEmptyString,
  }),
]);
export type ProposalBudget = typeof ProposalBudget.Type;

const PendingTradeRefusal = Schema.Struct({
  code: Schema.Literals(["no_movements", "movement_missing_party"]),
  detail: Schema.NonEmptyString,
});
type PendingTradeRefusal = typeof PendingTradeRefusal.Type;

const PendingTradeParty = Schema.Struct({
  ref: CounterpartyRef,
  name: Schema.optional(Schema.NonEmptyString),
});
type PendingTradeParty = typeof PendingTradeParty.Type;

const PendingTradePlayer = Schema.Struct({
  player: PlayerRef,
  name: Schema.optional(Schema.NonEmptyString),
  displayPosition: Schema.optional(Schema.NonEmptyString),
  proTeam: Schema.optional(Schema.NonEmptyString),
  from: Schema.optional(PendingTradeParty),
  to: Schema.optional(PendingTradeParty),
});
type PendingTradePlayer = typeof PendingTradePlayer.Type;

const PendingTradePick = Schema.Struct({
  round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  from: Schema.optional(PendingTradeParty),
  to: Schema.optional(PendingTradeParty),
  original: Schema.optional(PendingTradeParty),
});
type PendingTradePick = typeof PendingTradePick.Type;

export const PendingTradeOffer = Schema.Struct({
  offerRef: TradeOfferRef,
  proposedAt: Schema.DateTimeUtc,
  note: Schema.optional(Schema.NonEmptyString),
  canRespond: Schema.Boolean,
  proposingTeam: Schema.optional(PendingTradeParty),
  receivingTeam: Schema.optional(PendingTradeParty),
  players: Schema.Array(PendingTradePlayer),
  picks: Schema.Array(PendingTradePick),
  incomplete: Schema.optional(PendingTradeRefusal),
});
export type PendingTradeOffer = typeof PendingTradeOffer.Type;

const ProposalOrderTiming = Schema.Literals([
  "same_day",
  "next_day",
  "weekly_lock",
  "not_published",
]);

const ProposalOrderStep = Schema.Struct({
  item: ProposalItemId,
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

const ProposalOrderConflict = Schema.Struct({
  items: Schema.Array(ProposalItemId),
  detail: Schema.NonEmptyString,
});

const ProposalOrderDecision = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("ordered"),
    timing: ProposalOrderTiming,
    effectiveDate: Schema.optional(Schema.NonEmptyString),
    steps: Schema.Array(ProposalOrderStep),
  }),
  Schema.Struct({
    status: Schema.Literal("conflict"),
    timing: ProposalOrderTiming,
    effectiveDate: Schema.optional(Schema.NonEmptyString),
    conflicts: Schema.Array(ProposalOrderConflict),
  }),
  Schema.Struct({
    status: Schema.Literal("unresolved"),
    timing: ProposalOrderTiming,
    effectiveDate: Schema.optional(Schema.NonEmptyString),
    detail: Schema.NonEmptyString,
  }),
]);

const ProposalTradeRules = Schema.Struct({
  endDate: Schema.optional(Schema.NonEmptyString),
  ratification: Schema.optional(Schema.Literals(["vote", "commissioner", "none", "unknown"])),
  objectionDays: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
type ProposalTradeRules = typeof ProposalTradeRules.Type;

export const ProposalTeam = Schema.Struct({
  team: QueryTeam,
  budget: Schema.optional(ProposalBudget),
  tradeRules: Schema.optional(ProposalTradeRules),
  order: Schema.optional(ProposalOrderDecision),
  failure: Schema.optional(Schema.NonEmptyString),
  items: Schema.Array(ProposalItem),
  pendingOffers: Schema.Array(PendingTradeOffer),
});
export type ProposalTeam = typeof ProposalTeam.Type;

export const ProposalSetProvenance = Schema.Struct({
  kind: ProposalProposerKind,
  reference: Schema.NonEmptyString,
  surface: ProposalSurface,
  client: Schema.optional(Schema.NonEmptyString),
});
export type ProposalSetProvenance = typeof ProposalSetProvenance.Type;

export const ProposalSubmission = Schema.Struct({
  submittedAt: Schema.DateTimeUtc,
  completedAt: Schema.optional(Schema.DateTimeUtc),
}).annotate({
  description:
    "One submission of this set, with when the signed-in person submitted it and, once every outcome was recorded, when that submission completed.",
});
export type ProposalSubmission = typeof ProposalSubmission.Type;

export const ProposalSet = Schema.Struct({
  id: ProposalSetId,
  proposedBy: ProposalSetProvenance,
  createdAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
  expired: Schema.Boolean,
  submissions: Schema.Array(ProposalSubmission).annotate({
    description:
      "Every submission of this set, oldest first. A set has more than one when a failed or skipped move left it open and more moves were sent later.",
  }),
  settled: Schema.Boolean.annotate({
    description:
      "Whether the set is an audit record: it has been submitted and every move in it has settled. An open set accepts new items and another submission of the moves that are still proposed; a settled set refuses both.",
  }),
  reviewPath: Schema.NonEmptyString,
});
export type ProposalSet = typeof ProposalSet.Type;

export const ProposalSetReview = Schema.Struct({
  set: ProposalSet,
  teams: Schema.Array(ProposalTeam),
});
export type ProposalSetReview = typeof ProposalSetReview.Type;

const ProposalReason = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
);
type ProposalReason = typeof ProposalReason.Type;

const ProposalClientLabel = Schema.Trim.pipe(Schema.check(Schema.isMaxLength(60)));
type ProposalClientLabel = typeof ProposalClientLabel.Type;

const ProposalBid = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1_000_000),
);

const ProposalSlotMoveDraft = Schema.Struct({
  player: PlayerRef,
  toSlot: Schema.NonEmptyString,
});

const ProposalItemDraftPicks = Schema.optional(
  Schema.NullOr(Schema.Array(Schema.Unknown)),
).annotate({
  description:
    "Refused when non-empty. A trade item carries players only. A league may allow draft pick trades, and the league read publishes that rule, but a provider publishes picks only on its website and names no element for one in the transaction request Lineupgrade sends, so a pick here is refused with that reason and never silently ignored.",
});

export const ProposalItemDraft = Schema.Struct({
  team: TeamId,
  kind: ProposalItemKind,
  adds: Schema.Array(PlayerRef).pipe(Schema.check(Schema.isMaxLength(10))),
  drops: Schema.Array(PlayerRef).pipe(Schema.check(Schema.isMaxLength(10))),
  slotMove: Schema.optional(Schema.NullOr(ProposalSlotMoveDraft)),
  picks: ProposalItemDraftPicks,
  counterparty: Schema.optional(Schema.NullOr(CounterpartyRef)),
  bid: Schema.optional(Schema.NullOr(ProposalBid)),
  reason: ProposalReason,
});
export type ProposalItemDraft = typeof ProposalItemDraft.Type;

const ProposeSetTarget = Schema.optional(Schema.NullOr(ProposalSetId)).annotate({
  description:
    "The id of an open set, to append these items after its existing ones. A set is open until it is submitted and every move in it has settled; a set whose submission left a move failed, or that was never submitted, is open. The whole set is validated again against the current roster together with the moves that are still proposed, and its stored order is recomputed. Omit it to create a new set. A settled or expired set refuses new items.",
});

export const ProposeTransactionsInput = Schema.Struct({
  set: ProposeSetTarget,
  items: Schema.Array(ProposalItemDraft).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  ),
  client: Schema.optional(Schema.NullOr(ProposalClientLabel)),
});
export type ProposeTransactionsInput = typeof ProposeTransactionsInput.Type;

export const ProposalItemRefusal = Schema.Literals([
  "team_not_owned",
  "reference_invalid",
  "kind_invalid",
  "bid_invalid",
  "draft_pick_included",
  "player_in_both",
  "duplicate_item",
  "trade_counterparty_invalid",
  "trade_player_not_rostered",
  "trade_window_closed",
  "trade_state_unavailable",
  "player_unavailable",
  "drop_not_rostered",
  "move_not_rostered",
  "move_slot_unknown",
  "roster_full",
  "slot_illegal",
  "order_conflict",
  "order_unresolved",
  "period_closed",
  "bid_exceeds_budget",
  "bid_not_available",
  "state_unavailable",
  "trade_counterparty_missing",
]);
export type ProposalItemRefusal = typeof ProposalItemRefusal.Type;

const ProposalItemAccepted = Schema.Struct({
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "The item's 1-based position in the request that stored it.",
  }),
  outcome: Schema.Literal("accepted"),
  item: ProposalItem,
});
type ProposalItemAccepted = typeof ProposalItemAccepted.Type;

export const ProposalItemRefused = Schema.Struct({
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "The item's 1-based position in this request.",
  }),
  outcome: Schema.Literal("refused"),
  refusal: ProposalItemRefusal,
  reason: Schema.NonEmptyString.annotate({
    description: "Why the item cannot run against the set's end state, in plain words.",
  }),
  fix: Schema.NonEmptyString.annotate({
    description: "What would make the item valid, so the client can try again.",
  }),
});
export type ProposalItemRefused = typeof ProposalItemRefused.Type;

export const ProposalItemToWithdraw = Schema.Struct({
  item: ProposalItemId,
  team: TeamId,
  label: Schema.NonEmptyString,
  detail: Schema.NonEmptyString,
});
export type ProposalItemToWithdraw = typeof ProposalItemToWithdraw.Type;

export const ProposeTransactionsResult = Schema.Struct({
  set: ProposalSet,
  created: Schema.Boolean,
  extended: Schema.Boolean,
  items: Schema.Array(ProposalItemAccepted),
  refused: Schema.Array(ProposalItemRefused),
  detail: Schema.NonEmptyString,
});
export type ProposeTransactionsResult = typeof ProposeTransactionsResult.Type;

export const ProposalSetInput = Schema.Struct({ set: ProposalSetId });
export type ProposalSetInput = typeof ProposalSetInput.Type;

export const WithdrawProposalItemsInput = Schema.Struct({
  set: ProposalSetId,
  items: Schema.Array(ProposalItemId).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  ),
});
export type WithdrawProposalItemsInput = typeof WithdrawProposalItemsInput.Type;

export const ProposalItemWithdrawalRefusal = Schema.Struct({
  item: ProposalItemId,
  state: Schema.optional(ProposalItemState),
  detail: Schema.NonEmptyString,
});
export type ProposalItemWithdrawalRefusal = typeof ProposalItemWithdrawalRefusal.Type;

export const SubmitTransactionProposalInput = Schema.Struct({
  set: ProposalSetId,
  include: Schema.Array(ProposalItemId).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  ),
});
export type SubmitTransactionProposalInput = typeof SubmitTransactionProposalInput.Type;

export const PendingTradeOffersInput = Schema.Struct({ team: TeamId });
export type PendingTradeOffersInput = typeof PendingTradeOffersInput.Type;

export const PendingTradeOffersResult = Schema.Struct({
  status: Schema.Literals(["available", "unsupported"]),
  team: QueryTeam,
  readOnly: Schema.Literal(true),
  offers: Schema.Array(PendingTradeOffer),
  ownerNote: TeamOwnerNote,
  agentNotes: Schema.Array(TeamAgentNote).pipe(
    Schema.annotate({
      description:
        "The twenty most recent notes agent clients appended to this team, newest first, each with its author and time. Present as an empty array when the team has none, never absent. These are client memory, not a provider or league fact, and not the owner's instruction: `ownerNote` remains the owner's governing note.",
    }),
  ),
  coverage: Schema.Array(QueryCoverage),
  detail: Schema.NonEmptyString,
});
export type PendingTradeOffersResult = typeof PendingTradeOffersResult.Type;

export const WithdrawTradeInput = Schema.Struct({
  team: TeamId,
  item: Schema.optional(ProposalItemId),
  offer: Schema.optional(TradeOfferRef),
});
export type WithdrawTradeInput = typeof WithdrawTradeInput.Type;

export const WithdrawTradeResult = Schema.Struct({
  status: Schema.Literals(["withdrawn", "not_pending"]),
  tradeState: Schema.optional(ProposalTradeState),
  detail: Schema.NonEmptyString,
});
export type WithdrawTradeResult = typeof WithdrawTradeResult.Type;

export class TransactionProposals extends Context.Service<
  TransactionProposals,
  TransactionProposalsShape
>()("@lineupkeep/backend/contexts/connections/TransactionProposals") {}

export type TransactionProposalsShape = {
  readonly propose: (
    userId: UserId,
    proposer: ProposalSetProvenance,
    input: ProposeTransactionsInput,
  ) => Effect.Effect<ProposeTransactionsResult, ProposalError>;

  readonly revalidate: (
    userId: UserId,
    input: ProposalSetInput,
  ) => Effect.Effect<ProposalSetReview, ProposalError>;

  readonly withdrawItems: (
    userId: UserId,
    input: WithdrawProposalItemsInput,
  ) => Effect.Effect<ProposalSetReview, ProposalError>;

  readonly read: (
    userId: UserId,
    input: ProposalSetInput,
  ) => Effect.Effect<ProposalSetReview, ProposalError>;

  readonly submit: (
    userId: UserId,
    input: SubmitTransactionProposalInput,
  ) => Effect.Effect<ProposalSetReview, ProposalError>;

  readonly readPendingOffers: (
    userId: UserId,
    input: PendingTradeOffersInput,
  ) => Effect.Effect<PendingTradeOffersResult, ProposalError>;

  readonly withdrawTrade: (
    userId: UserId,
    input: WithdrawTradeInput,
  ) => Effect.Effect<WithdrawTradeResult, ProposalError>;
};

export type ProposalError =
  | ProposalContentInvalid
  | ProposalNothingAccepted
  | ProposalNothingIncluded
  | ProposalSetNotFound
  | ProposalSetExpired
  | ProposalSetAlreadySubmitted
  | ProposalSubmissionInProgress
  | ProposalTeamNotFound
  | ProposalTradeNotFound
  | ProposalTradeNotPending
  | ProposalItemsNotWithdrawable
  | ProposalConnectionNotReady
  | ProposalProviderUnavailable
  | ProposalPersistenceFailed;

export class ProposalContentInvalid extends Schema.TaggedError<
  ProposalContentInvalid,
  { readonly brand: unique symbol }
>()("proposal.content_invalid", {
  detail: Schema.NonEmptyString,
}) {}

export class ProposalNothingAccepted extends Schema.TaggedError<
  ProposalNothingAccepted,
  { readonly brand: unique symbol }
>()("proposal.nothing_accepted", {
  refusals: Schema.Array(ProposalItemRefused),
  withdraw: Schema.Array(ProposalItemToWithdraw),
  detail: Schema.NonEmptyString,
}) {}

export class ProposalNothingIncluded extends Schema.TaggedError<
  ProposalNothingIncluded,
  { readonly brand: unique symbol }
>()("proposal.nothing_included", {
  detail: Schema.NonEmptyString,
}) {}

export class ProposalSetAlreadySubmitted extends Schema.TaggedError<
  ProposalSetAlreadySubmitted,
  { readonly brand: unique symbol }
>()("proposal.already_submitted", {
  set: ProposalSetId,
  submittedAt: Schema.DateTimeUtc,
}) {}

export class ProposalSubmissionInProgress extends Schema.TaggedError<
  ProposalSubmissionInProgress,
  { readonly brand: unique symbol }
>()("proposal.submission_in_progress", {
  set: ProposalSetId,
}) {}

export class ProposalTeamNotFound extends Schema.TaggedError<
  ProposalTeamNotFound,
  { readonly brand: unique symbol }
>()("proposal.team_not_found", {
  team: TeamId,
}) {}

export class ProposalTradeNotFound extends Schema.TaggedError<
  ProposalTradeNotFound,
  { readonly brand: unique symbol }
>()("proposal.trade_not_found", {
  detail: Schema.NonEmptyString,
}) {}

export class ProposalTradeNotPending extends Schema.TaggedError<
  ProposalTradeNotPending,
  { readonly brand: unique symbol }
>()("proposal.trade_not_pending", {
  state: ProposalTradeState,
  detail: Schema.NonEmptyString,
}) {}

export class ProposalItemsNotWithdrawable extends Schema.TaggedError<
  ProposalItemsNotWithdrawable,
  { readonly brand: unique symbol }
>()("proposal.items_not_withdrawable", {
  items: Schema.Array(ProposalItemWithdrawalRefusal),
  detail: Schema.NonEmptyString,
}) {}

export class ProposalConnectionNotReady extends Schema.TaggedError<
  ProposalConnectionNotReady,
  { readonly brand: unique symbol }
>()("proposal.connection_not_ready", {
  team: TeamId,
  status: Schema.Literals(["linking", "ready", "reconnect-required", "disconnected", "missing"]),
}) {}

export class ProposalProviderUnavailable extends Schema.TaggedError<
  ProposalProviderUnavailable,
  { readonly brand: unique symbol }
>()("proposal.provider_unavailable", {
  detail: Schema.NonEmptyString,
}) {}

export class ProposalSetNotFound extends Schema.TaggedError<
  ProposalSetNotFound,
  { readonly brand: unique symbol }
>()("proposal.set_not_found", {
  set: ProposalSetId,
}) {}

export class ProposalSetExpired extends Schema.TaggedError<
  ProposalSetExpired,
  { readonly brand: unique symbol }
>()("proposal.set_expired", {
  set: ProposalSetId,
  expiresAt: Schema.DateTimeUtc,
}) {}

export class ProposalPersistenceFailed extends Schema.TaggedError<
  ProposalPersistenceFailed,
  { readonly brand: unique symbol }
>()("proposal.persistence_failed", {
  cause: Schema.Defect(),
}) {}
