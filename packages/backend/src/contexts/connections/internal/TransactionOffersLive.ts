import { Array, DateTime, Effect, Layer, Schema } from "effect";
import { Array as EffectArray } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { TeamId } from "#contexts/connections/FantasyTeam.ts";
import type {
  ProviderPendingTrade,
  ProviderTransactionTeam,
} from "#contexts/connections/Provider.ts";
import { sessionEvidenceOf } from "#contexts/connections/Provider.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";
import type { CounterpartyRef, QueryTeam } from "#contexts/connections/QueryValues.ts";
import {
  PendingTradeOffer,
  PendingTradeOffersResult as PendingTradeOffersResultSchema,
  TransactionOffers,
  TransactionOffersConnectionNotReady,
  TransactionOffersPersistenceFailed,
  TransactionOffersProviderUnavailable,
  TransactionOffersTeamNotFound,
} from "#contexts/connections/TransactionOffers.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import { loadTeamContext, ownerNoteOf, providerIdentity } from "./QueryContext.ts";
import { QueryRepository } from "./QueryRepository.ts";
import { QueryTokens } from "./QueryTokens.ts";
function arrayValueIsArray<A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> {
  return EffectArray.isArray(value);
}

export const TransactionOffersLive = Layer.effect(
  TransactionOffers,
  Effect.gen(function* () {
    const queries = yield* QueryRepository;
    const encryption = yield* ConnectionCredentialEncryption;
    const registry = yield* ProviderRegistry;
    const tokens = yield* QueryTokens;

    const readPendingOffers: TransactionOffers["Service"]["readPendingOffers"] = Effect.fn(
      "TransactionOffers.readPendingOffers",
    )(function* (userId: UserId, input) {
      const loaded = yield* Effect.result(
        loadTeamContext(queries, encryption, registry, userId, input.team),
      );
      if (loaded._tag === "Failure") {
        switch (loaded.failure._tag) {
          case "query.team_not_found":
            return yield* TransactionOffersTeamNotFound.make({ team: input.team });
          case "query.connection_not_ready":
            return yield* TransactionOffersConnectionNotReady.make({
              team: input.team,
              status: loaded.failure.status,
            });
          case "query.cursor_invalid":
          case "query.reference_invalid":
          case "query.selection_invalid":
          case "query.persistence_failed":
            return yield* TransactionOffersPersistenceFailed.make({ cause: loaded.failure });
        }
      }
      const context = loaded.success;
      const agentNotes = yield* queries
        .recentAgentNotes(userId, input.team)
        .pipe(Effect.mapError((cause) => TransactionOffersPersistenceFailed.make({ cause })));
      const fetchedAt = yield* DateTime.now;
      const outcome = yield* context.provider
        .readPendingTrades({
          ...providerIdentity(context),
          providerLeagueKey: context.owned.team.providerLeagueKey,
          providerTeamKey: context.owned.team.providerTeamKey,
        })
        .pipe(
          Effect.matchEffect({
            onSuccess: (trades) => Effect.succeed({ status: "ok" as const, trades }),
            onFailure: (error) => {
              if (error._tag === "provider.operation_unsupported") {
                return Effect.succeed({ status: "unsupported" as const, detail: error.reason });
              }
              const unavailable = TransactionOffersProviderUnavailable.make({
                detail:
                  error._tag === "provider.session_rejected"
                    ? "Your league rejected the stored sign-in. Reconnect and read the offers again."
                    : error._tag === "provider.request_failed"
                      ? "The pending trade offers at your league could not be read."
                      : "The pending trade offers at your league could not be verified.",
              });
              return error._tag === "provider.session_rejected"
                ? queries
                    .recordSessionRejected(userId, context.owned, sessionEvidenceOf(error))
                    .pipe(Effect.andThen(unavailable))
                : unavailable;
            },
          }),
        );
      const team = teamView(context.owned.team);
      if (outcome.status === "unsupported") {
        return yield* Schema.decodeEffect(PendingTradeOffersResultSchema)({
          status: "unsupported",
          team,
          readOnly: true,
          offers: [],
          ownerNote: ownerNoteOf(context.owned.team),
          agentNotes,
          coverage: [
            {
              resource: "pending_trade_offers",
              status: "unsupported",
              source: "provider",
              fetchedAt,
              detail: outcome.detail,
            },
          ],
          detail:
            "Your league publishes no pending trade offers for this read, so none are shown rather than an empty success.",
        }).pipe(Effect.mapError((cause) => TransactionOffersPersistenceFailed.make({ cause })));
      }
      const offers = yield* pendingTradeOffers({
        tokens,
        userId,
        leagueKey: context.owned.team.providerLeagueKey,
        teamKey: context.owned.team.providerTeamKey,
        trades: outcome.trades,
      });
      return yield* Schema.decodeEffect(PendingTradeOffersResultSchema)({
        status: "available",
        team,
        readOnly: true,
        offers,
        ownerNote: ownerNoteOf(context.owned.team),
        agentNotes,
        coverage: [
          {
            resource: "pending_trade_offers",
            status: "available",
            source: "provider_pending_trade",
            fetchedAt,
          },
        ],
        detail:
          "Read-only. These are this team's pending trade offers as your league publishes them to this account. Lineupgrade cannot accept, reject, vote on, or withdraw an offer.",
      }).pipe(Effect.mapError((cause) => TransactionOffersPersistenceFailed.make({ cause })));
    });

    return TransactionOffers.of({ readPendingOffers });
  }),
);

type PendingParty = {
  readonly ref: CounterpartyRef;
  readonly name?: string;
};

