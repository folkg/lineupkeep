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

import { AccountPage } from "#browser/account/AccountPage.tsx";
import type { AccountDataRemote } from "#browser/account/accountRemote.ts";
import type { RouterContext } from "#browser/app-shell/routerContext.ts";
import { createQueryClient } from "#browser/query/queryClient.ts";
import type { SessionRemote } from "#browser/session/sessionRemote.ts";
import type { AccountExportStatusView } from "#contracts/account/accountContract.ts";
import type { SignInSessionListData } from "#contracts/auth/authContract.ts";

import { signInSessionsQueries } from "./signInSessionsQueries";
import type { SignInSessionsRemote } from "./signInSessionsRemote";

const thisDevice: SignInSessionListData["sessions"][number] = {
  id: "session-laptop",
  device: "Chrome on macOS",
  startedAt: "2026-10-23T09:00:00.000Z",
  lastUsedAt: "2026-10-25T11:55:00.000Z",
  current: true,
};

const phone: SignInSessionListData["sessions"][number] = {
  id: "session-phone",
  device: "Safari on iOS",
  startedAt: "2026-10-25T08:30:00.000Z",
  lastUsedAt: "2026-10-25T11:00:00.000Z",
  current: false,
};

const tablet: SignInSessionListData["sessions"][number] = {
  id: "session-tablet",
  device: "Firefox on Windows",
  startedAt: "2026-10-24T18:00:00.000Z",
  lastUsedAt: "2026-10-24T20:00:00.000Z",
  current: false,
};

const connectionsSection = (
  <section aria-labelledby="connections-title">
    <h2 id="connections-title">Connections</h2>
  </section>
);

it("lists each session with its device, start, and last use, and marks this device", async () => {
  await page.viewport(1440, 900);
  using _app = setupSessionsPage({ sessions: [thisDevice, phone] });

  await expect.element(page.getByText("Chrome on macOS")).toBeVisible();
  await expect.element(page.getByText("Safari on iOS")).toBeVisible();
  await expect.element(page.getByText("This device")).toBeVisible();
  expect(
    page.getByRole("button", { name: "End the Chrome on macOS session" }).elements(),
  ).toHaveLength(0);
  expect(
    page.getByRole("button", { name: "End the Safari on iOS session" }).elements(),
  ).toHaveLength(1);
  await expect.element(page.getByRole("button", { name: "End all other sessions" })).toBeVisible();
  const lastUsed = document.querySelectorAll('time[datetime="2026-10-25T11:55:00.000Z"]');
  expect(lastUsed).toHaveLength(1);
});

it("offers no other-session action when this device is the only one signed in", async () => {
  using _app = setupSessionsPage({ sessions: [thisDevice] });

  await expect.element(page.getByText("This device")).toBeVisible();
  expect(page.getByRole("button", { name: "End all other sessions" }).elements()).toHaveLength(0);
  expect(
    page.getByRole("button", { name: "End the Chrome on macOS session" }).elements(),
  ).toHaveLength(0);
});

it("ends one session and confirms it without touching the others", async () => {
  const ended: Array<string> = [];
  using _app = setupSessionsPage(
    { sessions: [thisDevice, phone, tablet] },
    {
      end: (session) => {
        ended.push(session);
        return Promise.resolve({ sessions: [thisDevice, tablet] });
      },
    },
  );

  await page.getByRole("button", { name: "End the Safari on iOS session" }).click();

  await expect
    .element(page.getByText("That session ended. The device must sign in again."))
    .toBeVisible();
  expect(ended).toEqual(["session-phone"]);
  expect(page.getByText("Safari on iOS").elements()).toHaveLength(0);
  await expect.element(page.getByText("Firefox on Windows")).toBeVisible();
});

it("shows the row as ending until the server confirms it", async () => {
  let confirm: (data: SignInSessionListData) => void = () => undefined;
  const confirmed = new Promise<SignInSessionListData>((resolve) => {
    confirm = resolve;
  });
  using _app = setupSessionsPage(
    { sessions: [thisDevice, phone] },
    {
      end: () => confirmed,
    },
  );

  await page.getByRole("button", { name: "End the Safari on iOS session" }).click();

  const ending = page.getByRole("button", { name: "Ending…" });
  await expect.element(ending).toHaveAttribute("aria-busy", "true");
  confirm({ sessions: [thisDevice] });
  await expect
    .element(page.getByText("That session ended. The device must sign in again."))
    .toBeVisible();
});

it("ends every other session after the reader confirms", async () => {
  const ended: Array<void> = [];
  using _app = setupSessionsPage(
    { sessions: [thisDevice, phone, tablet] },
    {
      endOthers: () => {
        ended.push(undefined);
        return Promise.resolve({ sessions: [thisDevice] });
      },
    },
  );

  await page.getByRole("button", { name: "End all other sessions" }).click();
  await expect.element(page.getByText("End every other session?")).toBeVisible();
  await page.getByRole("button", { name: "End other sessions" }).click();

  await expect
    .element(page.getByText("Every other session ended. Those devices must sign in again."))
    .toBeVisible();
  expect(ended).toHaveLength(1);
  expect(page.getByText("Safari on iOS").elements()).toHaveLength(0);
  expect(page.getByText("Firefox on Windows").elements()).toHaveLength(0);
  await expect.element(page.getByText("Chrome on macOS")).toBeVisible();
});

it("keeps the row and explains an unconfirmed ending", async () => {
  using _app = setupSessionsPage(
    { sessions: [thisDevice, phone] },
    { end: () => Promise.reject(new Error("network down")) },
  );

  await page.getByRole("button", { name: "End the Safari on iOS session" }).click();

  await expect
    .element(
      page.getByText(
        "We could not confirm that the session ended. Refresh the list before trying again.",
      ),
    )
    .toBeVisible();
  await expect.element(page.getByText("Safari on iOS")).toBeVisible();
});

function setupSessionsPage(
  initial: SignInSessionListData,
  overrides: Partial<SignInSessionsRemote> = {},
): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const sessionsRemote: SignInSessionsRemote = {
    list: () => Promise.resolve(initial),
    end: overrides.end ?? (() => Promise.reject(new Error("Unexpected session ending"))),
    endOthers:
      overrides.endOthers ?? (() => Promise.reject(new Error("Unexpected session ending"))),
  };
  const sessionsQuery = signInSessionsQueries.list(sessionsRemote);
  const exportStatus: AccountExportStatusView = {
    usable: false,
    freshForMinutes: 60,
    latest: undefined,
  };
  const accountRemote: AccountDataRemote = {
    status: () => Promise.resolve(exportStatus),
    erase: () => Promise.reject(new Error("Unexpected erasure")),
    signOut: () => Promise.resolve(),
  };
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
      <AccountPage
        connections={connectionsSection}
        onErased={() => Promise.resolve()}
        onRefreshSessions={() => Promise.resolve()}
        remote={accountRemote}
        sessionsQuery={() => sessionsQuery}
        sessionsRemote={sessionsRemote}
      />
    ),
  });
  const router = createRouter({
    context: { queryClient, sessionRemote },
    history: createMemoryHistory({ initialEntries: ["/account"] }),
    routeTree: rootRoute.addChildren([accountRoute]),
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
