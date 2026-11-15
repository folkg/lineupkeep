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

const PendingTradeRefusal = Schema.Struct({
  code: Schema.Literals(["no_movements", "movement_missing_party"]),
  detail: Schema.NonEmptyString,
});

const PendingTradeParty = Schema.Struct({
  ref: CounterpartyRef,
  name: Schema.optional(Schema.NonEmptyString),
});

const PendingTradePlayer = Schema.Struct({
  player: PlayerRef,
  name: Schema.optional(Schema.NonEmptyString),
  displayPosition: Schema.optional(Schema.NonEmptyString),
  proTeam: Schema.optional(Schema.NonEmptyString),
  from: Schema.optional(PendingTradeParty),
  to: Schema.optional(PendingTradeParty),
});

const PendingTradePick = Schema.Struct({
  round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  from: Schema.optional(PendingTradeParty),
  to: Schema.optional(PendingTradeParty),
  original: Schema.optional(PendingTradeParty),
});

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

export class TransactionOffersTeamNotFound extends Schema.TaggedError<
  TransactionOffersTeamNotFound,
  { readonly brand: unique symbol }
>()("transaction_offers.team_not_found", {
  team: TeamId,
}) {}

export class TransactionOffersConnectionNotReady extends Schema.TaggedError<
  TransactionOffersConnectionNotReady,
  { readonly brand: unique symbol }
>()("transaction_offers.connection_not_ready", {
  team: TeamId,
  status: Schema.Literals(["linking", "ready", "reconnect-required", "disconnected", "missing"]),
}) {}

export class TransactionOffersProviderUnavailable extends Schema.TaggedError<
  TransactionOffersProviderUnavailable,
  { readonly brand: unique symbol }
>()("transaction_offers.provider_unavailable", {
  detail: Schema.NonEmptyString,
}) {}

export class TransactionOffersPersistenceFailed extends Schema.TaggedError<
  TransactionOffersPersistenceFailed,
  { readonly brand: unique symbol }
>()("transaction_offers.persistence_failed", {
  cause: Schema.Defect(),
}) {}

export type TransactionOffersError =
  | TransactionOffersTeamNotFound
  | TransactionOffersConnectionNotReady
  | TransactionOffersProviderUnavailable
  | TransactionOffersPersistenceFailed;

export class TransactionOffers extends Context.Service<TransactionOffers, TransactionOffersShape>()(
  "@lineupkeep/backend/contexts/connections/TransactionOffers",
) {}

export type TransactionOffersShape = {
  readonly readPendingOffers: (
    userId: UserId,
    input: PendingTradeOffersInput,
  ) => Effect.Effect<PendingTradeOffersResult, TransactionOffersError>;
};
