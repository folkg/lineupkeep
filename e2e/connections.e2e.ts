import { randomUUID } from "node:crypto";

import type { APIRequestContext } from "@playwright/test";
import { Schema } from "effect";

import { expect, recordServerRequests, signUp, test } from "./support";
import { captureCheckpoint } from "./verify/capture";

const singleFlightWrite = ["POST server function single-flight"];
const helperClientId = "https://connections-client.test/client.json";

test("pairs a helper through its device code, approves it once, and blocks redemption replay", async ({
  page,
  request,
  baseURL,
}, info) => {
  await signUp(page);
  const grant = await startHelper(request, requiredOrigin(baseURL));
  await expect(page.getByText("No connections yet.", { exact: true })).toBeVisible();
  const requests = recordServerRequests(page);

  const paired = await requests.during(async () => {
    await page.getByRole("textbox", { name: "Pairing code" }).fill(grant.user_code);
    await page.getByRole("button", { name: "Pair helper" }).click();
    await expect(page.getByText("Helper pairing started.", { exact: true })).toBeVisible();
  });

  expect(paired).toEqual(singleFlightWrite);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText(grant.user_code, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve helper" })).toBeVisible();

  const approved = await requests.during(async () => {
    await page.getByRole("button", { name: "Approve helper" }).click();
    await expect(page.getByText("Helper approved.", { exact: true })).toBeVisible();
  });

  expect(approved).toEqual(singleFlightWrite);
  await expect(page.getByText("Helper approved.", { exact: true })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
  await captureCheckpoint(page, info, "helper-approved");

  const redeemed = await redeemHelper(request, requiredOrigin(baseURL), grant.device_code);
  expect(redeemed.status()).toBe(200);
  const credentials = Schema.decodeUnknownSync(
    Schema.Struct({ access_token: Schema.String, token_type: Schema.String }),
  )(await redeemed.json());
  expect(credentials.token_type).toBe("Bearer");

  const replay = await redeemHelper(request, requiredOrigin(baseURL), grant.device_code);
  expect(replay.status()).toBe(400);
  expect(
    Schema.decodeUnknownSync(Schema.Struct({ error: Schema.String }))(await replay.json()).error,
  ).toBe("invalid_grant");
});

test("cancels a pairing request before approval and refuses the helper", async ({
  page,
  request,
  baseURL,
}) => {
  await signUp(page);
  const grant = await startHelper(request, requiredOrigin(baseURL));
  await page.getByRole("textbox", { name: "Pairing code" }).fill(grant.user_code);
  await page.getByRole("button", { name: "Pair helper" }).click();
  await expect(page.getByText("Helper pairing started.", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("Pairing cancelled.", { exact: true })).toBeVisible();
  await expect(
    page.getByText("This connection is disconnected and no longer provides access.", {
      exact: true,
    }),
  ).toBeVisible();

  const denied = await redeemHelper(request, requiredOrigin(baseURL), grant.device_code);
  expect(denied.status()).toBe(400);
  expect(
    Schema.decodeUnknownSync(Schema.Struct({ error: Schema.String }))(await denied.json()).error,
  ).toBe("access_denied");
});

test("renders a persisted pairing before client scripts and hydrates cancellation", async ({
  page,
  services,
}, info) => {
  await signUp(page);
  await services.arrange(page, "a linking connection", "startLinking", {
    requestId: randomUUID(),
    provider: "yahoo",
    pairingCode: "ABCD2345",
  });
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
    await page.goto("/connections", { waitUntil: "commit" });

    await expect(page.getByRole("article")).toHaveCount(1);
    await expect(page.getByText("ABCD2345", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve helper" })).toBeVisible();
  } finally {
    scripts.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }

  await expect(page.getByRole("button", { name: "Pair helper" })).toBeEnabled();
  const requests = recordServerRequests(page);
  const cancelled = await requests.during(async () => {
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByText("Pairing cancelled.", { exact: true })).toBeVisible();
  });

  expect(cancelled).toEqual(singleFlightWrite);
  expect(hydrationWarnings).toEqual([]);
  await captureCheckpoint(page, info, "pairing-cancelled");
  await page.reload();
  await expect(
    page.getByText("This connection is disconnected and no longer provides access.", {
      exact: true,
    }),
  ).toBeVisible();
});

test("keeps another person's connections invisible", async ({ page, newUser, services }) => {
  await signUp(page);
  await services.exercise(page, "start the owner's link", "startLinking", {
    requestId: randomUUID(),
    provider: "yahoo",
    pairingCode: "ABCD2345",
  });
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(1);

  const other = await newUser();
  await signUp(other);

  await expect(other.getByText("No connections yet.", { exact: true })).toBeVisible();
  await expect(other.getByRole("article")).toHaveCount(0);
});

function requiredOrigin(value: string | undefined): string {
  if (value === undefined) {
    throw new Error("Missing test origin");
  }
  return value;
}

async function startHelper(
  request: APIRequestContext,
  origin: string,
): Promise<{ readonly device_code: string; readonly user_code: string }> {
  const response = await request.post(`${origin}/api/auth/device/code`, {
    data: { client_id: helperClientId, scope: "connections:read" },
    headers: { origin },
  });
  expect(response.status(), await response.text()).toBe(200);
  return Schema.decodeUnknownSync(
    Schema.Struct({
      device_code: Schema.String,
      user_code: Schema.String,
      verification_uri: Schema.String,
      expires_in: Schema.Number,
      interval: Schema.Number,
    }),
  )(await response.json());
}

function redeemHelper(
  request: APIRequestContext,
  origin: string,
  deviceCode: string,
): Promise<import("@playwright/test").APIResponse> {
  return request.post(`${origin}/api/auth/oauth2/token`, {
    form: {
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      device_code: deviceCode,
      client_id: helperClientId,
    },
    headers: { origin },
  });
}
