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
import { beforeEach, expect, it } from "vitest";
import { page } from "vitest/browser";

import { requireAccountErasureSuccess } from "#browser/account/accountFailure.ts";
import type { RouterContext } from "#browser/app-shell/routerContext.ts";
import { createQueryClient } from "#browser/query/queryClient.ts";
import type { SessionRemote } from "#browser/session/sessionRemote.ts";
import { accountExportPath } from "#contracts/account/accountContract.ts";
import type { AccountExportStatusView } from "#contracts/account/accountContract.ts";

import { AccountDataPage } from "./AccountDataPage";
import { AccountErasedPage } from "./AccountErasedPage";
import type { AccountDataRemote } from "./accountRemote";

const summary = {
  removed: [
    { class: "Fantasy teams", count: 2 },
    { class: "Sign-in sessions", count: 1 },
  ],
};

const exportStatus: AccountExportStatusView = {
  usable: true,
  freshForMinutes: 60,
  latest: {
    takenAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    records: 12,
    areas: [
      { label: "Fantasy teams", records: 2 },
      { label: "Lineup runs", records: 3 },
      { label: "Sign-in sessions", records: 1 },
    ],
  },
};

const noExportStatus: AccountExportStatusView = {
  usable: false,
  freshForMinutes: 60,
  latest: undefined,
};

const staleExportStatus: AccountExportStatusView = {
  usable: false,
  freshForMinutes: 60,
  latest: {
    takenAt: new Date(Date.now() - 3 * 60 * 60_000).toISOString(),
    records: 12,
    areas: [{ label: "Fantasy teams", records: 2 }],
  },
};

