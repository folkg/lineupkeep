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
import type { SessionView } from "#contracts/auth/authContract.ts";

import { LandingPage } from "./LandingPage";

it("describes what the product does without naming a provider", async () => {
  using _app = setupLandingPage();

  await expect
    .element(page.getByRole("heading", { name: "Lineupgrade sets your fantasy lineup." }))
    .toBeVisible();
  await expect
    .element(page.getByText("It keeps your lineup current, and your agent can help with the rest."))
    .toBeVisible();
  await expect
    .element(page.getByRole("heading", { name: "The lineup writes itself" }))
    .toBeVisible();
  await expect
    .element(page.getByRole("heading", { name: "Your agent can run your teams" }))
    .toBeVisible();
  await expect.element(page.getByRole("heading", { name: "You stay in control" })).toBeVisible();
  expect(document.body.textContent).toContain(
    "You can let a connected agent read your teams, set lineups, and propose players to add or drop, trades, and waiver claims.",
  );
  expect(document.body.textContent).not.toContain("Yahoo");
});

it("sends a signed-in visitor to their teams", async () => {
  using _app = setupLandingPage({ status: "authenticated", userId: "user-1" });

  await expect
    .element(page.getByRole("link", { name: "Open your teams", exact: true }))
    .toHaveAttribute("href", "/teams");
  expect(page.getByRole("link", { name: "Sign in to get started" }).elements()).toHaveLength(0);
});

function setupLandingPage(session: SessionView = { status: "anonymous" }): {
  [Symbol.dispose](): void;
} {
  const queryClient = createQueryClient();
  const sessionRemote: SessionRemote = {
    load: () => Promise.resolve(session),
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
