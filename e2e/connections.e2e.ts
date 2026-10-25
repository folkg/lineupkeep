import { randomUUID } from "node:crypto";

import { expect, recordServerRequests, signUp, test } from "./support";
import { captureCheckpoint } from "./verify/capture";

const singleFlightWrite = ["POST server function single-flight"];

test("starts a link with one single-flight request and keeps the confirmation", async ({
  page,
}, info) => {
  await signUp(page);
  await expect(page.getByText("No connections yet.", { exact: true })).toBeVisible();
  const requests = recordServerRequests(page);

  const made = await requests.during(async () => {
    await page.getByRole("button", { name: "Link Yahoo" }).click();
    await expect(page.getByText("Link started.", { exact: true })).toBeVisible();
  });

  expect(made).toEqual(singleFlightWrite);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(
    page.getByRole("article").getByRole("heading", { name: "Yahoo connection", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Waiting for the local helper.", { exact: false })).toBeVisible();
  await captureCheckpoint(page, info, "link-started");

  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByText("Waiting for the local helper.", { exact: false })).toBeVisible();
});

test("renders persisted connections before client scripts and hydrates the cancel action", async ({
  page,
  services,
}, info) => {
  await signUp(page);
  await services.arrange(page, "a linking connection", "startLinking", {
    requestId: randomUUID(),
    provider: "yahoo",
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
    await expect(page.getByText("Waiting for the local helper.", { exact: false })).toBeVisible();
  } finally {
    scripts.resolve();
    await page.unrouteAll({ behavior: "wait" });
  }

  await expect(page.getByRole("button", { name: "Link Yahoo" })).toBeEnabled();
  const requests = recordServerRequests(page);
  const made = await requests.during(async () => {
    await page.getByRole("button", { name: "Cancel link" }).click();
    await expect(page.getByText("Link cancelled.", { exact: true })).toBeVisible();
  });

  expect(made).toEqual(singleFlightWrite);
  expect(hydrationWarnings).toEqual([]);
  await expect(
    page.getByText("This connection is disconnected and no longer provides access.", {
      exact: true,
    }),
  ).toBeVisible();
  await captureCheckpoint(page, info, "link-cancelled");
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
  });
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(1);

  const other = await newUser();
  await signUp(other);

  await expect(other.getByText("No connections yet.", { exact: true })).toBeVisible();
  await expect(other.getByRole("article")).toHaveCount(0);
});
