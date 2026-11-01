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
      set: Schema.Struct({ id: Schema.String, expired: Schema.Boolean }),
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
  await expect(page.getByRole("button", { name: "Submit 1 move" })).not.toHaveAttribute(
    "aria-disabled",
  );
  await expect(
    page.getByText(/One provider request per move, sent in this order, with no retries./u),
  ).toBeVisible();

  await page.getByRole("button", { name: "Submit 1 move" }).click();

  await expect(page.getByRole("heading", { name: "Submitted" })).toBeVisible();
  await expect(page.getByText("1 executed.")).toBeVisible();
  await expect(page.getByText("Submitted by you", { exact: false })).toBeVisible();
  await expect(page.getByText("Executed", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Drop Riverside Receiver", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Submit/u })).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByText(/cannot be submitted again/u)).toBeVisible();

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
  await page.getByRole("button", { name: "Switch to dark theme" }).click();
  await page.screenshot({
    path: ".artifacts/transactions-review/e2e-result-390-dark.png",
  });
});
