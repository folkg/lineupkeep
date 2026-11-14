import { useQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";

import { transactionQueries } from "./transactionQueries";
import type { TransactionRemote } from "./transactionRemote";

export function useTransactionsNav(remote: Accessor<Pick<TransactionRemote, "list">>): {
  readonly count: () => number;
} {
  const open = useQuery(() => transactionQueries.openCount(remote()));
  return { count: () => (open.isSuccess ? open.data : 0) };
}
