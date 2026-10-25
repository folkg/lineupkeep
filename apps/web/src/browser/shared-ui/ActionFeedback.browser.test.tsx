import { render } from "@solidjs/web";
import { createSignal } from "solid-js";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import { ActionFeedback } from "./ActionFeedback";
import type { ActionFeedbackState } from "./ActionFeedback";

it("keeps a recovery action focused and busy on a page surface", async () => {
  const read = Promise.withResolvers<void>();
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(
    () => (
      <ActionFeedback
        feedback={{
          type: "attention",
          message: "We could not confirm the change.",
          recovery: {
            label: "Check latest",
            pendingLabel: "Checking latest…",
            onAction: () => read.promise,
          },
        }}
      />
    ),
    host,
  );
  using _app = {
    [Symbol.dispose]() {
      dispose();
      host.remove();
    },
  };

  await page.getByRole("button", { name: "Check latest" }).click();

  await expect
    .element(page.getByRole("button", { name: "Checking latest…" }), { timeout: 1000 })
    .toHaveAttribute("aria-busy", "true");
  await expect.element(page.getByRole("button", { name: "Checking latest…" })).toHaveFocus();
  await expect
    .element(page.getByRole("button", { name: "Checking latest…" }))
    .toHaveAttribute("aria-disabled", "true");

  read.resolve();

  await expect.element(page.getByRole("button", { name: "Check latest" })).toBeEnabled();
  await expect.element(page.getByRole("button", { name: "Check latest" })).toHaveFocus();
});

it("announces action status and exposes a labelled recovery control", async () => {
  let recoveries = 0;
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>({
    type: "pending",
    message: "Saving…",
  });
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => <ActionFeedback feedback={feedback()} />, host);
  using _app = {
    [Symbol.dispose]() {
      dispose();
      host.remove();
    },
  };
  await expect.element(page.getByRole("status")).toHaveTextContent("Saving…");

  setFeedback({
    type: "attention",
    message: "We could not confirm the change.",
    recovery: {
      label: "Check latest",
      pendingLabel: "Checking latest…",
      onAction: () => {
        recoveries += 1;
      },
    },
  });
  await page.getByRole("button", { name: "Check latest" }).click();

  await expect
    .element(page.getByRole("status"))
    .toHaveTextContent("We could not confirm the change.");
  expect(recoveries).toBe(1);

  setFeedback({ type: "success", message: "Changes saved." });

  await expect.element(page.getByRole("status")).toHaveTextContent("Changes saved.");
  await expect.element(page.getByRole("button", { name: "Check latest" })).not.toBeInTheDocument();
});
