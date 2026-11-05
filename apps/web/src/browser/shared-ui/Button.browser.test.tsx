import { render } from "@solidjs/web";
import type { ComponentProps } from "solid-js";
import { Loading, createMemo, createSignal } from "solid-js";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import type { ActionState } from "./actionState";
import { Button } from "./Button";

it("keeps its words, disables itself, and ignores a second press while working", async () => {
  const [state, setState] = createSignal<ActionState>("idle");
  let submissions = 0;
  using _app = renderButton({
    children: "Save",
    get state() {
      return state();
    },
    onClick: () => {
      submissions += 1;
    },
  });

  const button = page.getByRole("button", { name: "Save", exact: true });
  const idle = button.element().getBoundingClientRect();
  await button.click();
  setState("working");

  await expect.element(button).toHaveAttribute("aria-busy", "true");
  await expect.element(button).toHaveAttribute("disabled");
  await expect.element(button).toBeDisabled();
  expect(button.element().textContent).toBe("Save");

  const working = button.element().getBoundingClientRect();
  expect(working.width).toBe(idle.width);
  expect(working.height).toBe(idle.height);

  const control = button.element();
  if (control instanceof HTMLButtonElement) {
    control.click();
  }
  expect(submissions).toBe(1);

  setState("idle");
  await expect.element(button).toBeEnabled();
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
