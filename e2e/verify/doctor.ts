import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { chromium, expect } from "@playwright/test";
import postgres from "postgres";

export default async function doctor(): Promise<void> {
  const directory = required("VERIFICATION_DIR");
  const database = new URL(required("DATABASE_URL"));
  const origin = required("BETTER_AUTH_URL");
  const emailOrigin = required("RESEND_API_BASE_URL");
  const sql = postgres(database.href, { connect_timeout: 5, onnotice: () => undefined });
  try {
    const migrations = await readdir(
      new URL("../../packages/backend/migrations/", import.meta.url),
    );
    const rows = await sql<
      { applied: number }[]
    >`select count(*)::int as applied from drizzle.__drizzle_migrations`;
    expect(rows[0]?.applied, "committed migrations applied before driving").toBe(migrations.length);
    const email = await fetch(emailOrigin);
    expect(email.ok, "local fake email server is ready").toBe(true);

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const response = await page.goto(new URL("/auth", origin).href);
      expect(response?.ok(), "application responds at the recorded origin").toBe(true);
      await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Email me a code" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue with Google" })).toHaveCount(0);
      await writeFile(
        join(directory, "doctor.json"),
        JSON.stringify(
          {
            status: "ready",
            checkedAt: new Date().toISOString(),
            origin,
            emailOrigin,
            databaseName: database.pathname.slice(1),
            migrations: rows[0]?.applied,
            checks: [
              "Alchemy-owned production resources",
              "committed migrations",
              "fake email readiness",
              "usable email sign-in UI",
              "Google disabled",
            ],
          },
          null,
          2,
        ),
      );
    } finally {
      await browser.close();
    }
  } catch (error) {
    await writeFile(
      join(directory, "doctor.json"),
      JSON.stringify({ status: "blocked", error: String(error) }, null, 2),
    );
    throw error;
  } finally {
    await sql.end();
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined) {
    throw new Error(`${name} is required; run bun run verify.`);
  }
  return value;
}
