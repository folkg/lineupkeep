import { render } from "@solidjs/web";
import { createSignal } from "solid-js";
import { expect, it } from "vitest";
import { page, userEvent } from "vitest/browser";

import { SearchField } from "./SearchField";
import type { SearchFieldStatus } from "./SearchField";

it("clears the search and returns focus to the input", async () => {
  using _app = renderSearchField();
  const input = page.getByRole("searchbox", { name: "Search connections" });
  await input.fill("meeting");

  await page.getByRole("button", { name: "Clear search" }).click();

  await expect.element(input).toHaveValue("");
  expect(document.activeElement).toBe(input.element());
});

it("clears controlled search state when Escape is pressed", async () => {
  let clears = 0;
  using _app = renderSearchField({ type: "idle" }, () => {
    clears += 1;
  });
  const input = page.getByRole("searchbox", { name: "Search connections" });
  await input.fill("meeting");

  await userEvent.keyboard("{Escape}");

  expect(clears).toBe(1);
  await expect.element(input).toHaveValue("");
  expect(document.activeElement).toBe(input.element());
  expect(page.getByRole("button", { name: "Clear search" }).elements()).toEqual([]);

  await userEvent.keyboard("next");
  await expect.element(input).toHaveValue("next");
});

it("shows pending recovery while keeping the search input available", async () => {
  const read = Promise.withResolvers<void>();
  using _app = renderSearchField({
    message: "Refresh failed.",
    type: "error",
    onRetry: () => read.promise,
  });

  const retry = page.getByRole("button", { name: "Retry search" });
  await retry.click();

  await expect.element(retry, { timeout: 1000 }).toHaveAttribute("aria-busy", "true");
  await expect.element(retry).toBeDisabled();
  await expect.element(retry).toHaveTextContent("Retry search");
  await expect.element(page.getByRole("searchbox", { name: "Search connections" })).toBeEnabled();

  read.resolve();

  await expect.element(retry).toBeEnabled();
});

it("delays loading feedback while keeping the field enabled", async () => {
  using _app = renderSearchField({ message: "Searching connections…", type: "loading" });
  const input = page.getByRole("searchbox", { name: "Search connections" });
  const status = page.getByRole("status");

  expect(status.element().textContent).toBe("");
  await expect.element(input).toBeEnabled();
  await expect.element(status).toHaveTextContent("Searching connections…");
});

function renderSearchField(
  status: SearchFieldStatus = { type: "idle" },
  onClear?: () => void,
): {
  [Symbol.dispose](): void;
} {
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => {
    const [value, setValue] = createSignal("");
    return (
      <SearchField
        ariaLabel="Search connections"
        status={status}
        value={value()}
        onClear={() => {
          setValue("");
          onClear?.();
        }}
        onSubmit={() => undefined}
        onValueChange={setValue}
      />
    );
  }, host);

  return {
    [Symbol.dispose](): void {
      dispose();
      host.remove();
    },
  };
}
