import { randomUUID } from "node:crypto";

import { decodeProviderKey } from "@lineupkeep/backend/connections/ProviderKey";

import { expect, signUp, test } from "./support";
import { captureCheckpoint } from "./verify/capture";

test("shows a linked connection with its team count and no helper actions", async ({
  page,
  services,
}, info) => {
  await signUp(page);
  await services.exercise(
    page,
    "link the provider fake and discover teams",
    "connectYahooAndDiscoverTeams",
    { requestId: randomUUID(), pairingCode: "ABCD2345" },
  );
  await page.goto("/connections");

  await expect(page.getByText("2 teams")).toBeVisible();
  await expect(page.getByText(/Connected/).first()).toBeVisible();
  await expect(page.getByText("Use the local helper instead")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve helper" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Pair helper" })).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Pairing code" })).toHaveCount(0);
  await captureCheckpoint(page, info, "connections-identified");
});

test("shows a persisted linking connection without exposing its pairing code", async ({
  page,
  services,
}) => {
  await signUp(page);
  await services.arrange(page, "a linking connection", "startLinking", {
    requestId: randomUUID(),
    provider: decodeProviderKey("yahoo"),
    pairingCode: "ABCD2345",
  });
  await page.goto("/connections");

  await expect(page.getByText("Linking")).toBeVisible();
  await expect(page.getByText("ABCD2345")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve helper" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toHaveCount(0);
  await expect(page.getByText("Use the local helper instead")).toHaveCount(0);
});

test("keeps another person's connections invisible", async ({ page, newUser, services }) => {
  await signUp(page);
  await services.exercise(
    page,
    "link the provider fake and discover teams",
    "connectYahooAndDiscoverTeams",
    { requestId: randomUUID(), pairingCode: "ABCD2345" },
  );
  await page.goto("/connections");
  await expect(page.getByRole("listitem")).toHaveCount(1);

  const other = await newUser();
  await signUp(other);

  await expect(other.getByText("No connections yet.", { exact: true })).toBeVisible();
  await expect(other.getByRole("listitem")).toHaveCount(0);
});

test("refuses an unauthenticated helper upload with a safe error", async ({ request, baseURL }) => {
  if (baseURL === undefined) {
    throw new Error("Missing test origin");
  }

  const response = await request.post(`${baseURL}/api/linking/complete`, {
    data: {
      userCode: "ABCD2345",
      provider: decodeProviderKey("yahoo"),
      session: "T=test-session-canary; Y=test-user-canary",
    },
    headers: { origin: baseURL },
  });

  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.json()).toEqual({ error: "unauthorized" });
});
