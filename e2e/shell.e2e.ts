import { expect, signUp, test } from "./support";

test("shares product identity across document metadata and home navigation", async ({ page }) => {
  await page.goto("/auth");

  await expect(page).toHaveTitle("Lineupkeep: fantasy lineups for Yahoo leagues");
  const home = page.getByRole("link", { name: "Lineupkeep home", exact: true });
  await expect(home.getByText("Lineupkeep", { exact: true })).toBeVisible();
  await home.click();

  await expect(page).toHaveURL("/");
  await expect(page).toHaveTitle("Lineupkeep: fantasy lineups for Yahoo leagues");
  await expect(
    page.getByRole("heading", { name: "Lineupkeep sets your fantasy lineup.", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "What Lineupkeep does" })).toBeVisible();
  await expect(
    page.getByText("Provider linking, lineup automation, and the optimizer"),
  ).toHaveCount(0);
});

test("shows no application navigation before sign-in", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Sign in to connect Yahoo", exact: true }),
  ).toHaveAttribute("href", "/auth");
  await expect(page.getByRole("link", { name: "Open your teams", exact: true })).toHaveCount(0);
});

test("returns a signed-in visitor to their teams from the landing page", async ({ page }) => {
  await signUp(page);
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation.getByRole("link", { name: "Teams", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Connections", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Feedback", exact: true })).toBeVisible();
  await expect(
    navigation.getByRole("button", { name: "Sign out this device", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Open your teams", exact: true })).toHaveAttribute(
    "href",
    "/teams",
  );
  await expect(page.getByRole("link", { name: "Sign in to connect Yahoo" })).toHaveCount(0);
  await expect(page.getByText("Open development shell")).toHaveCount(0);
});

test("keeps the signed-in navigation on its own row on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page);
  await page.goto("/");

  const navigation = page.getByRole("navigation", { name: "Primary navigation" });
  const brand = page.getByRole("link", { name: "Lineupkeep home", exact: true });
  await expect(navigation.getByRole("link", { name: "Teams", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Connections", exact: true })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Feedback", exact: true })).toBeVisible();
  await expect(
    navigation.getByRole("button", { name: "Sign out this device", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  const brandBox = await brand.boundingBox();
  const navigationBox = await navigation.boundingBox();
  expect(navigationBox?.y).toBeGreaterThan((brandBox?.y ?? 0) + (brandBox?.height ?? 0) - 1);
});
