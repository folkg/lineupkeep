import { render } from "@solidjs/web";
import { QueryClientProvider } from "@tanstack/solid-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRootRouteWithContext,
  createRouter,
  useNavigate,
} from "@tanstack/solid-router";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import type { RouterContext } from "#browser/app-shell/routerContext.ts";
import { createQueryClient } from "#browser/query/queryClient.ts";
import type { SessionRemote } from "#browser/session/sessionRemote.ts";

import { AuthPage } from "./AuthPage";
import { SignInFailure } from "./signInFailure";
import { signInQueries } from "./signInQueries";
import type { SignInRemote } from "./signInRemote";

it("describes the leagues without naming a provider", async () => {
  using _app = setupAuthPage({});

  await expect.element(page.getByText("For football and hockey fantasy leagues.")).toBeVisible();
  expect(document.body.textContent).not.toContain("Yahoo");
});

it("starts Google sign-in toward the page that asked for it", async () => {
  const started: Array<{ readonly returnTo: string; readonly errorReturnTo: string }> = [];
  using _app = setupAuthPage({
    methods: { google: true },
    continueWithGoogle: (input) => {
      started.push(input);
      return new Promise(() => undefined);
    },
  });
  const google = page.getByRole("button", { name: /Continue with Google|Opening Google/ });

  await google.click();

  await expect.element(google).toHaveTextContent("Opening Google…");
  expect(started).toEqual([
    { returnTo: "/connections", errorReturnTo: "/auth?redirect=%2Fconnections" },
  ]);
});

it("explains why Google sent the person back", async () => {
  using _app = setupAuthPage({ methods: { google: true }, googleError: "access_denied" });

  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("Google sign-in was cancelled. Try again, or get a code by email.");
});

it("explains a missing email beside the field without sending", async () => {
  const sent: Array<string> = [];
  using _app = setupAuthPage({
    sendCode: (email) => {
      sent.push(email);
      return Promise.resolve();
    },
  });

  await page.getByRole("button", { name: "Email me a code" }).click();

  await expect.element(page.getByText("Enter your email address.")).toBeVisible();
  expect(sent).toEqual([]);
});

it("emails a code and moves focus to the code field", async () => {
  const request = Promise.withResolvers<void>();
  using _app = setupAuthPage({ sendCode: () => request.promise });
  await page.getByLabelText("Email").fill("reader@example.test");
  const send = page.getByRole("button", { name: /Email me a code|Sending code/ });

  await send.click();

  await expect.element(send).toHaveTextContent("Sending code…");
  await expect.element(page.getByLabelText("Email")).toBeDisabled();
  request.resolve();
  await expect.element(page.getByRole("heading", { name: "Check your email." })).toBeVisible();
  await expect
    .element(
      page.getByText(
        /^We sent a 6-digit code to reader@example\.test\. It expires in 10 minutes\.$/,
      ),
    )
    .toBeVisible();
  await expect.element(page.getByLabelText("Code")).toHaveFocus();
  await expect
    .element(page.getByLabelText("Code"))
    .toHaveAttribute("autocomplete", "one-time-code");
  await expect.element(page.getByLabelText("Code")).toHaveAttribute("inputmode", "numeric");
});

it("keeps the email and explains a code it could not confirm sending", async () => {
  using _app = setupAuthPage({ sendCode: () => Promise.reject(new Error("Network")) });
  await page.getByLabelText("Email").fill("reader@example.test");

  await page.getByRole("button", { name: "Email me a code" }).click();

  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent(
      "We couldn't confirm the code was sent. Try again; a new code replaces the old one.",
    );
  await expect.element(page.getByLabelText("Email")).toHaveValue("reader@example.test");
});

it("explains how long to wait after too many codes", async () => {
  using _app = setupAuthPage({
    sendCode: () =>
      Promise.reject(new SignInFailure({ type: "rate_limited", retryAfterSeconds: 1500 })),
  });
  await page.getByLabelText("Email").fill("reader@example.test");

  await page.getByRole("button", { name: "Email me a code" }).click();

  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("Too many codes were requested. Try again in 25 minutes.");
});

it("says the sender cannot reach the address instead of blaming the address", async () => {
  using _app = setupAuthPage({
    sendCode: () => Promise.reject(new SignInFailure({ type: "email_not_deliverable" })),
  });
  await page.getByLabelText("Email").fill("reader@example.test");

  await page.getByRole("button", { name: "Email me a code" }).click();

  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("Sign-in email cannot reach that address yet. Try a different address.");
});

