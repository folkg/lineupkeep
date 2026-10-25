import { createRouter } from "@tanstack/solid-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/solid-router-ssr-query";

import { createQueryClient } from "./browser/query/queryClient";
import { sessionRemote } from "./browser/session/sessionRemote";
import { routeTree } from "./routeTree.gen";

export function getRouter(): AppRouter {
  return createAppRouter();
}

function createAppRouter(): ReturnType<typeof createRouter<typeof routeTree>> {
  const queryClient = createQueryClient();

  const router = createRouter({
    context: { queryClient, sessionRemote },
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
    routeTree,
    scrollRestoration: true,
  });

  setupRouterSsrQueryIntegration({ router, queryClient });
  return router;
}

type AppRouter = ReturnType<typeof createAppRouter>;

declare module "@tanstack/solid-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
