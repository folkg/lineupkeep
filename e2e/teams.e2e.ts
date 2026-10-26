import { randomUUID } from "node:crypto";

import { expect, signUp, test } from "./support";
import { captureCheckpoint } from "./verify/capture";

test("renders the empty teams surface and links back to provider linking", async ({
  page,
}, info) => {
  await signUp(page);
  await page.goto("/teams");

  await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible();
  await expect(page.getByText("current scoring period", { exact: false })).toBeVisible();
  await expect(
    page.getByText("the scoring week in football, the fantasy day in hockey"),
  ).toBeVisible();
  await expect(page.getByText("No teams yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect Yahoo" })).toHaveAttribute(
    "href",
    "/connections",
  );
  await expect(page.getByRole("link", { name: "Teams", exact: true })).toBeVisible();
  await captureCheckpoint(page, info, "teams-empty");
});

test("enables, pauses, resumes, and disables a team through the automation controls", async ({
  page,
  services,
}) => {
  await signUp(page);
  await services.exercise(
    page,
    "link the provider fake and discover teams",
    "connectYahooAndDiscoverTeams",
    { requestId: randomUUID(), pairingCode: "ABCD2345" },
  );
  await page.goto("/teams");
  const row = page.getByRole("listitem").filter({ hasText: "Embedded Browser Team" });

  await expect(row.getByText("Automation off")).toBeVisible();
  await row.getByRole("button", { name: "Enable automation" }).click();
  await expect(row.getByText("Automation on")).toBeVisible();
  await row.getByRole("button", { name: "Pause for rest of fantasy day" }).click();
  await expect(row.getByText("Paused for the rest of this fantasy day")).toBeVisible();
  await row.getByRole("button", { name: "Resume automation" }).click();
  await expect(row.getByText("Automation on")).toBeVisible();
  await row.getByRole("button", { name: "Disable" }).click();
  await expect(row.getByText("Automation off")).toBeVisible();
});

test("renders the teams surface before client scripts and hydrates its navigation", async ({
  page,
}) => {
  await signUp(page);
  const hydrationWarnings: string[] = [];
  page.on("console", (message) => {
    if (/hydration|unclaimed/i.test(message.text())) {
      hydrationWarnings.push(message.text());
    }
  });
  const scripts = Promise.withResolvers<void>();
  await page.route("**/*.js", async (route) => {
    await scripts.promise;
    await route.continue();
  });

  try {
    await page.goto("/teams", { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible();
    await expect(page.getByText("No teams yet.", { exact: true })).toBeVisible();
  } finally {
    scripts.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }

  await expect(page.getByRole("link", { name: "Teams", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Connect Yahoo" }).click();
  await expect(page).toHaveURL("/connections");
  expect(hydrationWarnings).toEqual([]);
});

for (const viewport of [
  { width: 390, height: 844 },
  { width: 375, height: 667 },
]) {
  test(`keeps the teams heading and empty action on a ${viewport.width}×${viewport.height} phone`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await signUp(page);
    await page.goto("/teams");

    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { name: "Teams", exact: true })).toBeInViewport({
      ratio: 1,
    });
    await expect(main.getByRole("link", { name: "Connect Yahoo" })).toBeInViewport({
      ratio: 1,
    });
  });
}
