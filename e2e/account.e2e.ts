import { readFile } from "node:fs/promises";

import { Schema } from "effect";

import { expect, signUp, test } from "./support";

test("exports the account data, erases it, and leaves the old cookie without access", async ({
  page,
  browser,
  baseURL,
}) => {
  const account = await signUp(page);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your data" })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export my data" }).click();
  const path = await (await download).path();
  const body = await readFile(path, "utf8");
  const exported = Schema.decodeSync(Schema.fromJsonString(ExportDocument))(body);

  expect(exported.schemaVersion).toBe(1);
  expect(exported.tables.find((table) => table.table === "user")?.rows[0]?.["email"]).toBe(
    account.email,
  );
  expect(exported.tables.find((table) => table.table === "session")?.rows.length).toBeGreaterThan(
    0,
  );
  expect(exported.withheld.map((entry) => `${entry.table}.${entry.field}`)).toContain(
    "session.token",
  );

  const staleState = await page.context().storageState();
  await page.getByLabel("Type erase my account to confirm").fill("erase my account");
  await page.getByRole("button", { name: "Erase my account" }).click();
  await expect(page).toHaveURL("/erased");
  await expect(page.getByRole("heading", { name: "Your account is erased" })).toBeVisible();

  const stale = await browser.newContext({ storageState: staleState });
  const stalePage = await stale.newPage();
  await stalePage.goto(new URL("/teams", baseURL).href);
  await expect(stalePage).toHaveURL(/\/auth/u);
  await stale.close();
});

const ExportDocument = Schema.Struct({
  schemaVersion: Schema.Number,
  tables: Schema.Array(
    Schema.Struct({
      table: Schema.String,
      rows: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
    }),
  ),
  withheld: Schema.Array(
    Schema.Struct({
      table: Schema.String,
      field: Schema.String,
    }),
  ),
}).pipe(Schema.toType);
type ExportDocument = typeof ExportDocument.Type;
