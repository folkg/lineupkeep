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
import type { SessionRemote } from "#browser/session/sessionRemote.ts";
import { signInSessionsQueries } from "#browser/session/signInSessionsQueries.ts";
import type { SignInSessionsRemote } from "#browser/session/signInSessionsRemote.ts";
import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import type { ConnectionView } from "#contracts/connections/connectionContract.ts";

import { connectionQueries } from "./connectionQueries";
import type { ConnectionRemote } from "./connectionRemote";
import { ConnectionsPage } from "./ConnectionsPage";

const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1_000).toISOString();
const fourMinutesFromNow = new Date(Date.now() + 4 * 60 * 1_000).toISOString();

const connected: ConnectionView = {
  id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a1",
  provider: "yahoo",
  status: "ready",
  teamCount: 3,
  approvedAt: threeDaysAgo,
  credentialGeneration: 1,
  createdAt: threeDaysAgo,
  updatedAt: threeDaysAgo,
};

const reconnectable: ConnectionView = {
  id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a2",
  provider: "yahoo",
  status: "reconnect-required",
  teamCount: 1,
  approvedAt: threeDaysAgo,
  credentialGeneration: 1,
  reconnectRequiredAt: threeDaysAgo,
  createdAt: threeDaysAgo,
  updatedAt: threeDaysAgo,
};

const linking: ConnectionView = {
  id: "018f79ea-7d86-7c18-9b4a-8b4d0c9165a3",
  provider: "yahoo",
  status: "linking",
  teamCount: 0,
  linkingExpiresAt: fourMinutesFromNow,
  createdAt: threeDaysAgo,
  updatedAt: threeDaysAgo,
};

it("shows what each connection covers and when it was connected", async () => {
  using _app = setupConnectionsPage([connected, reconnectable, linking]);

  await expect.element(page.getByText(/3 teams/)).toBeVisible();
  await expect.element(page.getByText(/1 team/)).toBeVisible();

  const time = document.querySelector<HTMLTimeElement>(`time[datetime="${threeDaysAgo}"]`);
  expect(time?.textContent).toBe(formatReaderTime(threeDaysAgo));
});

it("renders timestamps in the reader's locale with the raw value in datetime", async () => {
  using _app = setupConnectionsPage([connected, linking]);

  await expect.element(page.getByText(/This sign-in request expires/)).toBeVisible();
  const expiry = document.querySelector<HTMLTimeElement>(`time[datetime="${fourMinutesFromNow}"]`);
  expect(expiry?.getAttribute("datetime")).toBe(fourMinutesFromNow);
  expect(expiry?.textContent).toBe(formatReaderTime(fourMinutesFromNow));
});

it("describes a connected account without naming the provider in the introduction", async () => {
  using _app = setupConnectionsPage([connected]);

  await expect
    .element(
      page.getByText(
        "Lineupkeep keeps the encrypted sign-in session, not your password, and lists the teams this account can manage.",
      ),
    )
    .toBeVisible();
});

it("describes the connection step without naming the provider in the introduction", async () => {
  using _app = setupConnectionsPage([]);

  await expect
    .element(
      page.getByText(
        "Connect your fantasy account in a private browser. Lineupkeep keeps the encrypted session, not your password, and finds the teams this account can manage.",
      ),
    )
    .toBeVisible();
});

it("keeps setup out of the way when a connection is already present", async () => {
  using _app = setupConnectionsPage([connected]);

  await expect
    .element(page.getByText("Yahoo is connected. Lineup checks use this connection."))
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Connect another account" })).toBeVisible();
  await expect
    .element(
      page.getByText(
        "Sign in as you normally would, in a browser that belongs to this sign-in only.",
      ),
    )
    .not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Connect Yahoo" })).not.toBeInTheDocument();
});

it("offers the connect action when no connection exists", async () => {
  using _app = setupConnectionsPage([]);

  await expect
    .element(
      page.getByText(
        "Sign in as you normally would, in a browser that belongs to this sign-in only.",
      ),
    )
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Connect Yahoo" })).toBeVisible();
});

it("starts a hosted sign-in for a connection that needs to reconnect", async () => {
  await page.viewport(1440, 900);
  const hostedInputs: Array<Parameters<ConnectionRemote["startHosted"]>[0]> = [];
  using _app = setupConnectionsPage([connected, reconnectable], {
    startHosted: (input) => {
      hostedInputs.push(input);
      return new Promise(() => undefined);
    },
  });

  await page.getByRole("button", { name: "Reconnect" }).click();

  await expect
    .poll(() => hostedInputs)
    .toEqual([{ provider: "yahoo", connectionId: reconnectable.id, viewport: "desktop" }]);
  await expect.element(page.getByRole("button", { name: "Opening sign-in…" })).toBeVisible();
});

it("starts a phone viewport profile from a phone-sized client", async () => {
  await page.viewport(390, 844);
  const hostedInputs: Array<Parameters<ConnectionRemote["startHosted"]>[0]> = [];
  using _app = setupConnectionsPage([], {
    startHosted: (input) => {
      hostedInputs.push(input);
      return new Promise(() => undefined);
    },
  });

  await page.getByRole("button", { name: "Connect Yahoo" }).click();

  await expect.poll(() => hostedInputs).toEqual([{ provider: "yahoo", viewport: "phone" }]);
});

it("starts a desktop viewport profile from a wide client", async () => {
  await page.viewport(1440, 900);
  const hostedInputs: Array<Parameters<ConnectionRemote["startHosted"]>[0]> = [];
  using _app = setupConnectionsPage([], {
    startHosted: (input) => {
      hostedInputs.push(input);
      return new Promise(() => undefined);
    },
  });

  await page.getByRole("button", { name: "Connect Yahoo" }).click();

  await expect.poll(() => hostedInputs).toEqual([{ provider: "yahoo", viewport: "desktop" }]);
});

function setupConnectionsPage(
  connections: ReadonlyArray<ConnectionView>,
  overrides: Partial<Pick<ConnectionRemote, "startHosted">> = {},
): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const remote: ConnectionRemote = {
    list: () => Promise.resolve(connections),
    disconnect: () =>
      Promise.resolve({
        connection: connections[0] ?? connected,
        connections,
      }),
    startHosted:
      overrides.startHosted ?? (() => Promise.reject(new Error("Unexpected hosted sign-in start"))),
    cancelHosted: () => Promise.reject(new Error("Unexpected hosted sign-in cancellation")),
  };
  const connectionsQuery = connectionQueries.list(remote);
  const sessionsRemote: SignInSessionsRemote = {
    list: () => Promise.resolve({ sessions: [] }),
    end: () => Promise.reject(new Error("Unexpected session ending")),
    endOthers: () => Promise.reject(new Error("Unexpected session ending")),
  };
  const sessionsQuery = signInSessionsQueries.list(sessionsRemote);
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
  const connectionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/connections",
    component: () => (
      <ConnectionsPage
        connectionsQuery={() => connectionsQuery}
        remote={remote}
        onRefresh={() => Promise.resolve()}
        onRefreshSessions={() => Promise.resolve()}
        sessionsQuery={() => sessionsQuery}
        sessionsRemote={sessionsRemote}
      />
    ),
  });
  const teamsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/teams",
    component: () => <p>Teams</p>,
  });
  const authRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/auth",
    component: () => <p>Auth</p>,
  });
  const router = createRouter({
    context: { queryClient, sessionRemote },
    history: createMemoryHistory({ initialEntries: ["/connections"] }),
    routeTree: rootRoute.addChildren([connectionsRoute, teamsRoute, authRoute]),
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
