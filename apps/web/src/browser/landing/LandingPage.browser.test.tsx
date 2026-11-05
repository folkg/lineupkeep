import { render } from "@solidjs/web";
import { QueryClientProvider } from "@tanstack/solid-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/solid-router";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import type { RouterContext } from "#browser/app-shell/routerContext.ts";
import { createQueryClient } from "#browser/query/queryClient.ts";
import { sessionQueries } from "#browser/session/sessionQueries.ts";
import type { SessionRemote } from "#browser/session/sessionRemote.ts";

import { LandingPage } from "./LandingPage";

it("describes the product without naming a provider", async () => {
  using _app = setupLandingPage();

  await expect
    .element(page.getByRole("heading", { name: "Lineupgrade sets your fantasy lineup." }))
    .toBeVisible();
  await expect.element(page.getByText("Your league's lineup rules")).toBeVisible();
  expect(document.body.textContent).not.toContain("Yahoo");
});

function setupLandingPage(): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const sessionRemote: SessionRemote = {
    load: () => Promise.resolve({ status: "anonymous" }),
    signOut: () => Promise.resolve(),
  };
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const landingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    loader: () => queryClient.ensureQueryData(sessionQueries.current(sessionRemote)),
    component: LandingPage,
  });
  const authRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/auth",
    component: () => <p>Auth</p>,
  });
  const teamsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/teams",
    component: () => <p>Teams</p>,
  });
  const router = createRouter({
    context: { queryClient, sessionRemote },
    history: createMemoryHistory({ initialEntries: ["/"] }),
    routeTree: rootRoute.addChildren([landingRoute, authRoute, teamsRoute]),
  });
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => <RouterProvider router={router} />, host);

  return {
    [Symbol.dispose](): void {
      dispose();
      queryClient.clear();
      host.remove();
    },
  };
}
