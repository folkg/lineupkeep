import * as Schema from "effect/Schema";

import { YahooTransactionKey } from "./keys.ts";

export const WriteReceipt = Schema.Struct({
  status: Schema.Literal("accepted"),
});
export type WriteReceipt = typeof WriteReceipt.Type;

export const TradeReceipt = Schema.Struct({
  status: Schema.Literal("accepted"),
  transactionKey: YahooTransactionKey,
});
export type TradeReceipt = typeof TradeReceipt.Type;
