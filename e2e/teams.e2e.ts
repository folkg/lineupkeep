import { randomUUID } from "node:crypto";

import { Schema } from "effect";

import { expect, signUp, test } from "./support";
import { captureCheckpoint } from "./verify/capture";

test("renders the empty teams surface and links back to provider linking", async ({
  page,
}, info) => {
  await signUp(page);
  await page.goto("/teams");

  await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible();
  await expect(page.getByText("Choose which teams Lineupkeep manages.")).toBeVisible();
  await expect(page.getByText("You can turn lineup checks on or off for each team")).toBeVisible();
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
    {},
  );
  await page.goto("/teams");
  const row = page.getByRole("listitem").filter({ hasText: "Embedded Browser Team" });
  const toggle = row.getByRole("switch", { name: "Lineup checks for Embedded Browser Team" });

  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(toggle).not.toHaveAttribute("aria-busy");

  await row.getByRole("button", { name: "Pause for the rest of the fantasy day" }).click();
  await expect(row.getByText(/^Paused for the rest of the fantasy day\./u)).toBeVisible();
  await expect(row.getByRole("button", { name: "Resume lineup checks" })).toBeVisible();

  await row.getByRole("button", { name: "Resume lineup checks" }).click();
  await expect(row.getByText(/^Paused for the rest of the fantasy day\./u)).toHaveCount(0);
  await expect(toggle).toHaveAttribute("aria-checked", "true");

  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await expect(
    row.getByRole("button", { name: "Pause for the rest of the fantasy day" }),
  ).toHaveCount(0);
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
  await page.getByRole("link", { name: "Embedded Browser Team" }).click();
  const teamId = new URL(page.url()).pathname.split("/").at(-1);
  expect(teamId, "the team page names its team").toBeTruthy();
  if (teamId === undefined) {
    return;
  }

  await test.step("Baseline: the team page shows the roster counts the provider published", async () => {
    await expect(page.getByText("37 adds and 3 drops today")).toBeVisible();
    await expect(
      page.getByText(
        "Trends not published. The provider published no add and drop counts for this player.",
      ),
    ).toBeVisible();
  });

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
    const client = await mcp(["fantasy:read lineups:write"], page);
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

test("reports a refused team as unreadable and re-checks it without pretending it works", async ({
  page,
  services,
  mcp,
}) => {
  await signUp(page);
  await services.exercise(
    page,
    "link a provider session whose league reads the provider refuses",
    "connectRefusedYahooAndDiscoverTeams",
    {},
  );

  await test.step("Baseline: [owner] sees the provider's own refusal in place of a healthy team", async () => {
    await page.goto("/teams");
    const row = page.getByRole("listitem").filter({ hasText: "Embedded Browser Team" });
    await expect(row.getByText("Lineupkeep cannot read this team.")).toBeVisible();
    await expect(
      row.getByText("You are not allowed to view this page because you are not in this league."),
    ).toBeVisible();
    await expect(row.getByText(/Seen once\./u)).toBeVisible();
    await expect(row.getByText(/Lineup checks skip it until it can be read\.$/u)).toBeVisible();
  });

  await page.getByRole("link", { name: "Embedded Browser Team" }).click();
  const teamId = new URL(page.url()).pathname.split("/").at(-1);
  expect(teamId, "the team page names its team").toBeTruthy();
  if (teamId === undefined) {
    return;
  }

  await test.step("Baseline: the team page keeps the roster behind the same honest state", async () => {
    await expect(
      page.getByRole("heading", { level: 1, name: "Embedded Browser Team" }),
    ).toBeVisible();
    await expect(page.getByText("Lineupkeep cannot read this team.")).toBeVisible();
    await expect(page.getByText("Roster unavailable.")).toBeVisible();
    await expect(page.getByLabel("Note for this team")).toBeVisible();
  });

  await test.step("Action: [owner] checks the team again while the provider still refuses", async () => {
    await page.getByRole("button", { name: "Check this team again" }).click();
    await expect(
      page.getByText(
        /^Checked\. Lineupkeep still cannot read this team\. You are not allowed to view this page because you are not in this league\./u,
      ),
    ).toBeVisible();
    await expect(page.getByText("Lineupkeep cannot read this team.")).toBeVisible();
    await expect(page.getByText(/Seen on 2 consecutive checks\./u)).toBeVisible();
  });

  await test.step("Result: [owner] reads the same refusal over MCP instead of an empty read", async () => {
    const client = await mcp(["fantasy:read lineups:write"], page);
    const listed = await client.callTool("list_teams", {});
    expect(listed.isError).toBe(false);
    const availability = teamAvailability(listed, teamId);
    expect(availability).toMatchObject({
      status: "unavailable",
      reason: "provider_refused",
      detail: "You are not allowed to view this page because you are not in this league.",
      consecutiveRefusals: 2,
    });
    expect(availability.observedAt).toEqual(expect.any(String));

    const lineup = await client.callTool("set_lineup", {
      requestId: randomUUID(),
      teams: [{ team: teamId, period: { coverage: "week", week: 3 } }],
    });
    expect(lineup.isError).toBe(true);
    expect(JSON.stringify(lineup)).toContain("cannot read this team");
  });
});

test("shows an unreadable team in the list on phone and desktop in light and dark", async ({
  page,
  services,
}, info) => {
  await signUp(page);
  await services.exercise(
    page,
    "link a provider session whose league reads the provider refuses",
    "connectRefusedYahooAndDiscoverTeams",
    {},
  );
  await page.goto("/teams");
  const row = page.getByRole("listitem").filter({ hasText: "Embedded Browser Team" });
  await expect(row.getByText("Lineupkeep cannot read this team.")).toBeVisible();
  await expect(
    row.getByText("You are not allowed to view this page because you are not in this league."),
  ).toBeVisible();
  await expect(row.getByRole("button", { name: "Check this team again" })).toBeVisible();

  for (const variant of availabilityShots) {
    await page.setViewportSize(variant.viewport);
    await page.emulateMedia({ colorScheme: variant.colorScheme });
    await page.reload();
    await expect(row.getByText("Lineupkeep cannot read this team.")).toBeVisible();
    await captureCheckpoint(page, info, `team-availability-${variant.name}`);
  }
});

const availabilityShots = [
  {
    name: "desktop-light",
    viewport: { width: 1280, height: 900 },
    colorScheme: "light" as const,
  },
  {
    name: "desktop-dark",
    viewport: { width: 1280, height: 900 },
    colorScheme: "dark" as const,
  },
  {
    name: "phone-light",
    viewport: { width: 390, height: 844 },
    colorScheme: "light" as const,
  },
  {
    name: "phone-dark",
    viewport: { width: 390, height: 844 },
    colorScheme: "dark" as const,
  },
];

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

const ListedTeams = Schema.Struct({
  teams: Schema.Array(
    Schema.Struct({
      team: Schema.String,
      availability: Schema.Struct({
        status: Schema.String,
        reason: Schema.optional(Schema.String),
        detail: Schema.optional(Schema.String),
        observedAt: Schema.optional(Schema.String),
        consecutiveRefusals: Schema.optional(Schema.Number),
      }),
    }),
  ),
});

function teamAvailability(
  response: { readonly structuredContent?: { readonly [x: string]: unknown } | undefined },
  team: string,
): (typeof ListedTeams.Type.teams)[number]["availability"] {
  const listed = Schema.decodeUnknownSync(ListedTeams)(response.structuredContent);
  const entry = listed.teams.find((candidate) => candidate.team === team);
  if (entry === undefined) {
    throw new Error(`list_teams did not return ${team}`);
  }
  return entry.availability;
}
