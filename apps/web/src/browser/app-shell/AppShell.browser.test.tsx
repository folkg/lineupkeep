import type { JSX } from "@solidjs/web";
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

import { AccountErasedPage } from "#browser/account/AccountErasedPage.tsx";
import { LandingPage } from "#browser/landing/LandingPage.tsx";
import { createQueryClient } from "#browser/query/queryClient.ts";
import type { SessionRemote } from "#browser/session/sessionRemote.ts";
import type { SessionView } from "#contracts/auth/authContract.ts";

import { AppShell } from "./AppShell";
import type { RouterContext } from "./routerContext";

const authenticated: SessionView = { status: "authenticated", userId: "user-1" };

const anonymous: SessionView = { status: "anonymous" };

it("shows Teams, Transactions, and Account in the navigation and links Feedback from the footer", async () => {
  using _app = setupShell({ initialEntry: "/teams", session: authenticated });

  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect.element(navigation).toBeVisible();
  expect(
    navigation
      .getByRole("link")
      .elements()
      .map((link) => link.textContent),
  ).toEqual(["Teams", "Transactions", "Account"]);
  expect(navigation.getByRole("link", { name: "Connections" }).elements()).toHaveLength(0);
  expect(navigation.getByRole("link", { name: "Feedback" }).elements()).toHaveLength(0);

  await expect
    .element(page.getByRole("contentinfo").getByRole("link", { name: "Feedback" }))
    .toHaveAttribute("href", "/feedback");
});

it("keeps the footer off the landing page", async () => {
  using _app = setupShell({ initialEntry: "/", session: anonymous });

  await expect
    .element(page.getByRole("heading", { name: "Lineupgrade sets your fantasy lineup." }))
    .toBeVisible();
  expect(page.getByRole("contentinfo").elements()).toHaveLength(0);
  expect(page.getByRole("link", { name: "Feedback", exact: true }).elements()).toHaveLength(0);
});

it("keeps the footer off the erased page", async () => {
  using _app = setupShell({ initialEntry: "/erased", session: authenticated });

  await expect.element(page.getByRole("heading", { name: "Your account is erased" })).toBeVisible();
  expect(page.getByRole("contentinfo").elements()).toHaveLength(0);
});

function setupShell(options: { readonly initialEntry: string; readonly session: SessionView }): {
  [Symbol.dispose](): void;
} {
  const queryClient = createQueryClient();
  const sessionRemote: SessionRemote = {
    load: () => Promise.resolve(options.session),
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
    component: () => <LandingPage />,
  });
  const teamsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/teams",
    component: () => <ShellPage label="Teams" />,
  });
  const erasedRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/erased",
    component: () => <AccountErasedPage />,
  });
  const router = createRouter({
    context: { queryClient, sessionRemote },
    history: createMemoryHistory({ initialEntries: [options.initialEntry] }),
    routeTree: rootRoute.addChildren([landingRoute, teamsRoute, erasedRoute]),
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

function ShellPage(props: { readonly label: string }): JSX.Element {
  return (
    <AppShell>
      <p>{props.label}</p>
    </AppShell>
  );
}
