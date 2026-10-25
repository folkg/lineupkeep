import { render } from "@solidjs/web";
import type { ComponentProps } from "solid-js";
import { Loading, createMemo, createSignal } from "solid-js";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Button } from "./Button";

it("keeps keyboard focus during pending feedback without repeating the action", async () => {
  const [pending, setPending] = createSignal(false);
  let submissions = 0;
  using _app = renderButton({
    children: "Save",
    get pending() {
      return pending();
    },
    pendingLabel: "Saving…",
    onClick: () => {
      submissions += 1;
      setPending(true);
    },
  });

  await expect
    .element(page.getByRole("button", { name: "Save", exact: true }))
    .toHaveAttribute("type", "button");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  await expect
    .element(page.getByRole("button", { name: "Saving…" }), { timeout: 1000 })
    .toHaveFocus();

  await userEvent.keyboard("{Enter}");

  expect(submissions).toBe(1);
  await expect
    .element(page.getByRole("button", { name: "Saving…" }))
    .toHaveAttribute("aria-busy", "true");

  setPending(false);

  await expect.element(page.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
  await expect.element(page.getByRole("button", { name: "Save", exact: true })).toHaveFocus();
});

it("activates the visible enabled control while a newer availability check is pending", async () => {
  const read = Promise.withResolvers<boolean>();
  const [version, setVersion] = createSignal(0);
  let submissions = 0;
  const host = document.body.appendChild(document.createElement("div"));

  let hasNewerAvailability = false;
  const dispose = render(() => {
    const availability = createMemo(() => read.promise);
    const disabled = (): boolean => {
      version();
      return hasNewerAvailability ? availability() : false;
    };
    return (
      <Loading>
        <Button
          disabled={disabled()}
          onClick={() => {
            submissions += 1;
          }}
        >
          Save
        </Button>
      </Loading>
    );
  }, host);
  using _app = {
    [Symbol.dispose]() {
      dispose();
      host.remove();
    },
  };
  await expect.element(page.getByRole("button", { name: "Save", exact: true })).toBeVisible();

  hasNewerAvailability = true;
  setVersion(1);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  expect(submissions).toBe(1);

  read.resolve(false);
});

function renderButton(props: ComponentProps<typeof Button>): {
  [Symbol.dispose](): void;
} {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => <Button {...props} />, host);

  return {
    [Symbol.dispose](): void {
      dispose();
      host.remove();
    },
  };
}
