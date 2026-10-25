import { expect, test } from "./support";

test("shares product identity across document metadata and home navigation", async ({ page }) => {
  await page.goto("/auth");

  await expect(page).toHaveTitle("Sourdough Starter — notes in reach");
  const home = page.getByRole("link", { name: "Sourdough Starter home", exact: true });
  await expect(home.getByText("Sourdough Starter", { exact: true })).toBeVisible();
  await home.click();

  await expect(page).toHaveURL("/");
  await expect(page).toHaveTitle("Sourdough Starter — notes in reach");
});
