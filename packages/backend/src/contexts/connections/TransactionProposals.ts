import { Context, Effect, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";

import { TeamAgentNote } from "./AgentNote.ts";
import { TeamId } from "./FantasyTeam.ts";
import {
  CounterpartyRef,
  Cursor,
  PageLimit,
  PlayerRef,
  QueryCoverage,
  QueryPage,
  QueryTeam,
  TeamOwnerNote,
  TradeOfferRef,
} from "./QueryValues.ts";

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
  "dismissed",
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

const ProposalDate = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)),
  Schema.annotate({
    description: "A calendar date given as `YYYY-MM-DD` and read in the league's own fantasy day.",
  }),
);

const EffectiveDate = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)),
  Schema.annotate({ description: "When it takes effect." }),
);

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

const ProposalBid = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1_000_000),
);

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
      description: "The move's position in the submission's team order, from zero.",
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
    description: "Whether this move is sent before or after the item's moves.",
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
  description: "The place chosen for an intent item, such as an add, activate, or stash.",
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
  description: "A submitted trade is a real offer to another manager, who alone decides.",
});
type ProposalTrade = typeof ProposalTrade.Type;

export const ProposalItem = Schema.Struct({
  id: ProposalItemId,
  team: TeamId,
  kind: ProposalItemKind,
  adds: Schema.Array(ProposalPlayer),
  fallbacks: Schema.Array(ProposalPlayer).annotate({
    description: "Other players to use in order if the first choice cannot be added.",
  }),
  drops: Schema.Array(ProposalPlayer),
  picks: Schema.Array(ProposalTradePick).pipe(Schema.withDecodingDefaultKey(Effect.succeed([]))),
  bid: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  reason: Schema.NonEmptyString,
  state: ProposalItemState,
  settled: Schema.Boolean.annotate({
    description: "Whether the move will never run again; a failed move is not settled.",
  }),
  staleness: ProposalStaleness,
  outcomeDetail: Schema.optional(Schema.NonEmptyString).annotate({
    description: "What the owner recorded when dismissing the move.",
  }),
  execution: Schema.optional(ProposalItemExecution),
  reserveMove: Schema.optional(ProposalReserveMove),
  slotMove: Schema.optional(ProposalSlotMove),
  placement: Schema.optional(ProposalItemPlacement),
  counterparty: Schema.optional(ProposalCounterparty),
  trade: Schema.optional(ProposalTrade),
  window: Schema.optional(ProposalDate).annotate({
    description:
      "The date this move runs, not when it takes effect; absent when it runs on submission.",
  }),
  effectiveDate: Schema.optional(EffectiveDate),
  effectiveWarning: Schema.optional(Schema.NonEmptyString),
  approvedAt: Schema.optional(Schema.DateTimeUtc).annotate({
    description: "When a submission approved a move that waits for a later date.",
  }),
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
        "Whether this move frees or consumes a place; absent when the count is unchanged.",
    }),
  ),
});

const ProposalOrderRosterPlaces = Schema.Struct({
  maximum: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  occupied: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description: "Places held now; reserve-list players are outside this count.",
  }),
  net: Schema.Int.annotate({
    description: "Freed minus consumed places, so `occupied` plus `net` is the count after them.",
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
    rosterPlaces: Schema.optional(
      ProposalOrderRosterPlaces.annotate({
        description:
          "Places held at the last check; absent for a plan stored before the count was recorded.",
      }),
    ),
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
    "The plan for a team: an order, a conflict between moves, or a bound the search hit; a trade follows the roster moves.",
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
    "The lineup run given after these items ran, and its outcome; a failed run changes no item.",
});
export type ProposalTeamLineup = typeof ProposalTeamLineup.Type;

