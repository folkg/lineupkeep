import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";
import { Schema } from "effect";

import {
  AcceptanceReport,
  type AuthorizedClient,
  type ConsentCheck,
  requestedScopeNames,
  runAcceptance,
  writeAcceptanceReport,
} from "./mcpAccept.ts";
import {
  beginAuthorization,
  callback,
  exchangeCode,
  mcpClient,
  mcpEndpoint,
  registerPublicClientDetails,
} from "./mcpClient.ts";
import type { ServiceSetup } from "./serviceSetup.ts";
import { expect, signIn, signUp, test, type Account } from "./support.ts";

test("accepts the MCP scope boundary against a local origin", async ({
  page,
  services,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const origin = requiredBaseUrl(baseURL);
  const report = new AcceptanceReport({ mode: "local", origin });
  try {
    const owner = await signUp(page, "owner");
    const team = await linkProviderTeam(page, services, report);
    await runAcceptance(
      {
        mode: "local",
        origin,
        requestedScopes: requestedScopeNames(process.env["MCP_ACCEPT_SCOPES"]),
        team,
        register: () => registerPublicClientDetails(origin, clientName),
        authorize: authorizeWithClient(page, origin, owner),
      },
      report,
    );
  } catch (error) {
    report.fatal(error);
  } finally {
    await writeAcceptanceReport(report, requiredReportPath());
  }
  expect(report.summary().findings, report.failureMessage()).toEqual([]);
});

function authorizeWithClient(
  page: Page,
  origin: string,
  owner: Account,
): (
  clientId: string,
  scopes: ReadonlyArray<string>,
  consent: ConsentCheck,
) => Promise<AuthorizedClient> {
  return (clientId, scopes, consent) =>
    test.step(`Setup (mcp): authorize ${scopes.join(" ")}`, async () => {
      const authorization = await beginAuthorization(
        page,
        mcpEndpoint(origin),
        scopes.join(" "),
        fetch,
        clientId,
      );
      if (new URL(page.url()).pathname === "/auth") {
        await signIn(page, owner);
      }
      const returned = new URL(page.url());
      if (returned.origin + returned.pathname === callback) {
        const error = returned.searchParams.get("error");
        if (error !== null) {
          throw new Error(
            `Authorization returned ${error}: ${returned.searchParams.get("error_description") ?? "no description"}.`,
          );
        }
      }
      const heading = page.getByRole("heading", { name: "Connect a client?" });
      if (!(await heading.isVisible().catch(() => false))) {
        const text = await page
          .locator("main")
          .innerText()
          .catch(() => "no page text");
        throw new Error(`Authorization did not reach consent. Page says: ${text.slice(0, 400)}`);
      }
      await expect(
        page.getByText(`Calls itself “${clientName}”. Names are not verified.`, {
          exact: true,
        }),
      ).toBeVisible();
      const feedbackDescription = page.getByText(
        /Acknowledge, resolve, or close the feedback reports/u,
      );
      if (consent === "includes-feedback-manage") {
        await expect(feedbackDescription).toBeVisible();
      } else {
        await expect(feedbackDescription).toHaveCount(0);
      }
      await page.getByRole("button", { name: "Allow access", exact: true }).click();
      await expect(page).toHaveURL(callbackPattern);
      const credentials = await exchangeCode(page, authorization);
      await page.goto("about:blank");
      const granted = credentials.scope.split(" ").filter(Boolean);
      if (!sameSet(granted, scopes)) {
        throw new Error(
          `Authorization returned ${granted.join(" ")} instead of the requested ${scopes.join(" ")}.`,
        );
      }
      return { client: mcpClient(mcpEndpoint(origin), credentials.access_token), granted };
    });
}

async function linkProviderTeam(
  page: Page,
  services: ServiceSetup,
  report: AcceptanceReport,
): Promise<string> {
  try {
    const discovered = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String })))(
      await services.exercise(
        page,
        "link the provider fake and discover teams",
        "connectYahooAndDiscoverTeams",
        {},
      ),
    );
    const team = discovered[0]?.id;
    if (team === undefined) {
      report.note(
        "The provider fixture discovered no teams; team-scoped calls use disposable ids.",
      );
      return randomUUID();
    }
    report.note("Provider fixture linked; team-scoped calls use the discovered team.");
    return team;
  } catch (error) {
    report.note(
      `Provider fixture unavailable; team-scoped calls use disposable ids. ${error instanceof Error ? error.message : String(error)}`,
    );
    return randomUUID();
  }
}

function requiredBaseUrl(value: string | undefined): string {
  if (value === undefined) {
    throw new Error("MCP acceptance needs BETTER_AUTH_URL; run through `bun run mcp:accept`.");
  }
  return value;
}

function requiredReportPath(): string {
  const path = process.env["MCP_ACCEPT_REPORT"];
  if (path === undefined) {
    throw new Error("MCP_ACCEPT_REPORT is required; run through `bun run mcp:accept`.");
  }
  return path;
}

function sameSet(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

const clientName = "Lineupkeep MCP acceptance";

const callbackPattern = new RegExp(`^${callback.replaceAll(".", "\\.")}\\?`);
