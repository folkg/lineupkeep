import { Schema } from "effect";

import { expect, signUp, test } from "./support";

test("proposes a move into one team queue and submits the chosen move from the transactions page", async ({
  page,
  services,
  mcp,
}) => {
  await signUp(page);
  const discovered = Schema.decodeUnknownSync(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
      }),
    ),
  )(
    await services.exercise(
      page,
      "link the provider fake and discover teams",
      "connectYahooAndDiscoverTeams",
      {},
    ),
  );
  const football = discovered.find((team) => team.name === "Embedded Browser Team");
  const hockey = discovered.find((team) => team.name === "Hosted Hockey Team");
  expect(football, "a football team").toBeDefined();
  expect(hockey, "a hockey team").toBeDefined();
  if (football === undefined || hockey === undefined) {
    return;
  }

  const client = await mcp(["fantasy:read", "transactions:review"], page);
  const roster = await client.callTool("get_rosters", { team: football.id });
  expect(roster.isError).toBe(false);
  const players = Schema.decodeUnknownSync(
    Schema.Struct({ players: Schema.Array(Schema.Struct({ player: Schema.String })) }),
  )(roster.structuredContent).players;
  const drop = players[0]?.player;
  expect(drop, "a rostered player reference").toBeDefined();
  if (drop === undefined) {
    return;
  }

  const reason = "Open a bench spot for the incoming wing.";
  const proposed = await client.callTool("propose_transactions", {
    team: football.id,
    moves: [{ kind: "drop", drops: [drop], reason }],
  });
  expect(proposed.isError).toBe(false);
  const queued = Schema.decodeUnknownSync(
    Schema.Struct({
      team: Schema.Struct({ id: Schema.String, name: Schema.String }),
      moves: Schema.Array(
        Schema.Struct({
          move: Schema.String,
          kind: Schema.String,
          drops: Schema.Array(Schema.Struct({ name: Schema.optional(Schema.String) })),
        }),
      ),
      refused: Schema.Array(Schema.Struct({ code: Schema.String })),
    }),
  )(proposed.structuredContent);
  expect(queued.team.id).toBe(football.id);
  expect(queued.moves).toHaveLength(1);
  expect(queued.refused).toStrictEqual([]);
  expect(JSON.stringify(proposed)).not.toContain('"set":');
  expect(JSON.stringify(proposed)).not.toContain("reviewUrl");

  await page.goto("/transactions");
  await expect(page.getByRole("heading", { name: "Transactions" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  await expect(page.getByText("1 open move", { exact: true })).toBeVisible();
  await expect(page.getByText("1 move for today", { exact: true })).toBeVisible();
  await expect(page.getByText(reason, { exact: true })).toBeVisible();
  await expect(page.getByText("Embedded Browser Team", { exact: true }).first()).toBeVisible();

  const submit = page.getByRole("button", { name: "Submit today's chosen moves" });
  await expect(submit).toBeDisabled();
  await page.getByRole("button", { name: /Do it now: Drop Riverside Receiver/u }).click();
  await expect(page.getByText("Runs when you submit.", { exact: true })).toBeVisible();
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByText("Submitted 1 move.", { exact: true })).toBeVisible();
  await expect(page.getByText("Nothing for today", { exact: true }).first()).toBeVisible();

  const earlier = page.getByRole("button", { name: "Show earlier moves" });
  await expect(earlier).toHaveAttribute("aria-expanded", "false");
  await earlier.click();
  await expect(page.getByText("Ran", { exact: true })).toBeVisible();
  await expect(page.getByText("Drop Riverside Receiver", { exact: true })).toBeVisible();
  await expect(page.getByText("1 ended move", { exact: true })).toBeVisible();

  const content = await page.content();
  expect(content).not.toContain("461.p.90001");
  expect(content).not.toContain("461.l.9000.t.1");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "Submit today's moves" })).toHaveCount(0);
});