function teamView(team: {
  readonly id: TeamId;
  readonly name: string;
  readonly provider: QueryTeam["provider"];
  readonly league: QueryTeam["league"];
  readonly sport: QueryTeam["sport"];
  readonly season: number;
}): QueryTeam {
  return {
    id: team.id,
    name: team.name,
    provider: team.provider,
    league: team.league,
    sport: team.sport,
    season: team.season,
  };
}

function tradePartiesTeam(trade: ProviderPendingTrade, providerTeamKey: string): boolean {
  return (
    trade.proposer?.providerTeamKey === providerTeamKey ||
    trade.receiver?.providerTeamKey === providerTeamKey
  );
}

function pendingTradeOffers(input: {
  readonly tokens: QueryTokens["Service"];
  readonly userId: UserId;
  readonly leagueKey: string;
  readonly teamKey: string;
  readonly trades: ReadonlyArray<ProviderPendingTrade>;
}): Effect.Effect<ReadonlyArray<PendingTradeOffer>, TransactionOffersPersistenceFailed> {
  return Effect.gen(function* () {
    const trades = EffectArray.filter(input.trades, (trade) =>
      tradePartiesTeam(trade, input.teamKey),
    );
    const playerKeys = EffectArray.flatMap(trades, (trade) => {
      const flatMapped1 = EffectArray.map(trade.players, (player) => player.providerPlayerKey);
      return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
    });
    const teamKeys = [...teamKeysOf(trades)];
    const playerRefs = yield* input.tokens.sealPlayerRefs({
      userId: input.userId,
      leagueKey: input.leagueKey,
      playerKeys,
    });
    const teamRefs = yield* input.tokens.sealCounterpartyRefs({
      userId: input.userId,
      leagueKey: input.leagueKey,
      teamKeys,
    });
    const offerRefGroups = yield* input.tokens.sealTradeOfferRefGroups({
      userId: input.userId,
      groups: [
        {
          leagueKey: input.leagueKey,
          transactionKeys: EffectArray.map(trades, (trade) => trade.transactionKey),
        },
      ],
    });
    const offerRefs = Array.getUnsafe(offerRefGroups, 0);
    const partyByTeam = new Map(
      EffectArray.map(teamKeys, (key, index) => [key, Array.getUnsafe(teamRefs, index)] as const),
    );
    const partyOf = (team: ProviderTransactionTeam | undefined): PendingParty | undefined => {
      if (team === undefined) {
        return undefined;
      }
      const ref = partyByTeam.get(team.providerTeamKey);
      if (ref === undefined) {
        throw new Error("A pending trade party is missing its reference");
      }
      return team.name === undefined ? { ref } : { ref, name: team.name };
    };
    const offers: Array<PendingTradeOffer> = [];
    let playerOffset = 0;
    for (const [tradeIndex, trade] of trades.entries()) {
      const proposedAt = yield* Schema.decodeEffect(Schema.DateTimeUtcFromString)(
        trade.proposedAt,
      ).pipe(Effect.mapError((cause) => TransactionOffersPersistenceFailed.make({ cause })));
      const proposingTeam = partyOf(trade.proposer);
      const receivingTeam = partyOf(trade.receiver);
      offers.push({
        offerRef: Array.getUnsafe(offerRefs, tradeIndex),
        proposedAt,
        ...(trade.note === undefined ? {} : { note: trade.note }),
        canRespond: trade.canRespond,
        ...(proposingTeam === undefined ? {} : { proposingTeam }),
        ...(receivingTeam === undefined ? {} : { receivingTeam }),
        players: EffectArray.map(trade.players, (player, playerIndex) => {
          const from = partyOf(player.movement.from);
          const to = partyOf(player.movement.to);
          return {
            player: Array.getUnsafe(playerRefs, playerOffset + playerIndex),
            ...(player.name === undefined ? {} : { name: player.name }),
            ...(player.displayPosition === undefined
              ? {}
              : { displayPosition: player.displayPosition }),
            ...(player.proTeam === undefined ? {} : { proTeam: player.proTeam }),
            ...(from === undefined ? {} : { from }),
            ...(to === undefined ? {} : { to }),
          };
        }),
        picks: EffectArray.map(trade.picks, (pick) => {
          const from = partyOf(pick.from);
          const to = partyOf(pick.to);
          const original = partyOf(pick.original);
          return {
            round: pick.round,
            ...(from === undefined ? {} : { from }),
            ...(to === undefined ? {} : { to }),
            ...(original === undefined ? {} : { original }),
          };
        }),
        ...(trade.incomplete === undefined
          ? {}
          : {
              incomplete: {
                code:
                  trade.incomplete.code === "no_movements"
                    ? ("no_movements" as const)
                    : ("movement_missing_party" as const),
                detail: trade.incomplete.detail,
              },
            }),
      });
      playerOffset += trade.players.length;
    }
    return offers;
  });
}

function teamKeysOf(trades: ReadonlyArray<ProviderPendingTrade>): ReadonlySet<string> {
  const keys = new Set<string>();
  const remember = (team: ProviderTransactionTeam | undefined): void => {
    if (team !== undefined) {
      keys.add(team.providerTeamKey);
    }
  };
  for (const trade of trades) {
    remember(trade.proposer);
    remember(trade.receiver);
    for (const player of trade.players) {
      remember(player.movement.from);
      remember(player.movement.to);
    }
    for (const pick of trade.picks) {
      remember(pick.from);
      remember(pick.to);
      remember(pick.original);
    }
  }
  return keys;
}
