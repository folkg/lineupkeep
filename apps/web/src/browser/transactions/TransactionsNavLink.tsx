import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { NavLink } from "#browser/shared-ui/NavLink.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";

import type { TransactionRemote } from "./transactionRemote";
import { useTransactionsNav } from "./useTransactionsNav";

export function TransactionsNavLink(props: TransactionsNavLinkProps): JSX.Element {
  const open = useTransactionsNav(() => props.remote);

  return (
    <NavLink to="/transactions">
      Transactions
      <Show when={open.count() > 0}>
        <Text as="span" size="caption" tone="faint" numeric>
          {" "}
          {String(open.count())}
        </Text>
        <Text as="span" size="caption" srOnly>
          {" "}
          open moves
        </Text>
      </Show>
    </NavLink>
  );
}

type TransactionsNavLinkProps = {
  readonly remote: Pick<TransactionRemote, "list">;
};
