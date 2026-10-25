import { render } from "@solidjs/web";
import { action } from "solid-js";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ConfirmDialogProps } from "./ConfirmDialog";

it("confirms a destructive action through the dialog", async () => {
  let confirmed = 0;
  using _app = renderConfirmDialog({ onConfirm: () => (confirmed += 1) });
  const trigger = page.getByRole("button", { name: "Delete", exact: true });
  const triggerElement = trigger.element();
  await trigger.click();
  const dialog = page.getByRole("alertdialog");
  await expect.element(dialog).toBeVisible();
  expect(triggerElement.getAttribute("aria-haspopup")).toBe("dialog");
  expect(triggerElement.getAttribute("aria-expanded")).toBe("true");
  expect(triggerElement.getAttribute("aria-controls")).toBeTruthy();
  await expect.element(page.getByText("Delete this connection?")).toBeVisible();

  await page.getByRole("button", { name: "Delete connection" }).click();

  expect(confirmed).toBe(1);
  expect(dialog.elements().length).toBe(0);
  await expect.element(trigger).toHaveAttribute("aria-expanded", "false");
  await expect.element(trigger).toHaveFocus();
});

it("closes after confirmation while the resulting write remains pending", async () => {
  const write = Promise.withResolvers<void>();
  const settled = Promise.withResolvers<void>();
  const execute = action(function* () {
    yield write.promise;
  });
  using _app = renderConfirmDialog({
    onConfirm: () =>
      void execute()
        .catch(() => undefined)
        .then(settled.resolve),
  });
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect.element(page.getByRole("alertdialog")).toBeVisible();

  await page.getByRole("button", { name: "Delete connection", exact: true }).click();

  await expect.element(page.getByRole("alertdialog"), { timeout: 1000 }).not.toBeInTheDocument();
  await expect.element(page.getByRole("button", { name: "Delete", exact: true })).toHaveFocus();

  write.reject(new Error("write not confirmed"));
  await settled.promise;

  await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
});

it("keeps the action unconfirmed when the dialog is cancelled", async () => {
  let confirmed = 0;
  using _app = renderConfirmDialog({ onConfirm: () => (confirmed += 1) });
  const trigger = page.getByRole("button", { name: "Delete", exact: true });
  await trigger.click();
  const dialog = page.getByRole("alertdialog");
  await expect.element(dialog).toBeVisible();

  await page.getByRole("button", { name: "Keep connection" }).click();

  expect(confirmed).toBe(0);
  expect(dialog.elements().length).toBe(0);
  await expect.element(trigger).toHaveFocus();
});

it("closes through the escape key without confirming and restores focus", async () => {
  let confirmed = 0;
  using _app = renderConfirmDialog({ onConfirm: () => (confirmed += 1) });
  const trigger = page.getByRole("button", { name: "Delete", exact: true });
  await trigger.click();
  await expect.element(page.getByRole("alertdialog")).toBeVisible();

  await userEvent.keyboard("{Escape}");

  expect(confirmed).toBe(0);
  expect(page.getByRole("alertdialog").elements().length).toBe(0);
  await expect.element(trigger).toHaveFocus();
});

function renderConfirmDialog(props: Pick<ConfirmDialogProps, "onConfirm">): {
  [Symbol.dispose](): void;
} {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(
    () => (
      <ConfirmDialog
        cancelLabel="Keep connection"
        confirmLabel="Delete connection"
        description="This permanently removes the connection from your account."
        title="Delete this connection?"
        trigger={(triggerProps) => (
          <Button tone="danger" variant="quiet" {...triggerProps}>
            Delete
          </Button>
        )}
        onConfirm={props.onConfirm}
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
