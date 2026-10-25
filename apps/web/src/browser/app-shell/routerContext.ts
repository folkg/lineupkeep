import type { QueryClient } from "@tanstack/solid-query";

import type { SessionRemote } from "#browser/session/sessionRemote.ts";

export type RouterContext = {
  readonly queryClient: QueryClient;
  readonly sessionRemote: SessionRemote;
};
