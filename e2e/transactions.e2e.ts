import { Schema } from "effect";

import { expect, signUp, test } from "./support";

test("reviews and submits a proposed transaction set across the owner's teams", async ({
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

  const proposed = await client.callTool("propose_transactions", {
    items: [
      {
        team: football.id,
        kind: "drop",
        adds: [],
        drops: [drop],
        reason: "Open a bench spot for the incoming wing.",
      },
    ],
  });
  expect(proposed.isError).toBe(false);
  const review = Schema.decodeUnknownSync(
    Schema.Struct({
      reviewUrl: Schema.String,
      set: Schema.Struct({ id: Schema.String, closed: Schema.Boolean }),
    }),
  )(proposed.structuredContent);

  await page.goto(review.reviewUrl);

  await expect(page.getByRole("heading", { name: "Proposed moves" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Embedded Browser Team" })).toBeVisible();
  await expect(page.getByText("Open a bench spot for the incoming wing.")).toBeVisible();
  await expect(page.getByText("Riverside Receiver", { exact: true })).toBeVisible();
  await expect(page.getByText(/Checked against current state/u)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Teams with nothing proposed" })).toBeVisible();
  await expect(
    page.getByLabel("Teams with nothing proposed").getByText("Hosted Hockey Team", { exact: true }),
  ).toBeVisible();

  const checkbox = page.getByRole("checkbox", { name: /Drop Riverside Receiver/u });
  await expect(checkbox).toBeChecked();
  await expect(page.getByRole("button", { name: "Submit 1 move today" })).not.toHaveAttribute(
    "aria-disabled",
  );
  await expect(page.getByText(/Each move is sent once, with no retries./u)).toBeVisible();

  await page.getByRole("button", { name: "Submit 1 move today" }).click();

  await expect(page.getByRole("heading", { name: "Submitted" })).toBeVisible();
  await expect(page.getByText("1 executed.")).toBeVisible();
  await expect(page.getByText("Submitted by you", { exact: false })).toBeVisible();
  await expect(page.getByText("Executed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Drop Riverside Receiver", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Submit/u })).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(
    page.getByText(/Every move in this plan has settled or been dismissed/u),
  ).toBeVisible();

  const content = await page.content();
  expect(content).not.toContain("461.p.90001");
  expect(content).not.toContain("461.l.9000.t.1");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Submitted" })).toBeVisible();
  await expect(page.getByText("1 executed.")).toBeVisible();
  await expect(page.getByText("Drop Riverside Receiver", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Submit/u })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: ".artifacts/transactions-review/e2e-result-390-light.png",
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.getByRole("heading", { name: "Submitted" })).toBeVisible();
  await page.screenshot({
    path: ".artifacts/transactions-review/e2e-result-390-dark.png",
  });
});

test("shows one league refusal in the review page and in the MCP result", async ({
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
  const hockey = discovered.find((team) => team.name === "Hosted Hockey Team");
  expect(hockey, "a hockey team").toBeDefined();
  if (hockey === undefined) {
    return;
  }

  const client = await mcp(["fantasy:read", "transactions:review"], page);
  const roster = await client.callTool("get_rosters", { team: hockey.id });
  expect(roster.isError).toBe(false);
  const players = Schema.decodeUnknownSync(
    Schema.Struct({ players: Schema.Array(Schema.Struct({ player: Schema.String })) }),
  )(roster.structuredContent).players;
  const drop = players[0]?.player;
  expect(drop, "a rostered player reference").toBeDefined();
  if (drop === undefined) {
    return;
  }

  const proposed = await client.callTool("propose_transactions", {
    items: [
      {
        team: hockey.id,
        kind: "drop",
        adds: [],
        drops: [drop],
        reason: "Make room for the call-up.",
      },
    ],
  });
  expect(proposed.isError).toBe(false);
  const created = Schema.decodeUnknownSync(
    Schema.Struct({
      reviewUrl: Schema.String,
      set: Schema.Struct({ id: Schema.String }),
    }),
  )(proposed.structuredContent);

  await page.goto(created.reviewUrl);
  await expect(page.getByRole("button", { name: "Submit 1 move today" })).toBeVisible();
  await page.getByRole("button", { name: "Submit 1 move today" }).click();
  await expect(page.getByRole("heading", { name: "Submitted" })).toBeVisible();

  const read = await client.callTool("get_transaction_proposal_set", { set: created.set.id });
  expect(read.isError).toBe(false);
  const review = Schema.decodeUnknownSync(
    Schema.Struct({
      teams: Schema.Array(
        Schema.Struct({
          items: Schema.Array(
            Schema.Struct({
              execution: Schema.optional(
                Schema.Struct({
                  outcome: Schema.String,
                  detail: Schema.optional(Schema.String),
                }),
              ),
            }),
          ),
        }),
      ),
    }),
  )(read.structuredContent);
  const detail = review.teams
    .flatMap((team) => team.items)
    .find((item) => item.execution?.outcome === "failed")?.execution?.detail;

  if (detail === undefined) {
    throw new Error("the MCP result carries no league refusal");
  }
  expect(detail).toBe(
    "Your league rejected the transaction with HTTP 400. It said: Player Travis Konecny is in a IR position on your roster, but is no longer on the real-life IR. Please edit your lineup to activate this player from your IR and then attempt your transaction again.",
  );
  await expect(page.getByText(detail, { exact: true }).first()).toBeVisible();
  expect(await page.content()).not.toContain("without giving a reason");
});

test("lists a team's open plans and moves a dismissed one into history", async ({
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
    items: [
      {
        team: football.id,
        kind: "drop",
        adds: [],
        drops: [drop],
        reason,
      },
    ],
  });
  expect(proposed.isError).toBe(false);

  await page.goto(`/teams/${football.id}/transactions`);
  await expect(page.getByRole("heading", { name: "Open plans" })).toBeVisible();
  const move = page.getByText("Drop Riverside Receiver", { exact: true });
  await expect(move).toBeVisible();

  await page.locator("[data-dismiss-item]").first().click();
  await expect(move).toHaveCount(0);

  const history = page.locator("button[aria-expanded]");
  await expect(history).toHaveAttribute("aria-expanded", "false");
  await history.click();
  await expect(history).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Dismissed", { exact: true })).toBeVisible();
  await expect(page.getByText("Drop Riverside Receiver", { exact: true })).toBeVisible();
  await expect(page.getByText("1 closed plan", { exact: true })).toBeVisible();
});
