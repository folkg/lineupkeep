import { render } from "@solidjs/web";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import { ThemeToggle } from "./ThemeToggle";

const themeStorageKey = "theme-preference";

it("reads a stored preference when mounted", async () => {
  using _app = renderThemeToggle("dark");

  await expect.element(page.getByRole("button", { name: "Switch to light theme" })).toBeVisible();
});

it("toggles dark mode and persists the preference", async () => {
  using _app = renderThemeToggle();
  const toggle = page.getByRole("button", { name: "Switch to dark theme" });

  await toggle.click();

  expect(document.documentElement.classList.contains("dark")).toBe(true);
  expect(localStorage.getItem(themeStorageKey)).toBe("dark");

  await page.getByRole("button", { name: "Switch to light theme" }).click();

  expect(document.documentElement.classList.contains("dark")).toBe(false);
  expect(localStorage.getItem(themeStorageKey)).toBe("light");
});

function renderThemeToggle(preference?: string): Disposable {
  using resources = new DisposableStack();
  const stored = localStorage.getItem(themeStorageKey);
  const dark = document.documentElement.classList.contains("dark");
  resources.defer(() => {
    if (stored === null) {
      localStorage.removeItem(themeStorageKey);
    } else {
      localStorage.setItem(themeStorageKey, stored);
    }
    document.documentElement.classList.toggle("dark", dark);
  });
  if (preference === undefined) {
    localStorage.removeItem(themeStorageKey);
  } else {
    localStorage.setItem(themeStorageKey, preference);
  }
  document.documentElement.classList.remove("dark");
  const host = document.body.appendChild(document.createElement("div"));
  resources.defer(() => host.remove());
  resources.defer(render(() => <ThemeToggle />, host));

  return resources.move();
}
