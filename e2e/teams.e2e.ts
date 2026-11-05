import { expect, signUp, test } from "./support";
import { captureCheckpoint } from "./verify/capture";

test("renders the empty teams surface and links back to provider linking", async ({
  page,
}, info) => {
  await signUp(page);
  await page.goto("/teams");

  await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible();
  await expect(
    page.getByText("Lineup checks run once an hour for each team you turn on."),
  ).toBeVisible();
  await expect(page.getByText("Pause a team when you want to take over.")).toBeVisible();
  await expect(page.getByText("No teams yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Connect an account" })).toHaveAttribute(
    "href",
    "/account",
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
    {},
  );
  await page.goto("/teams");
  await expect(page.getByText("No teams are being checked.")).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: "Embedded Browser Team" });
  const toggle = row.getByRole("switch", { name: "Lineup checks for Embedded Browser Team" });

  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("No teams are being checked.")).toHaveCount(0);
  await expect(toggle).not.toHaveAttribute("aria-busy");

  await row
    .getByRole("button", { name: "Pause lineup checks for the rest of the fantasy day" })
    .click();
  await expect(row.getByText(/^Paused for the rest of the fantasy day\./u)).toBeVisible();
  await expect(row.getByRole("button", { name: "Resume lineup checks" })).toBeVisible();

  await row.getByRole("button", { name: "Resume lineup checks" }).click();
  await expect(row.getByText(/^Paused for the rest of the fantasy day\./u)).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(
    row.getByRole("button", { name: "Pause lineup checks for the rest of the fantasy day" }),
  ).toHaveAttribute("aria-disabled", "true");
});

test("saves an owner note on the team page and reads it back over MCP", async ({
  page,
  services,
  mcp,
}) => {
  await signUp(page);
  await services.exercise(
    page,
    "link the provider fake and discover teams",
    "connectYahooAndDiscoverTeams",
    {},
  );
  await page.goto("/teams");
  await page.getByRole("link", { name: "Embedded Browser Team", exact: true }).click();
  const teamId = new URL(page.url()).pathname.split("/").at(-1);
  expect(teamId).toBeTruthy();

  await test.step("Action: [owner] writes and saves a keeper note", async () => {
    await page
      .getByLabel("Note for this team")
      .fill("Dynasty league. Keep both goalies; cost rises by five each season.");
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.getByText("Note saved.")).toBeVisible();
  });

  await test.step("Persistence: the saved note survives a reload", async () => {
    await page.reload();
    await expect(page.getByLabel("Note for this team")).toHaveValue(
      "Dynasty league. Keep both goalies; cost rises by five each season.",
    );
  });

  await test.step("Result: [owner] reads the note over MCP as owner context", async () => {
    const client = await mcp(["fantasy:read"], page);
    const summary = await client.callTool("get_team_summary", {
      team: teamId,
      groups: ["league"],
    });
    expect(summary.isError).toBe(false);
    expect(summary.structuredContent).toMatchObject({
      ownerNote: {
        status: "provided",
        text: "Dynasty league. Keep both goalies; cost rises by five each season.",
      },
    });
  });
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
  await page.getByRole("link", { name: "Connect an account" }).click();
  await expect(page).toHaveURL("/account");
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
    await expect(main.getByRole("link", { name: "Connect an account" })).toBeInViewport({
      ratio: 1,
    });
  });
}
