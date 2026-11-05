import { randomUUID } from "node:crypto";

import { expect, requestCode, signIn, signUp, test } from "./support";

test("keeps sign-in controls inactive until their handlers are hydrated", async ({ page }) => {
  const scripts = Promise.withResolvers<void>();
  await page.route("**/*.js", async (route) => {
    await scripts.promise;
    await route.continue();
  });
  try {
    await page.goto("/auth", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: "Sign in or start fresh." })).toBeVisible();

    await expect(page.getByLabel("Email")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Email me a code" })).toBeDisabled();
    const email = `e2e-early-${randomUUID()}@example.com`;
    await page.getByLabel("Email").evaluate((input: HTMLInputElement, value) => {
      input.value = value;
    }, email);
    await page
      .getByRole("button", { name: "Email me a code" })
      .evaluate((button: HTMLButtonElement) => button.click());

    await expect(page).toHaveURL("/auth");
    await expect(page.getByLabel("Email")).toHaveValue(email);
  } finally {
    scripts.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }

  await expect(page.getByLabel("Email")).toBeEnabled();
  await signIn(page, { email: `e2e-hydration-${randomUUID()}@example.com` });
  await expect(page).toHaveURL("/connections");
});

test("offers no Google sign-in when it is not configured", async ({ page }) => {
  await page.goto("/auth");

  await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
  await expect(page.getByLabel("Password")).toHaveCount(0);
});

test("explains a wrong code and signs in with the right one", async ({ page }) => {
  const email = `e2e-wrong-code-${randomUUID()}@example.com`;
  await page.goto("/auth");
  const code = await requestCode(page, email);
  const wrong = code === "000000" ? "111111" : "000000";

  await page.getByLabel("Code").fill(wrong);
  await page.getByRole("main").getByRole("button", { name: "Sign in" }).click();

  await expect(
    page.getByText("That code isn't right. Check the latest email from Lineupgrade and try again."),
  ).toBeVisible();
  await page.getByLabel("Code").fill(code);
  await page.getByRole("main").getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/connections");
});

test("returns to the email step to use a different address", async ({ page }) => {
  await page.goto("/auth");
  await requestCode(page, `e2e-typo-${randomUUID()}@example.com`);

  await page.getByRole("button", { name: "Use a different email" }).click();

  await expect(page.getByLabel("Email")).toBeFocused();
  await signIn(page, { email: `e2e-corrected-${randomUUID()}@example.com` });
  await expect(page).toHaveURL("/connections");
});

test("signs in again after an ended session and returns to the page", async ({ page }) => {
  const account = await signUp(page);
  await page.goto("/teams");
  await page.context().clearCookies();
  await page.getByRole("button", { name: "Refresh teams" }).click();
  await expect(page.getByText(/^Your session has ended\./)).toBeVisible();
  await expect(page).toHaveURL("/teams");
  await page.getByRole("button", { name: "Sign in again" }).click();
  await expect(page).toHaveURL("/auth?redirect=%2Fteams");

  await signIn(page, account);

  await expect(page).toHaveURL("/teams");
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", {
      name: "Account",
      exact: true,
    }),
  ).toBeVisible();
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
]) {
  test(`shows the email step's form on a ${viewport.width}×${viewport.height} phone's first screen`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);

    await page.goto("/auth");

    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Sign in or start fresh." })).toBeInViewport({
      ratio: 1,
    });
    await expect(main.getByLabel("Email")).toBeInViewport({ ratio: 1 });
    await expect(main.getByRole("button", { name: "Email me a code" })).toBeInViewport({
      ratio: 1,
    });
  });

  test(`shows the code step's form on a ${viewport.width}×${viewport.height} phone's first screen`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/auth");

    await requestCode(page, `e2e-compact-${randomUUID()}@example.com`);
    await page.evaluate(() => window.scrollTo(0, 0));

    const main = page.getByRole("main");
    await expect(main.getByLabel("Code")).toBeInViewport({ ratio: 1 });
    await expect(main.getByRole("button", { name: "Sign in" })).toBeInViewport({ ratio: 1 });
  });
}
