import { addNote, expect, noteTitles, signIn, signUp, test } from "./support";

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

test("returns home on sign-out and back to the account's notes on sign-in", async ({ page }) => {
  const account = await signUp(page);
  await addNote(page, "Kept across sessions", "Still mine after signing in again.");

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.goto("/notes");
  await expect(page).toHaveURL("/auth?redirect=%2Fnotes");
  await signIn(page, account);

  await expect(page).toHaveURL("/notes");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
  await expect(noteTitles(page)).toHaveText(["Kept across sessions"]);
});

test("keeps the session and draft when sign-out navigation is cancelled", async ({ page }) => {
  await signUp(page);
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  const body = page.getByRole("textbox", { name: "Note", exact: true });
  await title.fill("Kept after cancelled sign-out");
  await body.fill("The session must remain usable.");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Keep editing" }).click();

  await expect(page).toHaveURL("/notes");
  await expect(title).toHaveValue("Kept after cancelled sign-out");
  await expect(body).toHaveValue("The session must remain usable.");
  await page.getByRole("button", { name: "Add note" }).click();
  await expect(noteTitles(page)).toHaveText(["Kept after cancelled sign-out"]);
  await page.reload();
  await expect(noteTitles(page)).toHaveText(["Kept after cancelled sign-out"]);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

  await title.fill("Discarded only after confirmation");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("button", { name: "Discard and leave" }).click();

  await expect(page).toHaveURL("/");
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
  await page.goto("/notes");
  await expect(page).toHaveURL("/auth?redirect=%2Fnotes");
});

test("keeps the unsaved input when Sign in again is declined", async ({ page }) => {
  await signUp(page);
  await page.context().clearCookies();
  const title = page.getByRole("textbox", { name: "Title", exact: true });
  await title.fill("Written after expiry");
  const body = page.getByRole("textbox", { name: "Note", exact: true });
  await body.fill("This must not be lost.");
  await page.getByRole("button", { name: "Add note" }).click();

  await expect(page.getByText(/^Your session has ended\./)).toBeVisible();
  await expect(page).toHaveURL("/notes");
  await expect(title).toHaveValue("Written after expiry");
  await expect(body).toHaveValue("This must not be lost.");
  await page.getByRole("button", { name: "Sign in again" }).click();

  await page.getByRole("button", { name: "Keep editing" }).click();

  await expect(page).toHaveURL("/notes");
  await expect(title).toHaveValue("Written after expiry");
});
