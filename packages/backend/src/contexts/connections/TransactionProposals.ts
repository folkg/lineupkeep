import { Context, Effect, Schema } from "effect";

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
  "activate",
  "stash",
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
  "player_team_on_bye",
  "bid_exceeds_budget",
  "bid_not_available",
  "state_unavailable",
  "reserve_unavailable",
  "intent_invalid",
  "trade_window_closed",
  "trade_counterparty_missing",
  "trade_player_not_rostered",
  "trade_draft_pick_not_allowed",
  "trade_draft_pick_unavailable",
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
      description: "The move's position in that submission's team order, counted from zero.",
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
  order: Schema.Literals(["before", "after"]).annotate({
    description: "Whether this move is sent before the item's moves or after them.",
  }),
});
type ProposalReserveMove = typeof ProposalReserveMove.Type;

const ProposalSlotMove = Schema.Struct({
  player: ProposalStepPlayer,
  fromSlot: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.NonEmptyString,
});
type ProposalSlotMove = typeof ProposalSlotMove.Type;

const ProposalItemPlacement = Schema.Struct({
  player: ProposalStepPlayer,
  fromSlot: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.NonEmptyString,
  detail: Schema.NonEmptyString.annotate({
    description: "Why the place was chosen, in one sentence.",
  }),
}).annotate({
  description: "The place chosen for an item stated as intent, such as an add, activate, or stash.",
});
type ProposalItemPlacement = typeof ProposalItemPlacement.Type;

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

const ProposalTradeParty = Schema.Struct({
  ref: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});
type ProposalTradeParty = typeof ProposalTradeParty.Type;

const ProposalTradePick = Schema.Struct({
  round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  from: ProposalTradeParty,
  to: ProposalTradeParty,
});
type ProposalTradePick = typeof ProposalTradePick.Type;

const ProposalTradeSupport = Schema.Struct({
  assets: Schema.Array(Schema.Literals(["player", "draft_pick"])),
  detail: Schema.NonEmptyString,
});
type ProposalTradeSupport = typeof ProposalTradeSupport.Type;

const ProposalTrade = Schema.Struct({
  state: ProposalTradeState,
  requestedAt: Schema.DateTimeUtc,
  proposedAt: Schema.optional(Schema.DateTimeUtc),
  settledAt: Schema.optional(Schema.DateTimeUtc),
  detail: Schema.optional(Schema.NonEmptyString),
}).annotate({
  description:
    "A submitted trade is a real offer to another manager, who alone decides whether to accept it.",
});
type ProposalTrade = typeof ProposalTrade.Type;

export const ProposalItem = Schema.Struct({
  id: ProposalItemId,
  team: TeamId,
  kind: ProposalItemKind,
  adds: Schema.Array(ProposalPlayer),
  drops: Schema.Array(ProposalPlayer),
  picks: Schema.Array(ProposalTradePick).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  bid: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  reason: Schema.NonEmptyString,
  state: ProposalItemState,
  settled: Schema.Boolean.annotate({
    description:
      "Whether the move will never run again: it executed, its offer ended, or it was skipped irreversibly. A failed move is not settled.",
  }),
  staleness: ProposalStaleness,
  execution: Schema.optional(ProposalItemExecution),
  reserveMove: Schema.optional(ProposalReserveMove),
  slotMove: Schema.optional(ProposalSlotMove),
  placement: Schema.optional(ProposalItemPlacement),
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
  rosterPlace: Schema.optional(
    Schema.Literals(["frees", "consumes"]).annotate({
      description:
        "Whether this move frees or consumes a place. Absent when it leaves the count unchanged.",
    }),
  ),
});

const ProposalOrderRosterPlaces = Schema.Struct({
  maximum: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  occupied: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description: "Places held now; reserve-list players are outside this count.",
  }),
  net: Schema.Int.annotate({
    description:
      "Ordered moves' freed places minus consumed places, so `occupied` plus `net` is the count after them.",
  }),
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
    rosterPlaces: ProposalOrderRosterPlaces,
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
]).annotate({
  description:
    "The plan chosen for a team: an order, a conflict between moves, or a search that hit its bound. A trade follows the roster moves.",
});

export const ProposalTeamLineup = Schema.Struct({
  status: Schema.Literals([
    "settled",
    "pending",
    "blocked",
    "failed",
    "uncertain",
    "not_started",
    "not_needed",
    "superseded",
  ]),
  detail: Schema.NonEmptyString,
  run: Schema.optional(Schema.NonEmptyString),
  at: Schema.optional(Schema.NonEmptyString),
}).annotate({
  description:
    "The lineup run given after these items ran, if any, and its outcome. A failed run changes no item's outcome.",
});
export type ProposalTeamLineup = typeof ProposalTeamLineup.Type;

