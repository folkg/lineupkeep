import type { JSX } from "@solidjs/web";
import { render } from "@solidjs/web";
import {
  Link,
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRoute,
  createRootRoute,
  createRouter,
} from "@tanstack/solid-router";
import { createSignal } from "solid-js";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import { TextField } from "#browser/shared-ui/TextField.tsx";

import { UnsavedChangesScope, UnsavedNavigationGuard } from "./UnsavedChanges";
import { useUnsavedChanges } from "./useUnsavedChanges";

it("keeps entered work when navigation is cancelled and discards it only after confirmation", async () => {
  using _app = setupEditor();
  await page.getByLabelText("Work").fill("Unsubmitted work");

  await page.getByRole("link", { name: "Other page" }).click();

  await expect.element(page.getByRole("alertdialog")).toBeVisible();

  await page.getByRole("button", { name: "Keep editing" }).click();

  await expect.element(page.getByLabelText("Work")).toHaveValue("Unsubmitted work");
  await expect.element(page.getByRole("link", { name: "Other page" })).toHaveFocus();

  await page.getByRole("link", { name: "Other page" }).click();
  await page.getByRole("button", { name: "Discard and leave" }).click();

  await expect.element(page.getByRole("heading", { name: "Other page" })).toBeVisible();
});

it("allows navigation when the work is unchanged", async () => {
  using _app = setupEditor();
  await page.getByLabelText("Work").fill("Temporary work");
  await page.getByLabelText("Work").fill("");

  await page.getByRole("link", { name: "Other page" }).click();

  await expect.element(page.getByRole("heading", { name: "Other page" })).toBeVisible();
  await expect.element(page.getByRole("alertdialog")).not.toBeInTheDocument();
});

function setupEditor(): {
  [Symbol.dispose](): void;
} {
  const rootRoute = createRootRoute({ component: Outlet });
  const editor = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <UnsavedChangesScope>
        <Editor />
        <UnsavedNavigationGuard shouldBlock={() => true} />
      </UnsavedChangesScope>
    ),
  });
  const other = createRoute({
    getParentRoute: () => rootRoute,
    path: "/auth",
    component: () => <h1>Other page</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([editor, other]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => <RouterProvider router={router} />, host);
  return {
    [Symbol.dispose]() {
      dispose();
      host.remove();
    },
  };
}

function Editor(): JSX.Element {
  const [value, setValue] = createSignal("");
  useUnsavedChanges(() => value().length > 0);
  return (
    <>
      <TextField
        label="Work"
        value={value()}
        onInput={(event) => setValue(event.currentTarget.value)}
      />
      <Link to="/auth">Other page</Link>
    </>
  );
}
