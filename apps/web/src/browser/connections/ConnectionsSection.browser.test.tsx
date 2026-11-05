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
import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import type {
  ConnectionChangeView,
  ConnectionView,
} from "#contracts/connections/connectionContract.ts";

import { connectionQueries } from "./connectionQueries";
import type { ConnectionRemote } from "./connectionRemote";
import { ConnectionsSection } from "./ConnectionsSection";

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
  using _section = setupConnectionsSection([connected, reconnectable, linking]);

  await expect.element(page.getByRole("heading", { name: "Connections" })).toBeVisible();
  await expect.element(page.getByText(/3 teams/)).toBeVisible();
  await expect.element(page.getByText(/1 team/)).toBeVisible();

  const time = document.querySelector<HTMLTimeElement>(`time[datetime="${threeDaysAgo}"]`);
  expect(time?.textContent).toBe(formatReaderTime(threeDaysAgo));
});

it("renders timestamps in the reader's locale with the raw value in datetime", async () => {
  using _section = setupConnectionsSection([connected, linking]);

  await expect.element(page.getByText(/This sign-in request expires/)).toBeVisible();
  const expiry = document.querySelector<HTMLTimeElement>(`time[datetime="${fourMinutesFromNow}"]`);
  expect(expiry?.getAttribute("datetime")).toBe(fourMinutesFromNow);
  expect(expiry?.textContent).toBe(formatReaderTime(fourMinutesFromNow));
});

it("explains the encrypted session without naming the provider", async () => {
  using _section = setupConnectionsSection([connected]);

  await expect
    .element(page.getByText("Lineupgrade keeps the encrypted sign-in session, not your password."))
    .toBeVisible();
});

it("keeps the removed connection explanation off the connections section", async () => {
  using _section = setupConnectionsSection([connected]);

  await expect
    .element(page.getByText("Yahoo is connected. Lineup checks use this connection."))
    .not.toBeInTheDocument();
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
  using _section = setupConnectionsSection([]);

  await expect
    .element(
      page.getByText(
        "Sign in as you normally would, in a browser that belongs to this sign-in only.",
      ),
    )
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Connect Yahoo" })).toBeVisible();
});

it("shows the hairline, disables the control, and leaves the row after the server confirms", async () => {
  const answer = Promise.withResolvers<ConnectionChangeView>();
  using _section = setupConnectionsSection([connected], {
    disconnect: () => answer.promise,
  });
  const button = page.getByRole("button", { name: "Disconnect the Yahoo connection" });
  await expect.element(button).toBeVisible();
  const idle = button.element().getBoundingClientRect();

  await button.click();

  await expect.element(button).toHaveAttribute("aria-busy", "true");
  await expect.element(button).toHaveAttribute("disabled");
  await expect.element(button).toBeDisabled();
  expect(page.getByText("Disconnecting…").elements()).toHaveLength(0);
  const working = button.element().getBoundingClientRect();
  expect(working.width).toBe(idle.width);
  expect(working.height).toBe(idle.height);

  answer.resolve({ connection: { ...connected, status: "disconnected" }, connections: [] });

  await expect.poll(() => page.getByText("Yahoo connection").elements().length).toBe(0);
  await expect
    .element(page.getByText("Disconnected. You can connect again at any time."))
    .toBeVisible();
});

it("starts a hosted sign-in for a connection that needs to reconnect", async () => {
  await page.viewport(1440, 900);
  const hostedInputs: Array<Parameters<ConnectionRemote["startHosted"]>[0]> = [];
  using _section = setupConnectionsSection([connected, reconnectable], {
    startHosted: (input) => {
      hostedInputs.push(input);
      return new Promise(() => undefined);
    },
  });

  await page.getByRole("button", { name: "Reconnect" }).click();

  await expect
    .poll(() => hostedInputs)
    .toEqual([{ provider: "yahoo", connectionId: reconnectable.id, viewport: "desktop" }]);
  const reconnect = page.getByRole("button", { name: "Reconnect" });
  await expect.element(reconnect).toHaveAttribute("aria-busy", "true");
  await expect.element(reconnect).toBeDisabled();
  await expect.element(page.getByText("Opening sign-in…")).not.toBeInTheDocument();
});

it("starts a phone viewport profile from a phone-sized client", async () => {
  await page.viewport(390, 844);
  const hostedInputs: Array<Parameters<ConnectionRemote["startHosted"]>[0]> = [];
  using _section = setupConnectionsSection([], {
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
  using _section = setupConnectionsSection([], {
    startHosted: (input) => {
      hostedInputs.push(input);
      return new Promise(() => undefined);
    },
  });

  await page.getByRole("button", { name: "Connect Yahoo" }).click();

  await expect.poll(() => hostedInputs).toEqual([{ provider: "yahoo", viewport: "desktop" }]);
});

function setupConnectionsSection(
  connections: ReadonlyArray<ConnectionView>,
  overrides: Partial<Pick<ConnectionRemote, "startHosted" | "disconnect">> = {},
): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const remote: ConnectionRemote = {
    list: () => Promise.resolve(connections),
    disconnect:
      overrides.disconnect ??
      (() =>
        Promise.resolve({
          connection: connections[0] ?? connected,
          connections,
        })),
    startHosted:
      overrides.startHosted ?? (() => Promise.reject(new Error("Unexpected hosted sign-in start"))),
    cancelHosted: () => Promise.reject(new Error("Unexpected hosted sign-in cancellation")),
  };
  const connectionsQuery = connectionQueries.list(remote);
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
  const accountRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/account",
    component: () => (
      <ConnectionsSection
        connectionsQuery={() => connectionsQuery}
        onRefresh={() => Promise.resolve()}
        remote={remote}
      />
    ),
  });
  const teamsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/teams",
    component: () => <p>Teams</p>,
  });
  const router = createRouter({
    context: { queryClient, sessionRemote },
    history: createMemoryHistory({ initialEntries: ["/account"] }),
    routeTree: rootRoute.addChildren([accountRoute, teamsRoute]),
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