test("discards a move today and shows it under earlier moves", async ({ page, services, mcp }) => {
  await signUp(page);
  const discovered = Schema.decodeUnknownSync(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
      }),
    ),
  )(
    await services.exercise(
      page,
      "link the provider fake and discover teams",
      "connectYahooAndDiscoverTeams",
      {},
    ),
  );
  const football = discovered.find((team) => team.name === "Embedded Browser Team");
  expect(football, "a football team").toBeDefined();
  if (football === undefined) {
    return;
  }

  const client = await mcp(["fantasy:read", "transactions:review"], page);
  const roster = await client.callTool("get_rosters", { team: football.id });
  const drop = Schema.decodeUnknownSync(
    Schema.Struct({ players: Schema.Array(Schema.Struct({ player: Schema.String })) }),
  )(roster.structuredContent).players[0]?.player;
  expect(drop, "a rostered player reference").toBeDefined();
  if (drop === undefined) {
    return;
  }

  const reason = "Free the bench spot before the waiver run.";
  const proposed = await client.callTool("propose_transactions", {
    team: football.id,
    moves: [{ kind: "drop", drops: [drop], reason }],
  });
  expect(proposed.isError).toBe(false);

  await page.goto("/transactions");
  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
  const move = page.getByText("Drop Riverside Receiver", { exact: true });
  await expect(move).toBeVisible();

  const submit = page.getByRole("button", { name: "Submit today's chosen moves" });
  await expect(submit).toBeDisabled();
  await page.getByRole("button", { name: /Discard: Drop Riverside Receiver/u }).click();
  await expect(page.getByText("Discarded when you submit.", { exact: true })).toBeVisible();
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByText("Discarded 1 move.", { exact: true })).toBeVisible();
  await expect(move).toHaveCount(0);

  const earlier = page.getByRole("button", { name: "Show earlier moves" });
  await earlier.click();
  await expect(page.getByText("Discarded", { exact: true })).toBeVisible();
  await expect(page.getByText("Drop Riverside Receiver", { exact: true })).toBeVisible();
});

test("names a refused move without storing it or returning a set id", async ({
  page,
  services,
  mcp,
}) => {
  await signUp(page);
  const discovered = Schema.decodeUnknownSync(
    Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  )(
    await services.exercise(
      page,
      "link the provider fake and discover teams",
      "connectYahooAndDiscoverTeams",
      {},
    ),
  );
  const football = discovered.find((team) => team.name === "Embedded Browser Team");
  expect(football, "a football team").toBeDefined();
  if (football === undefined) {
    return;
  }

  const client = await mcp(["fantasy:read", "transactions:review"], page);
  const proposed = await client.callTool("propose_transactions", {
    team: football.id,
    moves: [{ kind: "drop", drops: ["r1.not-a-player"], reason: "Try a move that cannot run." }],
  });
  expect(proposed.isError).toBe(false);
  const body = Schema.decodeUnknownSync(
    Schema.Struct({
      moves: Schema.Array(Schema.Unknown),
      refused: Schema.Array(Schema.Struct({ code: Schema.String, detail: Schema.String })),
    }),
  )(proposed.structuredContent);
  expect(body.moves).toHaveLength(0);
  expect(body.refused).toHaveLength(1);
  expect(body.refused[0]?.code).toBe("reference_invalid");
  expect(JSON.stringify(proposed)).not.toContain('"set":');

  await page.goto("/transactions");
  await expect(page.getByText("0 open moves", { exact: true })).toBeVisible();
});

test("opens the timeline on the first visit from the team page", async ({ page, services }) => {
  await signUp(page);
  await services.exercise(
    page,
    "link the provider fake and discover teams",
    "connectYahooAndDiscoverTeams",
    {},
  );

  await page.goto("/teams");
  await page.getByRole("link", { name: "Embedded Browser Team", exact: true }).click();
  await expect(page.getByRole("link", { name: "Back to teams" })).toBeVisible();

  const release = Promise.withResolvers<void>();
  await page.route("**/_serverFn/**", async (route) => {
    await release.promise;
    await route.continue();
  });

  await page.locator("main").getByRole("link", { name: "Transactions" }).click();
  await page.waitForURL("**/transactions");
  await page.waitForTimeout(250);
  await expect(
    page
      .getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: /Transactions/u }),
  ).toBeVisible();
  await expect(page.getByText(/Something went wrong/u)).toHaveCount(0);

  release.resolve();
  await page.unrouteAll({ behavior: "wait" });

  await expect(page.getByRole("heading", { name: "Today" })).toBeVisible();
});
