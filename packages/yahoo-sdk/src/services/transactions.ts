import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as API from "#yahoo/api.ts";
import type { YahooReadError, YahooWriteError } from "#yahoo/errors.ts";
import { decodePendingTrades, decodeTransactions } from "#yahoo/internal/transaction.ts";
import type { YahooPendingTrade, YahooTransaction } from "#yahoo/internal/transaction.ts";
import { leagueKeyOfTeam, YahooLeagueKey, YahooPlayerKey, YahooTeamKey } from "#yahoo/keys.ts";
import { WriteReceipt } from "#yahoo/receipt.ts";
import { transactionBody } from "#yahoo/xml.ts";

const ListShape = Schema.Struct({
  leagueKey: YahooLeagueKey,
  teamKey: Schema.optional(YahooTeamKey),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 })),
  offset: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  type: Schema.optional(Schema.Literal("trade")),
});

export const ListRequest = ListShape.pipe(
  Schema.check(
    Schema.makeFilter(
      (input: typeof ListShape.Type) =>
        input.teamKey === undefined || leagueKeyOfTeam(input.teamKey) === input.leagueKey,
    ),
  ),
);
export type ListRequest = typeof ListRequest.Type;

export type ListResponse = ReadonlyArray<YahooTransaction>;

export const list: API.OperationMethod<
  ListRequest,
  ListResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_transactions",
  input: ListRequest,
  output: Schema.Unknown,
  request: (input) => {
    const offset = input.offset ?? 0;
    const team = input.teamKey === undefined ? "" : `;team_key=${input.teamKey}`;
    const paging = `;count=${String(input.limit)}${offset === 0 ? "" : `;start=${String(offset)}`}`;
    return {
      host: "read",
      method: "GET",
      path:
        input.type === undefined
          ? `/fantasy/v2/league/${input.leagueKey}/transactions${paging}${team}`
          : `/fantasy/v2/league/${input.leagueKey}/transactions;type=${input.type}${team}${paging}`,
    };
  },
  decode: (payload, input) =>
    decodeTransactions(payload, input.leagueKey).pipe(
      Effect.map((transactions) =>
        input.type === undefined
          ? transactions
          : transactions.filter((transaction) => transaction.type === input.type),
      ),
    ),
});

const PendingTradesShape = Schema.Struct({
  leagueKey: YahooLeagueKey,
  teamKey: YahooTeamKey,
});

export const PendingTradesRequest = PendingTradesShape.pipe(
  Schema.check(
    Schema.makeFilter(
      (input: typeof PendingTradesShape.Type) => leagueKeyOfTeam(input.teamKey) === input.leagueKey,
    ),
  ),
);
export type PendingTradesRequest = typeof PendingTradesRequest.Type;

export type PendingTradesResponse = ReadonlyArray<YahooPendingTrade>;

export const pendingTrades: API.OperationMethod<
  PendingTradesRequest,
  PendingTradesResponse,
  YahooReadError,
  API.YahooOpContext
> = API.makeRead({
  name: "read_pending_trades",
  input: PendingTradesRequest,
  output: Schema.Unknown,
  request: (input) => ({
    host: "read",
    method: "GET",
    path: `/fantasy/v2/league/${input.leagueKey}/transactions;type=pending_trade;team_key=${input.teamKey}`,
  }),
  decode: (payload, input) => decodePendingTrades(payload, input.leagueKey),
});

const ApplyShape = Schema.Struct({
  leagueKey: YahooLeagueKey,
  teamKey: YahooTeamKey,
  add: Schema.optional(YahooPlayerKey),
  drop: Schema.optional(YahooPlayerKey),
  faabBid: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});

export const ApplyRequest = ApplyShape.pipe(
  Schema.check(
    Schema.makeFilter(
      (input: typeof ApplyShape.Type) =>
        leagueKeyOfTeam(input.teamKey) === input.leagueKey &&
        (input.add !== undefined || input.drop !== undefined) &&
        (input.add === undefined || input.drop === undefined || input.add !== input.drop),
    ),
  ),
);
export type ApplyRequest = typeof ApplyRequest.Type;

export type ApplyResponse = WriteReceipt;

export const apply: API.OperationMethod<
  ApplyRequest,
  ApplyResponse,
  YahooWriteError,
  API.YahooOpContext
> = API.makeWrite({
  name: "apply_transaction",
  input: ApplyRequest,
  output: WriteReceipt,
  request: (input) => ({
    host: "write",
    method: "POST",
    path: `/fantasy/v2/league/${input.leagueKey}/transactions`,
    body: transactionBody({
      teamKey: input.teamKey,
      add: input.add,
      drop: input.drop,
      faabBid: input.faabBid,
    }),
  }),
  decode: () => Effect.succeed({ status: "accepted" }),
});
