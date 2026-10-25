import type { ConsentRequest } from "@lineupkeep/backend/auth/Auth";
import { queryOptions } from "@tanstack/solid-query";

import type { ConsentRemote } from "./consentRemote";

export const consentQueries = {
  request: (remote: Pick<ConsentRemote, "loadRequest">, query: string) =>
    queryOptions({
      queryKey: ["consent", "request", query] as const,
      queryFn: (): Promise<ConsentRequest> => {
        const params = new URLSearchParams(query);
        const clientId = params.get("client_id");
        const signature = params.get("sig");
        return clientId !== null && clientId !== "" && signature !== null && signature !== ""
          ? remote.loadRequest(query)
          : Promise.resolve({ status: "invalid" });
      },
    }),
};

export type ConsentRequestQuery = ReturnType<typeof consentQueries.request>;
