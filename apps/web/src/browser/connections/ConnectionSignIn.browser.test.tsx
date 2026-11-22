import { render } from "@solidjs/web";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import type { ConnectionRemote } from "./connectionRemote";
import { ConnectionSignIn } from "./ConnectionSignIn";

const connectionId = "018f79ea-7d86-7c18-9b4a-8b4d0c9165a2";

it("starts the requested reconnect on its own page", async () => {
  await page.viewport(1440, 900);
  const inputs: Array<Parameters<ConnectionRemote["startHosted"]>[0]> = [];
  using _signIn = renderSignIn(connectionId, inputs);

  await expect
    .poll(() => inputs)
    .toEqual([{ provider: "yahoo", connectionId, viewport: "desktop" }]);
  await expect.element(page.getByText("Signing in with Google?")).toBeVisible();
});

it("starts a new connection without a connection id on a phone", async () => {
  await page.viewport(390, 844);
  const inputs: Array<Parameters<ConnectionRemote["startHosted"]>[0]> = [];
  using _signIn = renderSignIn(undefined, inputs);

  await expect.poll(() => inputs).toEqual([{ provider: "yahoo", viewport: "phone" }]);
});

it("returns to the account page on request", async () => {
  let backs = 0;
  using _signIn = renderSignIn(undefined, [], () => (backs += 1));

  await page.getByRole("button", { name: "Back to account" }).click();

  expect(backs).toBe(1);
});

function renderSignIn(
  connection: string | undefined,
  inputs: Array<Parameters<ConnectionRemote["startHosted"]>[0]>,
  onBack: () => void = () => undefined,
): { [Symbol.dispose](): void } {
  const remote: ConnectionRemote = {
    list: () => Promise.resolve([]),
    disconnect: () => Promise.reject(new Error("Unexpected disconnect")),
    startHosted: (input) => {
      inputs.push(input);
      return new Promise(() => undefined);
    },
    cancelHosted: () => Promise.reject(new Error("Unexpected cancel")),
  };
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(
    () => (
      <ConnectionSignIn
        connectionId={connection}
        onBack={onBack}
        onRefresh={() => Promise.resolve()}
        provider="yahoo"
        remote={remote}
      />
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