const ProposalTradeRules = Schema.Struct({
  endDate: Schema.optional(Schema.NonEmptyString),
  ratification: Schema.optional(Schema.Literals(["vote", "commissioner", "none", "unknown"])),
  objectionDays: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
type ProposalTradeRules = typeof ProposalTradeRules.Type;

export const ProposalIllegalRosterOccupant = Schema.Struct({
  name: Schema.NonEmptyString,
  slot: Schema.NonEmptyString,
  detail: Schema.NonEmptyString,
}).annotate({
  description:
    "A player the league places in a slot that does not accept them, with the cause and the fix.",
});
export type ProposalIllegalRosterOccupant = typeof ProposalIllegalRosterOccupant.Type;

export const ProposalTeam = Schema.Struct({
  team: QueryTeam,
  budget: Schema.optional(ProposalBudget),
  tradeProposal: Schema.optional(ProposalTradeSupport),
  tradeRules: Schema.optional(ProposalTradeRules),
  order: Schema.optional(ProposalOrderDecision),
  lineup: Schema.optional(ProposalTeamLineup),
  today: Schema.optional(ProposalDate).annotate({
    description:
      "Today in this league's own fantasy day, so a move's window can be read against it.",
  }),
  illegalRoster: Schema.optional(Schema.Array(ProposalIllegalRosterOccupant)).annotate({
    description:
      "Players on this team's current roster that the league places in a slot it does not accept. Present when current state was checked.",
  }),
  failure: Schema.optional(Schema.NonEmptyString).annotate({
    description:
      "Why this team's state could not be read; its items are stale, other teams unaffected.",
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

const ProposalSetSummary = Schema.Struct({
  id: ProposalSetId.annotate({
    description: "The plan's identifier, used by its review page and by a later submission.",
  }),
  proposedBy: ProposalSetProvenance.annotate({
    description: "Who proposed the plan, from which surface, and the client label when recorded.",
  }),
  createdAt: Schema.DateTimeUtc.annotate({
    description: "When the plan was first proposed.",
  }),
  updatedAt: Schema.DateTimeUtc.annotate({
    description: "When the plan last changed.",
  }),
  closed: Schema.Boolean.annotate({
    description: "Whether every move in the plan has ended, so it cannot be submitted again.",
  }),
  reviewPath: Schema.NonEmptyString.annotate({
    description: "The application path of the plan's review and submit page.",
  }),
  teams: Schema.Array(
    Schema.Struct({
      team: QueryTeam.annotate({
        description: "The team whose moves this summary carries.",
      }),
      items: Schema.Array(ProposalItem).annotate({
        description: "This team's moves in the plan, with their state and last recorded check.",
      }),
      illegalRoster: Schema.optional(Schema.Array(ProposalIllegalRosterOccupant)).annotate({
        description:
          "Players on this team's current roster that the league places in a slot it does not accept. Present when current state was read.",
      }),
    }),
  ).annotate({
    description: "The requested team's part of the plan; another team's moves are not repeated.",
  }),
});
type ProposalSetSummary = typeof ProposalSetSummary.Type;

export const ListProposalSetsInput = Schema.Struct({
  team: TeamId.annotate({
    description: "The owned team whose plans are listed.",
  }),
  state: Schema.optional(Schema.Literals(["open", "closed"])).annotate({
    description: "`open` lists plans with a move that has not settled; `closed` lists the rest.",
  }),
  cursor: Schema.optional(Cursor),
  limit: Schema.optional(PageLimit),
});
export type ListProposalSetsInput = typeof ListProposalSetsInput.Type;

export const ProposalSetList = Schema.Struct({
  status: Schema.Literal("ok").annotate({
    description: "The read succeeded.",
  }),
  team: QueryTeam.annotate({
    description: "The team whose plans were listed.",
  }),
  sets: Schema.Array(ProposalSetSummary).annotate({
    description: "Plans on this page, newest change first.",
  }),
  page: QueryPage.annotate({
    description: "How many plans this page returned, whether more remain, and the next cursor.",
  }),
});
export type ProposalSetList = typeof ProposalSetList.Type;

export const ProposalSubmission = Schema.Struct({
  submittedAt: Schema.DateTimeUtc,
  completedAt: Schema.optional(Schema.DateTimeUtc),
}).annotate({
  description: "One submission, and when its last outcome was recorded.",
});
export type ProposalSubmission = typeof ProposalSubmission.Type;

export const ProposalSet = Schema.Struct({
  id: ProposalSetId,
  proposedBy: ProposalSetProvenance,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc.annotate({
    description: "When the plan last changed.",
  }),
  submissions: Schema.Array(ProposalSubmission).annotate({
    description: "Every submission, oldest first; more than one when a move failed or was skipped.",
  }),
  closed: Schema.Boolean.annotate({
    description: "Whether every move has ended, so the plan refuses new moves and submissions.",
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

const SubmittedProposalBid = Schema.Struct({
  item: ProposalItemId,
  bid: ProposalBid,
}).annotate({
  description:
    "A FAAB bid sent for one move in this submission, which can differ from the bid the set proposed.",
});
type SubmittedProposalBid = typeof SubmittedProposalBid.Type;

export const SubmitTransactionProposalResult = Schema.Struct({
  ...ProposalSetReview.fields,
  submittedBids: Schema.Array(SubmittedProposalBid),
  waiting: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description: "How many selected moves wait for a later date instead of running now.",
  }),
});
export type SubmitTransactionProposalResult = typeof SubmitTransactionProposalResult.Type;

const RunApprovedSummary = Schema.Struct({
  due: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description: "How many approved moves had reached their date.",
  }),
  included: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description: "How many due moves a submission included.",
  }),
  waiting: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description: "How many due moves a submission still judged to be waiting for a later date.",
  }),
  refused: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description: "How many due moves an expected refusal left for a later pass.",
  }),
  inProgress: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description:
      "How many due moves were skipped because their plan already had a submission in progress.",
  }),
});
type RunApprovedSummary = typeof RunApprovedSummary.Type;

