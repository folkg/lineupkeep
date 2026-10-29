import { expect, signUp, test } from "./support";
import { captureCheckpoint } from "./verify/capture";

test("shows a linked connection with its team count", async ({ page, services }, info) => {
  await signUp(page);
  await services.exercise(
    page,
    "link the provider fake and discover teams",
    "connectYahooAndDiscoverTeams",
    {},
  );
  await page.goto("/connections");

  await expect(page.getByText("2 teams")).toBeVisible();
  await expect(page.getByText(/Connected/).first()).toBeVisible();
  await captureCheckpoint(page, info, "connections-identified");
});

test("keeps another person's connections invisible", async ({ page, newUser, services }) => {
  await signUp(page);
  await services.exercise(
    page,
    "link the provider fake and discover teams",
    "connectYahooAndDiscoverTeams",
    {},
  );
  await page.goto("/connections");
  await expect(page.getByRole("listitem")).toHaveCount(1);

  const other = await newUser();
  await signUp(other);

  await expect(other.getByText("No connections yet.", { exact: true })).toBeVisible();
  await expect(other.getByRole("listitem")).toHaveCount(0);
});
