import { expect, signUp, test } from "./support";
import { captureCheckpoint } from "./verify/capture";

test("shows a linked connection on the account page with its team count", async ({
  page,
  services,
}, info) => {
  await signUp(page);
  await services.exercise(
    page,
    "link the provider fake and discover teams",
    "connectYahooAndDiscoverTeams",
    {},
  );
  await page.goto("/account");

  await expect(page.getByText("2 teams")).toBeVisible();
  await expect(page.getByText(/Connected/).first()).toBeVisible();
  await expect(
    page.getByText("Yahoo is connected. Lineup checks use this connection."),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect Yahoo" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Connections" })).toBeVisible();
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
  await page.goto("/account");
  const listed = page.getByRole("region", { name: "Connections" });
  await expect(listed.getByRole("listitem")).toHaveCount(1);

  const other = await newUser();
  await signUp(other);

  await expect(other.getByText("No connections yet.", { exact: true })).toBeVisible();
  await expect(
    other.getByRole("region", { name: "Connections" }).getByRole("listitem"),
  ).toHaveCount(0);
});
