import type { ConsentRequest } from "@lineupkeep/backend/auth/Auth";
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

import { ConsentPage } from "./ConsentPage";
import { consentQueries } from "./consentQueries";
import type { ConsentRemote } from "./consentRemote";

it("distinguishes the verified client host from its unverified declared name", async () => {
  using _app = setupConsent({ decide: () => Promise.resolve("/returned") });

  await expect.element(page.getByText("Connecting to client.test", { exact: true })).toBeVisible();
  await expect
    .element(
      page.getByText("Calls itself “A trusted brand”. Names are not verified.", { exact: true }),
    )
    .toBeVisible();
});

it("acknowledges consent immediately and returns only after confirmation", async () => {
  const decision = Promise.withResolvers<string>();
  using _app = setupConsent({ decide: () => decision.promise });
  const allow = page.getByRole("button", { name: "Allow access" });

  await allow.click();

  await expect.element(allow).toHaveTextContent("Allow access");
  await expect.element(allow).toHaveAttribute("aria-busy", "true");
  await expect.element(allow).toBeDisabled();
  await expect.element(page.getByRole("button", { name: "Deny access" })).toBeDisabled();
  await expect.element(page.getByText("Returned to the client")).not.toBeInTheDocument();
  decision.resolve("/returned");
  await expect.element(page.getByText("Returned to the client")).toBeVisible();
});

it("keeps the client and permissions visible when consent is unconfirmed", async () => {
  using _app = setupConsent({ decide: () => Promise.reject(new Error("Disconnected")) });

  await page.getByRole("button", { name: "Deny access" }).click();

  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent(
      "We couldn't confirm your decision. Return to your client and start connecting again. No access is confirmed here.",
    );
  await expect
    .element(page.getByText("https://client.test/client.json", { exact: true }))
    .toBeVisible();
  await expect
    .element(page.getByText("Read the records you own. This cannot permanently delete records."))
    .toBeVisible();
  await expect.element(page.getByText("Returned to the client")).not.toBeInTheDocument();
});

it.each(["", "client_id=", "client_id=https%3A%2F%2Fclient.test%2Fclient.json"])(
  "presents a missing authorization request as invalid: %s",
  async (query) => {
    using _app = setupConsent({ decide: () => Promise.resolve("/returned") }, query);

    await expect
      .element(page.getByRole("heading", { name: "Invalid authorization request" }))
      .toBeVisible();
    await expect
      .element(page.getByRole("button", { name: "Allow access" }))
      .not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Deny access" })).not.toBeInTheDocument();
  },
);

it("presents a rejected signed authorization request as invalid", async () => {
  using _app = setupConsent(
    { decide: () => Promise.resolve("/returned") },
    "client_id=https%3A%2F%2Fclient.test%2Fclient.json&sig=expired",
    { status: "invalid" },
  );

  await expect
    .element(page.getByRole("heading", { name: "Invalid authorization request" }))
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Allow access" })).not.toBeInTheDocument();
});

function setupConsent(
  decisionRemote: Pick<ConsentRemote, "decide">,
  query = "client_id=https%3A%2F%2Fclient.test%2Fclient.json&scope=records%3Aread&sig=test-signature",
  request: ConsentRequest = {
    status: "valid",
    client: { id: "https://client.test/client.json", name: "A trusted brand", host: "client.test" },
    scopes: [
      {
        name: "records:read",
        description: "Read the records you own. This cannot permanently delete records.",
      },
    ],
  },
): {
  [Symbol.dispose](): void;
} {
  const remote: ConsentRemote = {
    ...decisionRemote,
    currentQuery: () => query,
    loadRequest: () => Promise.resolve(request),
  };
  const requestQuery = consentQueries.request(remote, query);
  const queryClient = createQueryClient();
  const root = createRootRouteWithContext<RouterContext>()({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const consent = createRoute({
    getParentRoute: () => root,
    path: "/consent",
    component: () => (
      <ConsentPage
        query={query}
        requestQuery={() => requestQuery}
        remote={remote}
        onConfirmed={(url) => {
          void router.navigate({ href: url });
        }}
      />
    ),
  });
  const returned = createRoute({
    getParentRoute: () => root,
    path: "/returned",
    component: () => <p>Returned to the client</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([consent, returned]),
    history: createMemoryHistory({ initialEntries: ["/consent"] }),
    context: {
      queryClient,
      sessionRemote: {
        load: () => Promise.resolve({ status: "anonymous" as const }),
        signOut: () => Promise.resolve(),
      },
    },
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