const ProposalTradeRules = Schema.Struct({
  endDate: Schema.optional(Schema.NonEmptyString),
  ratification: Schema.optional(Schema.Literals(["vote", "commissioner", "none", "unknown"])),
  objectionDays: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
type ProposalTradeRules = typeof ProposalTradeRules.Type;

export const ProposalTeam = Schema.Struct({
  team: QueryTeam,
  budget: Schema.optional(ProposalBudget),
  tradeProposal: Schema.optional(ProposalTradeSupport),
  tradeRules: Schema.optional(ProposalTradeRules),
  order: Schema.optional(ProposalOrderDecision),
  lineup: Schema.optional(ProposalTeamLineup),
  failure: Schema.optional(Schema.NonEmptyString).annotate({
    description:
      "Why this team's state could not be read; its items are stale and other teams are unaffected.",
  }),
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
    "One submission of this set and, once every outcome was recorded, when it completed.",
});
export type ProposalSubmission = typeof ProposalSubmission.Type;

export const ProposalSet = Schema.Struct({
  id: ProposalSetId,
  proposedBy: ProposalSetProvenance,
  createdAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc.annotate({
    description: "24 hours after the set was created.",
  }),
  expired: Schema.Boolean,
  submissions: Schema.Array(ProposalSubmission).annotate({
    description:
      "Every submission, oldest first. More than one when a failed or skipped move left the set open.",
  }),
  settled: Schema.Boolean.annotate({
    description:
      "Whether the set is an audit record: submitted, with every move settled. A settled set refuses new items and submissions.",
  }),
  reviewPath: Schema.NonEmptyString,
});
export type ProposalSet = typeof ProposalSet.Type;

export const ProposalSetReview = Schema.Struct({
  set: ProposalSet,
  teams: Schema.Array(ProposalTeam).annotate({
    description: "Every owned team, including those with nothing proposed.",
  }),
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

const ProposalTradePickDraft = Schema.Struct({
  round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
    description: "Counted from 1.",
  }),
  from: Schema.NonEmptyString.annotate({
    description: "The item's team id or its counterparty reference.",
  }),
  to: Schema.NonEmptyString.annotate({
    description: "The item's team id or its counterparty reference.",
  }),
});

const ProposalItemDraftPicks = Schema.optional(
  Schema.NullOr(Schema.Array(ProposalTradePickDraft).pipe(Schema.check(Schema.isMaxLength(10)))),
).annotate({
  description:
    "Draft picks in a trade: round, from, to. The league switch and the sender's rounds decide.",
});

const ProposalSlotMoveDraft = Schema.Struct({
  player: PlayerRef,
  toSlot: Schema.NonEmptyString,
});

const ProposalActiveOrReserve = Schema.Literals(["active", "reserve"]);
type ProposalActiveOrReserve = typeof ProposalActiveOrReserve.Type;

export const ProposalItemDraft = Schema.Struct({
  team: TeamId,
  kind: ProposalItemKind.annotate({
    description: "A `drop` adds nobody and cannot bid; a free-agent `add` cannot bid either.",
  }),
  adds: Schema.Array(PlayerRef).pipe(
    Schema.check(Schema.isMaxLength(10)),
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  drops: Schema.Array(PlayerRef).pipe(
    Schema.check(Schema.isMaxLength(10)),
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  to: Schema.optional(Schema.NullOr(ProposalActiveOrReserve)).annotate({
    description:
      "For an add, `active` (the default) or `reserve`; a reserve add carries one player. Omit it for other kinds.",
  }),
  player: Schema.optional(Schema.NullOr(PlayerRef)).annotate({
    description:
      "For an activate or stash, the rostered player to move. An activate brings a reserve player onto the active roster; a stash does the reverse.",
  }),
  slotMove: Schema.optional(Schema.NullOr(ProposalSlotMoveDraft)).annotate({
    description:
      "Moves a player between slots on the same roster; it does not set the lineup (`set_lineup`).",
  }),
  picks: ProposalItemDraftPicks,
  counterparty: Schema.optional(Schema.NullOr(CounterpartyRef)),
  bid: Schema.optional(Schema.NullOr(ProposalBid)).annotate({
    description: "A FAAB bid on a free-agent add.",
  }),
  reason: ProposalReason,
});
export type ProposalItemDraft = typeof ProposalItemDraft.Type;

const ProposeSetTarget = Schema.optional(Schema.NullOr(ProposalSetId)).annotate({
  description:
    "An open set to append these items to. Omit to create a new set; a settled or expired set refuses new items.",
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
  "player_in_both",
  "duplicate_item",
  "trade_counterparty_invalid",
  "trade_player_not_rostered",
  "trade_pick_team_not_party",
  "trade_draft_pick_not_allowed",
  "trade_draft_pick_unavailable",
  "trade_draft_pick_duplicate",
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
  "player_team_on_bye",
  "bid_exceeds_budget",
  "bid_not_available",
  "state_unavailable",
  "reserve_unavailable",
  "intent_invalid",
  "trade_counterparty_missing",
]);
export type ProposalItemRefusal = typeof ProposalItemRefusal.Type;

const ProposalItemAccepted = Schema.Struct({
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  outcome: Schema.Literal("accepted"),
  item: ProposalItem,
});
type ProposalItemAccepted = typeof ProposalItemAccepted.Type;

export const ProposalItemRefused = Schema.Struct({
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  outcome: Schema.Literal("refused"),
  refusal: ProposalItemRefusal,
  reason: Schema.NonEmptyString.annotate({
    description: "Why the item cannot run against the set's end state.",
  }),
  fix: Schema.NonEmptyString.annotate({
    description: "What would make the item valid.",
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
  created: Schema.Boolean.annotate({
    description:
      "False when an identical set already existed; a changed set no longer matches its original items.",
  }),
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
  offers: Schema.Array(PendingTradeOffer).annotate({
    description: "Offers the site publishes for this account's managing team.",
  }),
  ownerNote: TeamOwnerNote,
  agentNotes: Schema.Array(TeamAgentNote).pipe(
    Schema.annotate({
      description:
        "The twenty most recent agent notes, newest first, empty when none. Client memory, not the owner's note.",
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