const ProposalReason = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(500)),
);
type ProposalReason = typeof ProposalReason.Type;

const ProposalClientLabel = Schema.Trim.pipe(Schema.check(Schema.isMaxLength(60)));
type ProposalClientLabel = typeof ProposalClientLabel.Type;

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
  fallbacks: Schema.optional(Schema.NullOr(Schema.Array(PlayerRef))).annotate({
    description: "Other players to use in order if the first choice cannot be added.",
  }),
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
  window: Schema.optional(Schema.NullOr(Schema.String)).annotate({
    description:
      "The date (`YYYY-MM-DD`, in the league's fantasy day) the move runs, not when it takes effect; a next_day league applies it the next day. Omit it to run on submission; a trade carries none.",
  }),
  reason: ProposalReason,
});
export type ProposalItemDraft = typeof ProposalItemDraft.Type;

const ProposeSetTarget = Schema.optional(Schema.NullOr(ProposalSetId)).annotate({
  description: "An open set to append these items to; omit to create a new set.",
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
  "fallbacks_not_allowed",
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
  "window_invalid",
  "window_past",
  "window_not_allowed",
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
    description: "False when an identical set already existed.",
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

export const DismissProposalItemsInput = Schema.Struct({
  set: ProposalSetId,
  items: Schema.Array(ProposalItemId).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(25)),
  ),
  reason: Schema.optional(ProposalReason).annotate({
    description: "Why the move was dismissed, kept with it.",
  }),
});
export type DismissProposalItemsInput = typeof DismissProposalItemsInput.Type;

export const ProposalItemNotOpenRefusal = Schema.Struct({
  item: ProposalItemId,
  state: Schema.optional(ProposalItemState),
  detail: Schema.NonEmptyString,
});
export type ProposalItemNotOpenRefusal = typeof ProposalItemNotOpenRefusal.Type;

const ProposalBidSubmission = Schema.Struct({
  item: ProposalItemId,
  bid: Schema.Finite.annotate({
    description:
      "The FAAB bid the owner set at review. A whole number from 0 upward, checked against the league and the team's remaining budget.",
  }),
});

export const SubmitTransactionProposalInput = Schema.Struct({
  set: ProposalSetId,
  include: Schema.Array(ProposalItemId).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  ),
  bids: Schema.optional(
    Schema.Array(ProposalBidSubmission).pipe(Schema.check(Schema.isMaxLength(20))),
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

  readonly dismissItems: (
    userId: UserId,
    input: DismissProposalItemsInput,
  ) => Effect.Effect<ProposalSetReview, ProposalError>;

  readonly read: (
    userId: UserId,
    input: ProposalSetInput,
  ) => Effect.Effect<ProposalSetReview, ProposalError>;

  readonly list: (
    userId: UserId,
    input: ListProposalSetsInput,
  ) => Effect.Effect<ProposalSetList, ProposalError>;

  readonly submit: (
    userId: UserId,
    input: SubmitTransactionProposalInput,
  ) => Effect.Effect<SubmitTransactionProposalResult, ProposalError>;

  readonly runApproved: (
    limit: number,
    at: import("effect").DateTime.Utc,
  ) => Effect.Effect<RunApprovedSummary, ProposalPersistenceFailed>;

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
  | ProposalSetClosed
  | ProposalSubmissionInProgress
  | ProposalTeamNotFound
  | ProposalTradeNotFound
  | ProposalTradeNotPending
  | ProposalItemsNotOpen
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

export class ProposalSetClosed extends Schema.TaggedError<
  ProposalSetClosed,
  { readonly brand: unique symbol }
>()("proposal.set_closed", {
  set: ProposalSetId,
  detail: Schema.NonEmptyString,
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

export class ProposalItemsNotOpen extends Schema.TaggedError<
  ProposalItemsNotOpen,
  { readonly brand: unique symbol }
>()("proposal.items_not_open", {
  items: Schema.Array(ProposalItemNotOpenRefusal),
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

export class ProposalPersistenceFailed extends Schema.TaggedError<
  ProposalPersistenceFailed,
  { readonly brand: unique symbol }
>()("proposal.persistence_failed", {
  cause: Schema.Defect(),
}) {}
