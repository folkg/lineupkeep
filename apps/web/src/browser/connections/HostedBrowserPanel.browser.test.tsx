import { render } from "@solidjs/web";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import type { StartHostedLinkingView } from "#contracts/connections/connectionContract.ts";
import type { HostedBrowserStatus } from "#contracts/connections/hostedBrowserProtocol.ts";

import { HostedBrowserPanel } from "./HostedBrowserPanel";
import type { HostedLinkingController } from "./useHostedLinking";

const startsAt = new Date(Date.now() - 60_000).toISOString();
const expiresAt = new Date(Date.now() + 4 * 60_000).toISOString();

it("names the private session and frames the phone viewport", async () => {
  using _panel = renderPanel({ viewport: "phone" });

  await expect
    .element(page.getByText("Private to this session. Closes when you finish or cancel."))
    .toBeVisible();

  const surface = page.getByRole("textbox", { name: "Yahoo sign-in browser" }).element();
  const frame = surface.parentElement;
  if (frame === null) {
    throw new Error("The browser frame did not render");
  }
  const bounds = frame.getBoundingClientRect();
  expect(bounds.width / bounds.height).toBeCloseTo(390 / 844, 2);
});

it("shows the phone-number workaround when the provider refuses a Gmail address", async () => {
  using _panel = renderPanel({ status: "identifier-refused" });

  await expect
    .element(page.getByText("Yahoo refuses Gmail addresses in this browser."))
    .toBeVisible();
  await expect.element(page.getByText(/If the account has a phone number/)).toBeVisible();
  await expect.element(page.getByText(/add one in Yahoo's account settings/)).toBeVisible();
  await expect.element(page.getByText(/Yahoo decides which sign-in options/)).toBeVisible();
});

it("names reading the teams after the provider accepts the sign-in", async () => {
  using _panel = renderPanel({ status: "finishing" });

  await expect.element(page.getByText("You're signed in. Reading your Yahoo teams…")).toBeVisible();
});

it("shows the connected state instead of setup when a connection already exists", async () => {
  using _panel = renderPanel({ connected: true, session: false });

  await expect.element(page.getByRole("button", { name: "Connect another account" })).toBeVisible();
  await expect
    .element(page.getByText("Yahoo is connected. Lineup checks use this connection."))
    .not.toBeInTheDocument();
  await expect
    .element(
      page.getByText(
        "Sign in as you normally would, in a browser that belongs to this sign-in only.",
      ),
    )
    .not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Connect Yahoo" })).not.toBeInTheDocument();
});

it("names a failed link and offers a retry", async () => {
  using _panel = renderPanel({
    connected: false,
    failure: {
      type: "attention",
      message:
        "Yahoo did not accept the sign-in. Try again, or use a different sign-in method in the browser.",
    },
    session: false,
  });

  await expect.element(page.getByText(/Yahoo did not accept the sign-in/)).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Try again" })).toBeVisible();
});

it("offers the connect action when no connection exists", async () => {
  using _panel = renderPanel({ connected: false, session: false });

  await expect
    .element(
      page.getByText(
        "Sign in as you normally would, in a browser that belongs to this sign-in only.",
      ),
    )
    .toBeVisible();
  await expect.element(page.getByRole("button", { name: "Connect Yahoo" })).toBeVisible();
});

function renderPanel(
  options: {
    readonly connected?: boolean;
    readonly failure?: ActionFeedbackState;
    readonly session?: boolean;
    readonly status?: HostedBrowserStatus;
    readonly viewport?: "phone" | "desktop";
  } = {},
): { [Symbol.dispose](): void } {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(
    () => (
      <HostedBrowserPanel connected={options.connected ?? false} controller={controller(options)} />
    ),
    host,
  );

  return {
    [Symbol.dispose](): void {
      dispose();
      host.remove();
    },
  };
}

function controller(options: {
  readonly failure?: ActionFeedbackState;
  readonly session?: boolean;
  readonly status?: HostedBrowserStatus;
  readonly viewport?: "phone" | "desktop";
}): HostedLinkingController {
  const viewport = options.viewport ?? "desktop";
  const view: StartHostedLinkingView = {
    session: {
      id: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2",
      provider: "yahoo",
      status: "active",
      startedAt: startsAt,
      expiresAt,
    },
    streamPath: "/api/linking/session/018f79ea-7d86-7c18-9b4a-8b4d0c9164a2/stream",
    viewport,
  };
  return {
    session: () => (options.session === false ? undefined : view),
    frameUrl: () => undefined,
    status: () => options.status ?? "waiting",
    failure: () => options.failure,
    starting: () => false,
    startingConnectionId: () => undefined,
    ready: () => false,
    viewportProfile: () => viewport,
    start: () => Promise.resolve(),
    cancel: () => undefined,
    click: () => undefined,
    sendText: () => undefined,
    sendKey: () => undefined,
    scroll: () => undefined,
  };
}
