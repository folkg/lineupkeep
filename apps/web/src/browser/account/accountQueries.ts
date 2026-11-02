import { queryOptions } from "@tanstack/solid-query";

import type { AccountDataRemote } from "./accountRemote";

const statusRefreshMillis = 5_000;

export const accountQueries = {
  exportStatusKey: ["account", "export-status"] as const,
  exportStatus: (remote: Pick<AccountDataRemote, "status">) =>
    queryOptions({
      queryKey: accountQueries.exportStatusKey,
      queryFn: ({ signal }) => remote.status({ signal }),
      refetchInterval: (query) => (query.state.data?.usable === true ? false : statusRefreshMillis),
    }),
};