it("accepts a pasted code with spacing and signs in with its digits", async () => {
  const attempts: Array<{ readonly email: string; readonly code: string }> = [];
  using _app = setupAuthPage({
    signInWithCode: (input) => {
      attempts.push(input);
      return Promise.resolve();
    },
  });
  await requestCode("reader@example.test");

  await page.getByLabelText("Code").fill("123 456");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect.element(page.getByText("Connections", { exact: true })).toBeVisible();
  expect(attempts).toEqual([{ email: "reader@example.test", code: "123456" }]);
});

it("explains a wrong code beside the field and keeps it", async () => {
  using _app = setupAuthPage({
    signInWithCode: () => Promise.reject(new SignInFailure({ type: "code_invalid" })),
  });
  await requestCode("reader@example.test");
  await page.getByLabelText("Code").fill("000000");

  await page.getByRole("button", { name: "Sign in" }).click();

  await expect
    .element(
      page.getByText(
        "That code isn't right. Check the latest email from Lineupgrade and try again.",
      ),
    )
    .toBeVisible();
  await expect.element(page.getByLabelText("Code")).toHaveValue("000000");
  await expect.element(page.getByLabelText("Code")).toHaveAttribute("aria-invalid", "true");
});

it("explains an expired code", async () => {
  using _app = setupAuthPage({
    signInWithCode: () => Promise.reject(new SignInFailure({ type: "code_expired" })),
  });
  await requestCode("reader@example.test");
  await page.getByLabelText("Code").fill("123456");

  await page.getByRole("button", { name: "Sign in" }).click();

  await expect.element(page.getByText("That code has expired. Send a new code.")).toBeVisible();
});

it("checks the session before offering another try after an unconfirmed sign-in", async () => {
  using _app = setupAuthPage({
    signInWithCode: () => Promise.reject(new Error("Network")),
    isSignedIn: () => Promise.resolve(true),
  });
  await requestCode("reader@example.test");
  await page.getByLabelText("Code").fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect.element(page.getByRole("status")).toHaveTextContent("We couldn't confirm sign-in.");

  await page.getByRole("button", { name: "Check again" }).click();

  await expect.element(page.getByText("Connections", { exact: true })).toBeVisible();
});

it("waits before offering another code", async () => {
  using _app = setupAuthPage({});

  await requestCode("reader@example.test");

  const resend = page.getByRole("button", { name: /^Resend code in 0:(30|29)$/ });
  await expect.element(resend).toHaveAttribute("aria-disabled", "true");
});

it("returns to the email step with the address kept and focused", async () => {
  using _app = setupAuthPage({});
  await requestCode("reader@example.test");

  await page.getByRole("button", { name: "Use a different email" }).click();

  await expect.element(page.getByLabelText("Email")).toHaveValue("reader@example.test");
  await expect.element(page.getByLabelText("Email")).toHaveFocus();
});

async function requestCode(email: string): Promise<void> {
  await page.getByLabelText("Email").fill(email);
  await page.getByRole("button", { name: "Email me a code" }).click();
  await expect.element(page.getByRole("heading", { name: "Check your email." })).toBeVisible();
}

function setupAuthPage(options: AuthPageFixtureOptions): {
  [Symbol.dispose](): void;
} {
  const queryClient = createQueryClient();
  const remote: SignInRemote = {
    loadMethods: () => Promise.resolve(options.methods ?? { google: false }),
    isSignedIn: options.isSignedIn ?? (() => Promise.resolve(false)),
    sendCode: options.sendCode ?? (() => Promise.resolve()),
    signInWithCode: options.signInWithCode ?? (() => Promise.resolve()),
    continueWithGoogle:
      options.continueWithGoogle ?? (() => Promise.reject(new Error("Unexpected Google"))),
  };
  const sessionRemote: SessionRemote = {
    load: () => Promise.resolve({ status: "anonymous" }),
    signOut: () => Promise.resolve(),
  };
  const methodsQuery = signInQueries.methods(remote);
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const authRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/auth",
    loader: () => queryClient.prefetchQuery(methodsQuery),
    component: () => {
      const navigate = useNavigate();
      return (
        <AuthPage
          remote={remote}
          methodsQuery={() => methodsQuery}
          returnTo="/connections"
          googleErrorReturnTo="/auth?redirect=%2Fconnections"
          googleError={options.googleError}
          onAuthenticated={() => navigate({ to: "/connections" })}
        />
      );
    },
  });
  const connectionsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/connections",
    component: () => <p>Connections</p>,
  });
  const router = createRouter({
    context: { queryClient, sessionRemote },
    history: createMemoryHistory({ initialEntries: ["/auth"] }),
    routeTree: rootRoute.addChildren([authRoute, connectionsRoute]),
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

type AuthPageFixtureOptions = Partial<
  Pick<SignInRemote, "isSignedIn" | "sendCode" | "signInWithCode" | "continueWithGoogle">
> & {
  readonly methods?: { readonly google: boolean };
  readonly googleError?: string;
};
