import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as API from "#yahoo/api.ts";
import { YahooWriteUnknown } from "#yahoo/errors.ts";
import type { YahooWriteError } from "#yahoo/errors.ts";
import { findPendingTradeKey } from "#yahoo/json.ts";
import {
  YahooDraftPickRound,
  YahooLeagueKey,
  YahooPendingTradeKey,
  YahooPlayerKey,
  YahooTeamKey,
  YahooTransactionKey,
  leagueKeyOfTeam,
} from "#yahoo/keys.ts";
import { TradeReceipt, WriteReceipt } from "#yahoo/receipt.ts";
import { tradeProposalBody, tradeResponseBody } from "#yahoo/xml.ts";

const Players = Schema.Array(YahooPlayerKey).pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(
    Schema.makeFilter((players: ReadonlyArray<string>) => new Set(players).size === players.length),
  ),
);

const Picks = Schema.Array(YahooDraftPickRound).pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(
    Schema.makeFilter(
      (picks: ReadonlyArray<YahooDraftPickRound>) =>
        new Set(picks.map((pick) => pick.round)).size === picks.length,
    ),
  ),
);

const ProposeShape = Schema.Struct({
  leagueKey: YahooLeagueKey,
  traderTeamKey: YahooTeamKey,
  tradeeTeamKey: YahooTeamKey,
  send: Schema.optional(Players),
  receive: Schema.optional(Players),
  sendPicks: Schema.optional(Picks),
  receivePicks: Schema.optional(Picks),
  note: Schema.optional(Schema.String),
});

export const ProposeRequest = ProposeShape.pipe(
  Schema.check(
    Schema.makeFilter((input: typeof ProposeShape.Type) => {
      const send = input.send ?? [];
      const receive = input.receive ?? [];
      const sendPicks = input.sendPicks ?? [];
      const receivePicks = input.receivePicks ?? [];
      return (
        leagueKeyOfTeam(input.traderTeamKey) === input.leagueKey &&
        leagueKeyOfTeam(input.tradeeTeamKey) === input.leagueKey &&
        input.traderTeamKey !== input.tradeeTeamKey &&
        send.length + receive.length + sendPicks.length + receivePicks.length > 0
      );
    }),
  ),
);
export type ProposeRequest = typeof ProposeRequest.Type;

export type ProposeResponse = TradeReceipt;

export const propose: API.OperationMethod<
  ProposeRequest,
  ProposeResponse,
  YahooWriteError,
  API.YahooOpContext
> = API.makeWrite({
  name: "propose_trade",
  input: ProposeRequest,
  output: TradeReceipt,
  request: (input) => ({
    host: "write",
    method: "POST",
    path: `/fantasy/v2/league/${input.leagueKey}/transactions`,
    body: tradeProposalBody({
      traderTeamKey: input.traderTeamKey,
      tradeeTeamKey: input.tradeeTeamKey,
      send: input.send ?? [],
      receive: input.receive ?? [],
      sendPicks: input.sendPicks ?? [],
      receivePicks: input.receivePicks ?? [],
      note: input.note ?? "",
    }),
  }),
  decode: (payload) => tradeReceipt(payload, "propose_trade"),
});

function tradeReceipt(
  payload: unknown,
  operation: string,
): Effect.Effect<TradeReceipt, YahooWriteUnknown> {
  const key = findPendingTradeKey(payload);
  return key === undefined || !Schema.is(YahooTransactionKey)(key)
    ? Effect.fail(new YahooWriteUnknown({ operation }))
    : Effect.succeed({ status: "accepted", transactionKey: key });
}

const CounterShape = Schema.Struct({
  offer: Schema.Struct({
    transactionKey: YahooPendingTradeKey,
    proposerTeamKey: YahooTeamKey,
    receiverTeamKey: YahooTeamKey,
  }),
  send: Schema.optional(Players),
  receive: Schema.optional(Players),
  sendPicks: Schema.optional(Picks),
  receivePicks: Schema.optional(Picks),
  note: Schema.optional(Schema.String),
});

export const CounterRequest = CounterShape.pipe(
  Schema.check(
    Schema.makeFilter((input: typeof CounterShape.Type) => {
      const league = leagueKeyOfTeam(input.offer.proposerTeamKey);
      return (
        league === leagueKeyOfTeam(input.offer.receiverTeamKey) &&
        input.offer.transactionKey.startsWith(`${league}.pt.`) &&
        input.offer.proposerTeamKey !== input.offer.receiverTeamKey &&
        (input.send?.length ?? 0) +
          (input.receive?.length ?? 0) +
          (input.sendPicks?.length ?? 0) +
          (input.receivePicks?.length ?? 0) >
          0
      );
    }),
  ),
);
export type CounterRequest = typeof CounterRequest.Type;

export type CounterResponse = TradeReceipt;

export const counter: API.OperationMethod<
  CounterRequest,
  CounterResponse,
  YahooWriteError,
  API.YahooOpContext
> = API.makeWrite({
  name: "counter_trade",
  input: CounterRequest,
  output: TradeReceipt,
  request: (input) => ({
    host: "write",
    method: "POST",
    path: `/fantasy/v2/league/${leagueKeyOfTeam(input.offer.receiverTeamKey)}/transactions`,
    body: tradeProposalBody({
      traderTeamKey: input.offer.receiverTeamKey,
      tradeeTeamKey: input.offer.proposerTeamKey,
      send: input.send ?? [],
      receive: input.receive ?? [],
      sendPicks: input.sendPicks ?? [],
      receivePicks: input.receivePicks ?? [],
      note: input.note ?? "",
    }),
  }),
  decode: (payload) => tradeReceipt(payload, "counter_trade"),
});

const RespondShape = Schema.Struct({
  transactionKey: YahooPendingTradeKey,
  action: Schema.Literals(["accept", "reject"]),
  note: Schema.optional(Schema.String),
});

export const RespondRequest = RespondShape;
export type RespondRequest = typeof RespondRequest.Type;

export type RespondResponse = WriteReceipt;

export const respond: API.OperationMethod<
  RespondRequest,
  RespondResponse,
  YahooWriteError,
  API.YahooOpContext
> = API.makeWrite({
  name: "respond_trade",
  input: RespondRequest,
  output: WriteReceipt,
  request: (input) => ({
    host: "write",
    method: "PUT",
    path: `/fantasy/v2/transaction/${input.transactionKey}`,
    body: tradeResponseBody({
      transactionKey: input.transactionKey,
      action: input.action,
      note: input.note ?? "",
    }),
  }),
  decode: () => Effect.succeed({ status: "accepted" }),
});

export const WithdrawRequest = Schema.Struct({
  transactionKey: YahooTransactionKey,
});
export type WithdrawRequest = typeof WithdrawRequest.Type;

export type WithdrawResponse = WriteReceipt;

export const withdraw: API.OperationMethod<
  WithdrawRequest,
  WithdrawResponse,
  YahooWriteError,
  API.YahooOpContext
> = API.makeWrite({
  name: "withdraw_trade",
  input: WithdrawRequest,
  output: WriteReceipt,
  request: (input) => ({
    host: "write",
    method: "DELETE",
    path: `/fantasy/v2/transaction/${input.transactionKey}`,
  }),
  decode: () => Effect.succeed({ status: "accepted" }),
});
