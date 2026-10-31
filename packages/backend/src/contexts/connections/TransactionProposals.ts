import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { UserId } from "#contexts/auth/User.ts";

import { TeamId } from "./FantasyTeam.ts";
import { CounterpartyRef, PlayerRef, QueryCoverage, QueryTeam } from "./QueryValues.ts";

export const proposalSetLifetimeMillis = 24 * 60 * 60 * 1000;

export const ProposalSetId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("ProposalSetId"),
);
export type ProposalSetId = typeof ProposalSetId.Type;

export const ProposalItemId = Schema.String.pipe(
  Schema.check(Schema.isUUID()),
  Schema.brand("ProposalItemId"),
);
export type ProposalItemId = typeof ProposalItemId.Type;

export const ProposalItemKind = Schema.Literals(["free_agent_add", "waiver_claim", "drop"]);
export type ProposalItemKind = typeof ProposalItemKind.Type;

export const ProposalItemState = Schema.Literals([
  "proposed",
  "approved",
  "executed",
  "failed",
  "skipped",
]);
export type ProposalItemState = typeof ProposalItemState.Type;

export const ProposalStalenessStatus = Schema.Literals(["unchecked", "current", "stale"]);
export type ProposalStalenessStatus = typeof ProposalStalenessStatus.Type;

export const ProposalStaleCode = Schema.Literals([
  "player_unavailable",
  "drop_not_rostered",
  "roster_full",
  "period_closed",
  "bid_exceeds_budget",
  "bid_not_available",
  "state_unavailable",
]);
export type ProposalStaleCode = typeof ProposalStaleCode.Type;

const ProposalProposerKind = Schema.Literals(["user", "agent"]);
type ProposalProposerKind = typeof ProposalProposerKind.Type;

const ProposalSurface = Schema.Literals(["app", "mcp"]);
type ProposalSurface = typeof ProposalSurface.Type;

const ProposalPlayer = Schema.Struct({
  ref: PlayerRef,
  name: Schema.optional(Schema.NonEmptyString),
});
type ProposalPlayer = typeof ProposalPlayer.Type;

const ProposalStaleReason = Schema.Struct({
  code: ProposalStaleCode,
  player: Schema.optional(PlayerRef),
  detail: Schema.NonEmptyString,
});
type ProposalStaleReason = typeof ProposalStaleReason.Type;

const ProposalStaleness = Schema.Struct({
  status: ProposalStalenessStatus,
  checkedAt: Schema.optional(Schema.DateTimeUtc),
  reasons: Schema.Array(ProposalStaleReason),
});
type ProposalStaleness = typeof ProposalStaleness.Type;

export const ProposalItem = Schema.Struct({
  id: ProposalItemId,
  team: TeamId,
  kind: ProposalItemKind,
  adds: Schema.Array(ProposalPlayer),
  drops: Schema.Array(ProposalPlayer),
  bid: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  reason: Schema.NonEmptyString,
  state: ProposalItemState,
  staleness: ProposalStaleness,
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

export const ProposalTeam = Schema.Struct({
  team: QueryTeam,
  budget: Schema.optional(ProposalBudget),
  failure: Schema.optional(Schema.NonEmptyString),
  items: Schema.Array(ProposalItem),
});
export type ProposalTeam = typeof ProposalTeam.Type;

export const ProposalSetProvenance = Schema.Struct({
  kind: ProposalProposerKind,
  reference: Schema.NonEmptyString,
  surface: ProposalSurface,
  client: Schema.optional(Schema.NonEmptyString),
});
export type ProposalSetProvenance = typeof ProposalSetProvenance.Type;

export const ProposalSet = Schema.Struct({
  id: ProposalSetId,
  proposedBy: ProposalSetProvenance,
  createdAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
  expired: Schema.Boolean,
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

export const ProposalItemDraft = Schema.Struct({
  team: TeamId,
  kind: ProposalItemKind,
  adds: Schema.Array(PlayerRef).pipe(Schema.check(Schema.isMaxLength(10))),
  drops: Schema.Array(PlayerRef).pipe(Schema.check(Schema.isMaxLength(10))),
  bid: Schema.optional(Schema.NullOr(ProposalBid)),
  reason: ProposalReason,
});
export type ProposalItemDraft = typeof ProposalItemDraft.Type;

export const ProposeTransactionsInput = Schema.Struct({
  items: Schema.Array(ProposalItemDraft).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  ),
  client: Schema.optional(Schema.NullOr(ProposalClientLabel)),
});
export type ProposeTransactionsInput = typeof ProposeTransactionsInput.Type;

const ProposalItemRefusal = Schema.Literals([
  "team_not_owned",
  "reference_invalid",
  "kind_invalid",
  "bid_invalid",
  "player_in_both",
  "duplicate_item",
]);
type ProposalItemRefusal = typeof ProposalItemRefusal.Type;

const ProposalItemAccepted = Schema.Struct({
  index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  outcome: Schema.Literal("accepted"),
  item: ProposalItem,
});
type ProposalItemAccepted = typeof ProposalItemAccepted.Type;

export const ProposalItemRefused = Schema.Struct({
  index: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  outcome: Schema.Literal("refused"),
  refusal: ProposalItemRefusal,
  detail: Schema.NonEmptyString,
});
export type ProposalItemRefused = typeof ProposalItemRefused.Type;

const ProposalItemOutcome = Schema.Union([ProposalItemAccepted, ProposalItemRefused]);
type ProposalItemOutcome = typeof ProposalItemOutcome.Type;

export const ProposeTransactionsResult = Schema.Struct({
  set: ProposalSet,
  created: Schema.Boolean,
  items: Schema.Array(ProposalItemOutcome),
  detail: Schema.NonEmptyString,
});
export type ProposeTransactionsResult = typeof ProposeTransactionsResult.Type;

export const ProposalSetInput = Schema.Struct({ set: ProposalSetId });
export type ProposalSetInput = typeof ProposalSetInput.Type;

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

export const PendingTradeOffersInput = Schema.Struct({ team: TeamId });
export type PendingTradeOffersInput = typeof PendingTradeOffersInput.Type;

export const PendingTradeOffersResult = Schema.Struct({
  status: Schema.Literals(["available", "unsupported"]),
  team: QueryTeam,
  readOnly: Schema.Literal(true),
  offers: Schema.Array(PendingTradeOffer),
  coverage: Schema.Array(QueryCoverage),
  detail: Schema.NonEmptyString,
});
export type PendingTradeOffersResult = typeof PendingTradeOffersResult.Type;

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

  readonly read: (
    userId: UserId,
    input: ProposalSetInput,
  ) => Effect.Effect<ProposalSetReview, ProposalError>;

  readonly readPendingOffers: (
    userId: UserId,
    input: PendingTradeOffersInput,
  ) => Effect.Effect<PendingTradeOffersResult, ProposalError>;
};

export type ProposalError =
  | ProposalContentInvalid
  | ProposalNothingAccepted
  | ProposalSetNotFound
  | ProposalSetExpired
  | ProposalTeamNotFound
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
  detail: Schema.NonEmptyString,
}) {}

export class ProposalTeamNotFound extends Schema.TaggedError<
  ProposalTeamNotFound,
  { readonly brand: unique symbol }
>()("proposal.team_not_found", {
  team: TeamId,
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
