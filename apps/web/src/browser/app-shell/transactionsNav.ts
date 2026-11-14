import type { JSX } from "@solidjs/web";
import { createContext, useContext } from "solid-js";

const TransactionsNavContext = createContext<TransactionsNav | null>(null);

export function useTransactionsNav(): TransactionsNav | null {
  return useContext(TransactionsNavContext);
}

export { TransactionsNavContext };

type TransactionsNav = {
  readonly render: () => JSX.Element;
};
