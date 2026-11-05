import { expect, signIn, signUp, test } from "./support";

test("renders the account link and no sign out in the server HTML when signed in", async ({
  newUser,
  page,
}) => {
  await signUp(page);
  const serverRendered = await newUser("server-rendered owner", {
    javaScriptEnabled: false,
    storageState: await page.context().storageState(),
  });

  await serverRendered.goto("/");

  const navigation = serverRendered.getByRole("navigation", { name: "Primary navigation" });
  await expect(navigation.getByRole("link", { name: "Account", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await expect(navigation.getByRole("link", { name: "Sign in" })).toHaveCount(0);

  await serverRendered.goto("/account");
  await expect(
    serverRendered.getByRole("button", { name: "Sign out this device", exact: true }),
  ).toBeVisible();
});

test("renders the sign-in call to action in the server HTML when signed out", async ({
  newUser,
}) => {
  const serverRendered = await newUser("server-rendered visitor", { javaScriptEnabled: false });

  await serverRendered.goto("/");

  await expect(serverRendered.getByRole("navigation", { name: "Primary navigation" })).toHaveCount(
    0,
  );
  await expect(serverRendered.getByRole("link", { name: "Sign in to get started" })).toBeVisible();
  await expect(serverRendered.getByRole("button", { name: "Sign out" })).toHaveCount(0);
});

test("returns home on sign-out and back to the account page on sign-in", async ({
  page,
  services,
}) => {
  const account = await signUp(page);
  await services.exercise(
    page,
    "link the provider fake and discover teams",
    "connectYahooAndDiscoverTeams",
    {},
  );

  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out this device", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Sign in to get started" })).toBeVisible();
  await page.goto("/account");
  await expect(page).toHaveURL("/auth?redirect=%2Faccount");
  await signIn(page, account);

  await expect(page).toHaveURL("/account");
  await expect(
    page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", {
      name: "Account",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Connections" }).getByRole("listitem")).toHaveCount(
    1,
  );
});
