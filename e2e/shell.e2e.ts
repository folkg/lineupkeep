import { expect, test } from "./support";

test("shares product identity across document metadata and home navigation", async ({ page }) => {
  await page.goto("/auth");

  await expect(page).toHaveTitle("Lineupkeep — Your lineup. Looked after.");
  const home = page.getByRole("link", { name: "Lineupkeep home", exact: true });
  await expect(home.getByText("Lineupkeep", { exact: true })).toBeVisible();
  await home.click();

  await expect(page).toHaveURL("/");
  await expect(page).toHaveTitle("Lineupkeep — Your lineup. Looked after.");
  await expect(
    page.getByRole("heading", { name: "Your lineup. Looked after.", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("This is the brand and application foundation", { exact: false }),
  ).toBeVisible();
});
