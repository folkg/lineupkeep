import { randomUUID } from "node:crypto";

import { expect, signIn, signUp, test } from "./support";

test("renders Sign out in the server HTML when signed in", async ({ newUser, page }) => {
  await signUp(page);
  const serverRendered = await newUser("server-rendered owner", {
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });

  await serverRendered.goto("/");

  const navigation = serverRendered.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Sign in" })).toHaveCount(0);
});

test("renders Sign in in the server HTML when signed out", async ({ newUser }) => {
  const serverRendered = await newUser("server-rendered visitor", { javaScriptEnabled: false });

  await serverRendered.goto("/");

  const navigation = serverRendered.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});

test("returns home on sign-out and back to the account's connections on sign-in", async ({
  page,
  services,
}) => {
  const account = await signUp(page);
  await services.exercise(page, "start the owner's link", "startLinking", {
    requestId: randomUUID(),
    provider: "yahoo",
    pairingCode: "ABCD2345",
  });

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.goto("/connections");
  await expect(page).toHaveURL("/auth?redirect=%2Fconnections");
  await signIn(page, account);

  await expect(page).toHaveURL("/connections");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(1);
});
