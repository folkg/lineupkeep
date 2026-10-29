import { render } from "@solidjs/web";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import type { StartHostedLinkingView } from "#contracts/connections/connectionContract.ts";

import { HostedBrowserPanel } from "./HostedBrowserPanel";
import type { HostedLinkingController } from "./useHostedLinking";

const startsAt = new Date(Date.now() - 60_000).toISOString();
const expiresAt = new Date(Date.now() + 4 * 60_000).toISOString();

it("names the private session, explains the Google workaround, and frames the phone viewport", async () => {
  using _panel = renderPanel("phone");

  await expect
    .element(page.getByText("Private to this session. Closes when you finish or cancel."))
    .toBeVisible();
  await expect.element(page.getByText(/Signing in with Google\?/)).toBeVisible();

  const workaround = page.getByText(/Add a phone number to your Yahoo account/);
  await expect.element(workaround).not.toBeVisible();
  await page.getByText("Add a phone number to sign in").click();
  await expect.element(workaround).toBeVisible();

  const surface = page.getByRole("textbox", { name: "Yahoo sign-in browser" }).element();
  const frame = surface.parentElement;
  if (frame === null) {
    throw new Error("The browser frame did not render");
  }
  const bounds = frame.getBoundingClientRect();
  expect(bounds.width / bounds.height).toBeCloseTo(390 / 844, 2);
});

function renderPanel(viewport: "phone" | "desktop"): { [Symbol.dispose](): void } {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => <HostedBrowserPanel controller={controller(viewport)} />, host);

  return {
    [Symbol.dispose](): void {
      dispose();
      host.remove();
    },
  };
}

function controller(viewport: "phone" | "desktop"): HostedLinkingController {
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
    session: () => view,
    frameUrl: () => undefined,
    status: () => "waiting",
    failure: () => undefined,
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
