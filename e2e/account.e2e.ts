import { readFile } from "node:fs/promises";

import { Effect } from "effect";
import { Schema } from "effect";
import { Array as EffectArray } from "effect";
import { Option as EffectOption } from "effect";

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
  await page.getByRole("link", { name: "Download your data" }).click();
  const path = await (await download).path();
  const body = await readFile(path, "utf8");
  const exported = Effect.runSync(Schema.decodeEffect(Schema.fromJsonString(ExportDocument))(body));

  expect(exported.schemaVersion).toBe(1);
  expect(
    EffectOption.getOrUndefined(
      EffectArray.findFirst(exported.tables, (table) => table.table === "user"),
    )?.rows[0]?.["email"],
  ).toBe(account.email);
  expect(
    EffectOption.getOrUndefined(
      EffectArray.findFirst(exported.tables, (table) => table.table === "session"),
    )?.rows.length,
  ).toBeGreaterThan(0);
  expect(EffectArray.map(exported.withheld, (entry) => `${entry.table}.${entry.field}`)).toContain(
    "session.token",
  );

  await expect(page.getByText(/Last download/u)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel("Type erase my account to confirm")).toBeVisible({
    timeout: 15_000,
  });

  const staleState = await page.context().storageState();
  await page.getByLabel("Type erase my account to confirm").fill("erase my account");
  await page.getByRole("button", { name: "Erase my account" }).click();
  await expect(page).toHaveURL("/erased");
  await expect(page.getByRole("heading", { name: "Your account is erased" })).toBeVisible();
  await expect(
    page.getByText(
      "The download you took is now the only copy, so keep it somewhere you can find it. You can create a new account with this address whenever you want.",
    ),
  ).toBeVisible();

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