it("offers an export and explains what erasure cannot undo", async () => {
  using _app = setupAccountPage();

  await expect.element(page.getByRole("heading", { name: "Your data" })).toBeVisible();
  await expect.element(page.getByRole("heading", { name: "Export" })).toBeVisible();
  const copy = document.body.textContent.replace(/\s+/g, " ");
  expect(copy).toContain(
    "The file includes your account, connections, teams, lineup runs, transaction proposals, feedback, and sign-in records. Provider sessions, passwords, and agent tokens are left out, because a copy should not let anyone sign in as you.",
  );
  expect(copy).toContain(
    "This deletes everything listed above, plus every sign-in session and the grants agents hold. It happens as soon as you confirm, and it cannot be undone.",
  );
  await expect.element(page.getByLabelText("Type erase my account to confirm")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Erase my account" })).toBeVisible();

  const exportLink = page.getByRole("link", { name: "Export my data" }).elements()[0];
  expect(exportLink?.getAttribute("href")).toBe(accountExportPath);
  expect(exportLink?.hasAttribute("download")).toBe(true);

  const text = document.body.textContent;
  expect(text).not.toContain("—");
  expect(text.toLowerCase()).not.toContain("purge");
});

it("explains that erasing needs an export and hides the control", async () => {
  using _app = setupAccountPage({
    status: () => Promise.resolve(noExportStatus),
  });

  await expect.element(page.getByRole("heading", { name: "Erase your account" })).toBeVisible();
  await expect.element(page.getByText("Take an export before erasing")).toBeVisible();
  await expect.element(page.getByText(/Erasing needs an export you already hold/u)).toBeVisible();
  await expect.element(page.getByRole("link", { name: "Download an export" })).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Erase my account" }))
    .not.toBeInTheDocument();
  await expect
    .element(page.getByLabelText("Type erase my account to confirm"))
    .not.toBeInTheDocument();
});

it("explains that a stale export no longer counts and hides the control", async () => {
  using _app = setupAccountPage({
    status: () => Promise.resolve(staleExportStatus),
  });

  await expect.element(page.getByText("That export no longer counts")).toBeVisible();
  await expect.element(page.getByText(/is past its window/u)).toBeVisible();
  await expect
    .element(page.getByRole("button", { name: "Erase my account" }))
    .not.toBeInTheDocument();
});

it("names the refusal when the export was used before the erasure", async () => {
  using _app = setupAccountPage({
    erase: () =>
      Promise.resolve().then(() =>
        requireAccountErasureSuccess({
          type: "error",
          error: { type: "account.export_required" },
        }),
      ),
  });

  await page.getByLabelText("Type erase my account to confirm").fill("erase my account");
  await page.getByRole("button", { name: "Erase my account" }).click();

  await expect
    .element(page.getByText("Nothing was deleted. Take a fresh export, then erase."))
    .toBeVisible();
});

it("does nothing when the confirmation phrase does not match", async () => {
  const erasures: Array<string> = [];
  using _app = setupAccountPage({
    erase: (confirmation) => {
      erasures.push(confirmation);
      return Promise.resolve(summary);
    },
  });

  await page.getByLabelText("Type erase my account to confirm").fill("Erase my account");
  await page.getByRole("button", { name: "Erase my account" }).click();

  await expect
    .element(page.getByText("That phrase did not match. Nothing was deleted."))
    .toBeVisible();
  expect(erasures).toEqual([]);
  await expect.element(page.getByRole("heading", { name: "Your data" })).toBeVisible();
});

it("erases, ends the browser session, and lands on the page that says what happened", async () => {
  const erasures: Array<string> = [];
  let signOuts = 0;
  let clears = 0;
  const app = setupAccountPage(
    {
      erase: (confirmation) => {
        erasures.push(confirmation);
        return Promise.resolve(summary);
      },
      signOut: () => {
        signOuts += 1;
        return Promise.resolve();
      },
    },
    () => {
      clears += 1;
      return Promise.resolve();
    },
  );

  await page.getByLabelText("Type erase my account to confirm").fill("erase my account");
  await page.getByRole("button", { name: "Erase my account" }).click();

  await expect.element(page.getByRole("heading", { name: "Your account is erased" })).toBeVisible();
  await expect
    .element(
      page.getByText(
        "Lineupkeep no longer holds your account, connections, teams, runs, proposals, feedback, sign-in sessions, or agent grants. You are signed out.",
      ),
    )
    .toBeVisible();
  await expect.element(page.getByRole("link", { name: "Sign in with this address" })).toBeVisible();

  expect(erasures).toEqual(["erase my account"]);
  expect(signOuts).toBe(1);
  expect(clears).toBe(1);
  expect(app.router.state.location.pathname).toBe("/erased");
});

it("keeps the phrase and explains an unconfirmed erasure", async () => {
  using _app = setupAccountPage({
    erase: () =>
      Promise.resolve().then(() =>
        requireAccountErasureSuccess({
          type: "error",
          error: { type: "account.persistence_failed" },
        }),
      ),
  });

  await page.getByLabelText("Type erase my account to confirm").fill("erase my account");
  await page.getByRole("button", { name: "Erase my account" }).click();

  await expect
    .element(
      page.getByText(
        "We could not confirm the account was erased. Sign in again to check before trying again.",
      ),
    )
    .toBeVisible();
  expect(page.getByLabelText("Type erase my account to confirm")).toHaveDisplayValue(
    "erase my account",
  );
});

const cleanups: Array<() => void> = [];

beforeEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

function setupAccountPage(
  overrides: Partial<AccountDataRemote> = {},
  onErased: () => Promise<void> = () => Promise.resolve(),
): {
  readonly router: ReturnType<typeof createAccountRouter>;
  [Symbol.dispose](): void;
} {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
  const queryClient = createQueryClient();
  const remote: AccountDataRemote = {
    status: () => Promise.resolve(exportStatus),
    erase: () => Promise.resolve(summary),
    signOut: () => Promise.resolve(),
    ...overrides,
  };
  const sessionRemote: SessionRemote = {
    load: () => Promise.resolve({ status: "anonymous" }),
    signOut: () => Promise.resolve(),
  };
  const router = createAccountRouter(queryClient, sessionRemote, remote, onErased);
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => <RouterProvider router={router} />, host);
  let disposed = false;
  const cleanup = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    dispose();
    queryClient.clear();
    host.remove();
  };
  cleanups.push(cleanup);

  return {
    router,
    [Symbol.dispose](): void {
      cleanup();
    },
  };
}

function createAccountRouter(
  queryClient: ReturnType<typeof createQueryClient>,
  sessionRemote: SessionRemote,
  remote: AccountDataRemote,
  onErased: () => Promise<void>,
): ReturnType<typeof createRouter> {
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
    component: () => <AccountDataPage remote={remote} onErased={() => onErased()} />,
  });
  const erasedRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/erased",
    component: () => <AccountErasedPage />,
  });
  return createRouter({
    context: { queryClient, sessionRemote },
    history: createMemoryHistory({ initialEntries: ["/account"] }),
    routeTree: rootRoute.addChildren([accountRoute, erasedRoute]),
  });
}
