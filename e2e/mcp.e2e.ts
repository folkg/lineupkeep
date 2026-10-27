import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

import { decodeProviderKey } from "@lineupkeep/backend/connections/ProviderKey";
import type { Page } from "@playwright/test";
import { Schema } from "effect";

import {
  beginAuthorization,
  callback,
  exchangeCode,
  exchangeRefreshToken,
  mcpClient,
  mcpEndpoint,
  registerPublicClient,
} from "./mcpClient.ts";
import { expect, signIn, signUp, test } from "./support.ts";
test("discovers and authorizes a stateless client through email sign-in, consent and PKCE", async ({
  page,
  baseURL,
}) => {
  const origin = requiredOrigin(baseURL);
  const anonymous = await mcpClient(mcpEndpoint(origin)).request("tools/list");
  expect(anonymous.status).toBe(401);
  expect(anonymous.headers.get("www-authenticate")).toContain(
    `${origin}/.well-known/oauth-protected-resource/mcp`,
  );
  expect(anonymous.headers.get("www-authenticate")).toContain(`scope="${documentedScopes}"`);

  const { credentials } = await authorize(
    page,
    origin,
    "connections:read",
    `mcp-${randomUUID()}@example.com`,
  );
  const tools = await mcpClient(mcpEndpoint(origin), credentials.access_token).request(
    "tools/list",
  );

  expect(tools.status).toBe(200);
  expect(tools.headers.has("mcp-session-id")).toBe(false);
  const listedTools = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
    }),
  )(await tools.json());
  expect(listedTools.result.tools.map((tool) => tool.name)).toEqual([
    "list_connections",
    "list_teams",
    "get_calendar",
    "get_league",
    "get_rosters",
    "search_players",
    "get_players",
    "get_matchups",
    "get_team_summary",
    "get_transactions",
    "generate_transaction_review_links",
    "set_lineup",
    "get_lineup_runs",
    "set_team_automation",
    "submit_feedback",
    "list_feedback",
    "triage_feedback",
  ]);
});

test("answers the documented token-free discovery request with the same document", async ({
  page,
  baseURL,
}) => {
  const origin = requiredOrigin(baseURL);
  const discovery = await documentedDiscoveryRequest(origin);

  expect(discovery.status).toBe(200);
  const document = Schema.decodeUnknownSync(DiscoveryResponse)(await discovery.json());
  expect(Object.keys(document.result).sort()).toEqual([
    "_meta",
    "cacheScope",
    "capabilities",
    "resultType",
    "supportedVersions",
    "ttlMs",
  ]);
  expect(document.result).toMatchObject({
    _meta: { "io.modelcontextprotocol/serverInfo": { name: "Lineupkeep" } },
    supportedVersions: ["2026-07-28"],
    capabilities: { tools: {} },
  });
  expect(document.result["capabilities"]).toEqual({ tools: {} });

  await signUp(page);
  const { credentials } = await authorize(page, origin);
  const authenticated = await mcpClient(mcpEndpoint(origin), credentials.access_token).request(
    "server/discover",
  );

  expect(Schema.decodeUnknownSync(DiscoveryResponse)(await authenticated.json()).result).toEqual(
    document.result,
  );
});

test("serves every tool scope after one consent for the documented scope set", async ({
  page,
  baseURL,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const { credentials } = await authorize(page, origin, documentedScopes);
  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);

  const team = randomUUID();
  const calls = [
    ["list_connections", {}],
    ["list_teams", {}],
    ["get_calendar", { team }],
    ["generate_transaction_review_links", { team, intents: [{ kind: "add", add: "r1.test" }] }],
    [
      "set_lineup",
      { requestId: randomUUID(), teams: [{ team, period: { coverage: "week", week: 3 } }] },
    ],
    ["get_lineup_runs", {}],
    ["set_team_automation", { teams: [{ team, action: "enable" }] }],
    [
      "submit_feedback",
      { kind: "friction", title: "Scope probe", body: "Checking the feedback surface." },
    ],
    ["list_feedback", { limit: 5 }],
    ["triage_feedback", { feedback: [{ feedback: randomUUID(), action: "acknowledge" }] }],
  ] as const;
  const statuses: Array<[string, number]> = [];
  for (const [name, arguments_] of calls) {
    const response = await client.request("tools/call", { name, arguments: arguments_ });
    statuses.push([name, response.status]);
  }

  expect(statuses).toEqual(calls.map(([name]) => [name, 200]));
});

test("lists the owner's connection status over MCP without exposing account identity", async ({
  page,
  baseURL,
  newUser,
  services,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const connection = Schema.decodeUnknownSync(
    Schema.Struct({ id: Schema.String, status: Schema.String }),
  )(
    await services.exercise(page, "start the owner's link", "startLinking", {
      requestId: randomUUID(),
      provider: decodeProviderKey("yahoo"),
      pairingCode: "ABCD2345",
    }),
  );
  const { credentials } = await authorize(page, origin);
  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);

  const listed = await client.callTool("list_connections", {});

  expect(listed.isError).toBe(false);
  expect(listed.structuredContent).toMatchObject({
    connections: [{ id: connection.id, provider: decodeProviderKey("yahoo"), status: "linking" }],
  });
  expect(JSON.stringify(listed.structuredContent)).not.toContain("userId");

  const other = await newUser();
  await signUp(other);
  const otherAuthorization = await authorize(other, origin);
  const otherClient = mcpClient(mcpEndpoint(origin), otherAuthorization.credentials.access_token);
  const hidden = await otherClient.callTool("list_connections", {});

  expect(hidden.structuredContent).toEqual({ connections: [] });
});

test("reports, retrieves, and closes feedback for the acting account only", async ({
  page,
  baseURL,
  newUser,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const { credentials } = await authorize(page, origin, documentedScopes);
  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);

  const submitted = await client.callTool("submit_feedback", {
    kind: "data-issue",
    title: "Roster totals disagree",
    body: "The category totals on the roster page differ from the provider page.",
    context: { tool: "get_rosters", surface: "mcp", client: "e2e" },
  });

  expect(submitted.isError).toBe(false);
  const report = Schema.decodeUnknownSync(
    Schema.Struct({ feedback: Schema.Struct({ id: Schema.String, status: Schema.String }) }),
  )(submitted.structuredContent).feedback;
  expect(report.status).toBe("open");
  const feedback = report.id;

  const listed = await client.callTool("list_feedback", { statuses: ["open"], limit: 5 });
  expect(JSON.stringify(listed.structuredContent)).toContain(feedback);

  const acknowledged = await client.callTool("triage_feedback", {
    feedback: [{ feedback, action: "acknowledge" }],
  });
  expect(acknowledged.structuredContent).toMatchObject({
    results: [{ outcome: "changed", feedback: { status: "acknowledged" } }],
  });

  const resolved = await client.callTool("triage_feedback", {
    feedback: [{ feedback, action: "resolve", note: "Fixed by the week-mapping change." }],
  });
  expect(resolved.structuredContent).toMatchObject({
    results: [
      {
        outcome: "changed",
        feedback: { status: "resolved", resolutionNote: "Fixed by the week-mapping change." },
      },
    ],
  });
  expect(JSON.stringify(resolved)).not.toContain("cause");

  const repeated = await client.callTool("triage_feedback", {
    feedback: [{ feedback, action: "resolve", note: "A replacement note." }],
  });
  expect(repeated.structuredContent).toMatchObject({
    results: [
      {
        outcome: "unchanged",
        feedback: { status: "resolved", resolutionNote: "Fixed by the week-mapping change." },
      },
    ],
  });

  const other = await newUser();
  await signUp(other);
  const otherAuthorization = await authorize(other, origin, documentedScopes);
  const otherClient = mcpClient(mcpEndpoint(origin), otherAuthorization.credentials.access_token);
  const hidden = await otherClient.callTool("list_feedback", {});
  const refused = await otherClient.callTool("triage_feedback", {
    feedback: [{ feedback, action: "acknowledge" }],
  });

  expect(hidden.structuredContent).toMatchObject({ feedback: [], page: { returned: 0 } });
  expect(refused.structuredContent).toMatchObject({ results: [{ outcome: "not_found" }] });

  await page.goto("/feedback");
  await expect(page.getByText("Roster totals disagree")).toBeVisible();
  await expect(page.getByText("Data issue · Resolved")).toBeVisible();
});

test("enforces fantasy read and transaction review scopes over MCP", async ({ page, baseURL }) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const { credentials } = await authorize(page, origin, "connections:read");
  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);

  const readDenied = await client.request("tools/call", {
    name: "list_teams",
    arguments: {},
  });
  expect(readDenied.status).toBe(403);
  expect(readDenied.headers.get("www-authenticate")).toContain('scope="fantasy:read"');
  const denial = Schema.decodeUnknownSync(
    Schema.Struct({ error: Schema.String, scope: Schema.String, error_description: Schema.String }),
  )(await readDenied.json());
  expect(denial.scope).toBe("fantasy:read");
  expect(denial.error).toBe("insufficient_scope");
  expect(denial.error_description).toContain(documentedScopes);

  const reviewDenied = await client.request("tools/call", {
    name: "generate_transaction_review_links",
    arguments: { team: randomUUID(), intents: [{ kind: "add", add: "r1.invalid" }] },
  });
  expect(reviewDenied.status).toBe(403);
  expect(reviewDenied.headers.get("www-authenticate")).toContain('scope="transactions:review"');

  const lineupDenied = await client.request("tools/call", {
    name: "set_lineup",
    arguments: {
      requestId: randomUUID(),
      teams: [{ team: randomUUID(), period: { coverage: "week", week: 3 } }],
    },
  });
  expect(lineupDenied.status).toBe(403);
  expect(lineupDenied.headers.get("www-authenticate")).toContain('scope="lineups:write"');

  const automationDenied = await client.request("tools/call", {
    name: "set_team_automation",
    arguments: { teams: [{ team: randomUUID(), action: "enable" }] },
  });
  expect(automationDenied.status).toBe(403);
  expect(automationDenied.headers.get("www-authenticate")).toContain('scope="teams:manage"');

  const readAuthorization = await authorize(page, origin, "fantasy:read");
  const reader = mcpClient(mcpEndpoint(origin), readAuthorization.credentials.access_token);
  const teams = await reader.callTool("list_teams", {});
  expect(teams.isError).toBe(false);
  expect(teams.structuredContent).toMatchObject({ status: "ok", teams: [] });

  const missing = await reader.callTool("get_calendar", { team: randomUUID() });
  expect(missing.isError).toBe(true);
  expect(JSON.stringify(missing)).not.toContain("cause");

  const reviewAuthorization = await authorize(page, origin, "transactions:review");
  const reviewer = mcpClient(mcpEndpoint(origin), reviewAuthorization.credentials.access_token);
  const review = await reviewer.callTool("generate_transaction_review_links", {
    team: randomUUID(),
    intents: [{ kind: "add", add: "r1.invalid" }],
  });
  expect(review.isError).toBe(true);
  expect(JSON.stringify(review)).not.toContain("submit");

  const lineupAuthorization = await authorize(page, origin, "lineups:write");
  const lineupWriter = mcpClient(mcpEndpoint(origin), lineupAuthorization.credentials.access_token);
  const missingTeam = await lineupWriter.callTool("set_lineup", {
    requestId: randomUUID(),
    teams: [{ team: randomUUID(), period: { coverage: "week", week: 3 } }],
  });
  expect(missingTeam.isError).toBe(true);
  expect(JSON.stringify(missingTeam)).not.toContain("completed");
});

test("changes automation over MCP and reports it through list_teams", async ({
  page,
  baseURL,
  services,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const discovered = Schema.decodeUnknownSync(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        availability: Schema.String,
        automation: Schema.Struct({ status: Schema.String }),
      }),
    ),
  )(
    await services.exercise(
      page,
      "link the provider fake and discover teams",
      "connectYahooAndDiscoverTeams",
      { requestId: randomUUID(), pairingCode: "ABCD2345" },
    ),
  );
  const team = discovered[0]?.id;
  expect(team, "a discovered team").toBeDefined();
  if (team === undefined) {
    return;
  }

  const { credentials } = await authorize(page, origin, "fantasy:read teams:manage");
  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);
  const initial = await client.callTool("list_teams", {});
  expect(teamAutomation(initial, team)).toMatchObject({
    availability: "available",
    automation: { status: "disabled" },
  });

  const enabled = await client.callTool("set_team_automation", {
    teams: [{ team, action: "enable" }],
  });
  expect(enabled.isError).toBe(false);
  expect(enabled.structuredContent).toMatchObject({
    teams: [
      {
        team,
        action: "enable",
        outcome: "changed",
        enrolled: true,
        availability: "available",
        automation: { status: "enabled" },
      },
    ],
  });
  expect(teamAutomation(await client.callTool("list_teams", {}), team)).toMatchObject({
    automation: { status: "enabled" },
  });

  const paused = await client.callTool("set_team_automation", {
    teams: [{ team, action: "pause-today" }],
  });
  expect(teamAutomation(paused, team)).toMatchObject({
    automation: { status: "paused-until-fantasy-day-end" },
  });
  expect(
    teamAutomation(paused, team).automation?.resumesAt,
    "a provider fantasy-day resume boundary",
  ).toBeDefined();
  expect(teamAutomation(await client.callTool("list_teams", {}), team)).toMatchObject({
    automation: {
      status: "paused-until-fantasy-day-end",
      resumesAt: teamAutomation(paused, team).automation?.resumesAt,
    },
  });

  const resumed = await client.callTool("set_team_automation", {
    teams: [{ team, action: "resume" }],
  });
  expect(teamAutomation(resumed, team)).toMatchObject({
    automation: { status: "enabled" },
  });

  const disabled = await client.callTool("set_team_automation", {
    teams: [{ team, action: "disable" }],
  });
  expect(teamAutomation(disabled, team)).toMatchObject({
    outcome: "changed",
    enrolled: false,
    automation: { status: "disabled" },
  });

  const readOnly = await authorize(page, origin, "fantasy:read connections:read");
  const reader = mcpClient(mcpEndpoint(origin), readOnly.credentials.access_token);
  const denied = await reader.request("tools/call", {
    name: "set_team_automation",
    arguments: { teams: [{ team, action: "enable" }] },
  });
  expect(denied.status).toBe(403);
  expect(denied.headers.get("www-authenticate")).toContain('scope="teams:manage"');
  expect(teamAutomation(await reader.callTool("list_teams", {}), team)).toMatchObject({
    automation: { status: "disabled" },
  });
});

test("returns access_denied and the original state when consent is denied", async ({
  page,
  baseURL,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const authorization = await beginAuthorization(page, mcpEndpoint(origin), "connections:read");
  await expect(page.getByRole("heading", { name: "Connect a client?" })).toBeVisible();

  await page.getByRole("button", { name: "Deny access", exact: true }).click();
  await expect(page).toHaveURL(callbackPattern);

  expect(new URL(page.url()).searchParams.get("error")).toBe("access_denied");
  expect(new URL(page.url()).searchParams.get("state")).toBe(authorization.state);
  expect(new URL(page.url()).searchParams.has("code")).toBe(false);
});

test("presents missing and forged consent requests without permission actions", async ({
  page,
}) => {
  await signUp(page);

  for (const query of [
    "",
    "?client_id=",
    "?client_id=https%3A%2F%2Fconnections-client.test%2Fclient.json&sig=forged",
  ]) {
    await page.goto(`/consent${query}`);
    await expect(
      page.getByRole("heading", { name: "Invalid authorization request" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Allow access", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Deny access", exact: true })).toHaveCount(0);
  }
});

test("rejects legacy protocols and registers dynamic clients", async ({ page, baseURL }) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const { credentials } = await authorize(page, origin, "connections:read");

  const legacy = await mcpClient(mcpEndpoint(origin), credentials.access_token).request(
    "tools/list",
    {},
    "2025-11-25",
  );
  const registration = await fetch(new URL("/api/auth/oauth2/register", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Registration probe",
      redirect_uris: [callback],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    }),
  });
  const registered: unknown = await registration.json();

  expect(legacy.status).toBe(400);
  expect(legacy.headers.has("mcp-session-id")).toBe(false);
  expect(registration.status, "dynamic client registration is open for public clients").toBe(201);
  expect(isRecord(registered) && typeof registered["client_id"] === "string").toBe(true);
  expect(isRecord(registered) ? registered["scope"] : undefined).toBe(documentedScopes);
  expect(isRecord(registered) ? registered["client_secret"] : undefined).toBeUndefined();
});

test("authorizes a dynamically registered client through consent", async ({ page, baseURL }) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);

  const registration = await fetch(new URL("/api/auth/oauth2/register", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Muse probe",
      redirect_uris: [callback],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    }),
  });
  const registered: unknown = await registration.json();
  expect(registration.status).toBe(201);
  expect(isRecord(registered) && typeof registered["client_id"] === "string").toBe(true);
  const clientId = isRecord(registered) ? String(registered["client_id"]) : "";

  const authorization = await beginAuthorization(
    page,
    mcpEndpoint(origin),
    "fantasy:read lineups:write",
    fetch,
    clientId,
  );
  await expect(page.getByRole("heading", { name: "Connect a client?" })).toBeVisible();
  await expect(
    page.getByText("Calls itself “Muse probe” — names are not verified.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Allow access", exact: true }).click();
  await expect(page).toHaveURL(callbackPattern);

  const credentials = await exchangeCode(page, authorization);
  expect(credentials.scope.split(" ")).toEqual(
    expect.arrayContaining(["fantasy:read", "lineups:write"]),
  );
});

test("rotates refresh credentials and rejects the spent token after the retry window", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(60_000);

  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const { credentials, authorization } = await authorize(
    page,
    origin,
    "connections:read offline_access",
  );
  const initial = Schema.decodeUnknownSync(RefreshCredentials)(credentials);

  const response = await exchangeRefreshToken(authorization, initial.refresh_token);
  expect(response.status).toBe(200);
  const rotated = Schema.decodeUnknownSync(RefreshCredentials)(await response.json());
  const tools = await mcpClient(mcpEndpoint(origin), rotated.access_token).request("tools/call", {
    name: "list_connections",
    arguments: {},
  });

  expect(rotated.refresh_token).not.toBe(initial.refresh_token);
  expect(tools.status).toBe(200);
  expect(await tools.json()).toMatchObject({ result: { structuredContent: { connections: [] } } });
  const replayResponse = await exchangeRefreshToken(authorization, initial.refresh_token);
  expect(replayResponse.status).toBe(200);
  expect(
    Schema.decodeUnknownSync(RefreshCredentials)(await replayResponse.json()).refresh_token,
  ).toBe(rotated.refresh_token);
  await expect
    .poll(
      async () => {
        const spent = await exchangeRefreshToken(authorization, initial.refresh_token);
        const body = Schema.decodeUnknownSync(
          Schema.Struct({ error: Schema.optional(Schema.String) }),
        )(await spent.json());
        return { status: spent.status, error: body.error };
      },
      { timeout: 40_000, intervals: [1000, 2000, 5000] },
    )
    .toEqual({ status: 400, error: "invalid_grant" });
});

test("issues a refresh token only for a grant that asks for offline_access", async ({
  page,
  baseURL,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);

  const { credentials: withoutOffline } = await authorize(page, origin, "connections:read");
  expect(withoutOffline.refresh_token).toBeUndefined();

  const { credentials: withOffline } = await authorize(
    page,
    origin,
    "connections:read offline_access",
  );
  expect(withOffline.refresh_token).toBeDefined();
});

test("renews an expired public client grant after idle and refuses a rotated token", async ({
  page,
  baseURL,
}) => {
  test.setTimeout(480_000);

  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const clientId = await registerPublicClient(origin, "Lineupkeep expiry probe");
  const authorization = await beginAuthorization(
    page,
    mcpEndpoint(origin),
    documentedScopes,
    fetch,
    clientId,
  );
  await expect(page.getByRole("heading", { name: "Connect a client?" })).toBeVisible();
  await page.getByRole("button", { name: "Allow access", exact: true }).click();
  await expect(page).toHaveURL(callbackPattern);
  const issued = Schema.decodeUnknownSync(IssuedCredentials)(
    await exchangeCode(page, authorization),
  );

  expect(issued.expires_in).toBe(300);
  expect(await advertisedKeyIds(origin)).toContain(jwtHeader(issued.access_token).kid);
  const live = mcpClient(mcpEndpoint(origin), issued.access_token);
  expect((await live.callTool("list_connections", {})).isError).toBe(false);

  await delay((issued.expires_in + 3) * 1000);
  const expired = await live.request("tools/call", {
    name: "list_connections",
    arguments: {},
  });
  expect(expired.status).toBe(401);
  expect(expired.headers.get("www-authenticate")).toContain("resource_metadata=");

  const first = await exchangeRefreshToken(authorization, issued.refresh_token);
  expect(first.status).toBe(200);
  const rotated = Schema.decodeUnknownSync(IssuedCredentials)(await first.json());
  const rotatedAt = Date.now();
  expect(rotated.refresh_token).not.toBe(issued.refresh_token);
  expect(
    (await mcpClient(mcpEndpoint(origin), rotated.access_token).callTool("list_connections", {}))
      .isError,
  ).toBe(false);

  const second = await exchangeRefreshToken(authorization, rotated.refresh_token);
  expect(second.status).toBe(200);
  const chained = Schema.decodeUnknownSync(IssuedCredentials)(await second.json());
  expect(
    (await mcpClient(mcpEndpoint(origin), chained.access_token).callTool("list_connections", {}))
      .isError,
  ).toBe(false);

  await delay(Math.max(0, refreshTokenReuseWindowMillis + 1000 - (Date.now() - rotatedAt)));
  const spent = await exchangeRefreshToken(authorization, issued.refresh_token);
  expect(spent.status).toBe(400);
  expect(await errorCode(spent)).toBe("invalid_grant");

  const family = await exchangeRefreshToken(authorization, chained.refresh_token);
  expect(family.status).toBe(400);
  expect(await errorCode(family)).toBe("invalid_grant");
});

function teamAutomation(
  result: {
    readonly isError?: boolean | undefined;
    readonly structuredContent?:
      | {
          readonly [x: string]: unknown;
        }
      | undefined;
  },
  team: string,
): {
  readonly availability?: string | undefined;
  readonly outcome?: string | undefined;
  readonly enrolled?: boolean | undefined;
  readonly automation?: { readonly status?: string; readonly resumesAt?: string } | undefined;
} {
  const body = result.structuredContent as
    | {
        readonly teams?: ReadonlyArray<{
          readonly team?: string;
          readonly availability?: string;
          readonly outcome?: string;
          readonly enrolled?: boolean;
          readonly automation?: { readonly status?: string; readonly resumesAt?: string };
        }>;
      }
    | undefined;
  const row = body?.teams?.find((candidate) => candidate.team === team);
  if (row === undefined) {
    throw new Error(`No team ${team} in the MCP result`);
  }
  return row;
}

function documentedDiscoveryRequest(origin: string): Promise<Response> {
  return fetch(new URL("/mcp", origin), {
    method: "POST",
    headers: documentedHeaders("server/discover"),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "server/discover",
      params: {
        _meta: {
          "io.modelcontextprotocol/protocolVersion": protocolVersion,
          "io.modelcontextprotocol/clientInfo": { name: "curl", version: "1.0.0" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

function documentedHeaders(method: string): Record<string, string> {
  return {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": protocolVersion,
    "mcp-method": method,
  };
}

const protocolVersion = "2026-07-28";
const documentedScopes =
  "connections:read fantasy:read transactions:review lineups:write teams:manage feedback:manage offline_access";

async function authorize(
  page: Page,
  origin: string,
  scope = "connections:read",
  email?: string,
): Promise<{
  credentials: {
    readonly access_token: string;
    readonly token_type: "Bearer";
    readonly scope: string;
    readonly refresh_token?: string | undefined;
  };
  authorization: {
    clientId: string;
    verifier: string;
    state: `${string}-${string}-${string}-${string}-${string}`;
    tokenEndpoint: string;
    resource: string;
    clientAddress: string;
  };
}> {
  const authorization = await beginAuthorization(page, mcpEndpoint(origin), scope);
  if (email !== undefined) {
    await expect(page.getByRole("heading", { name: "Sign in or start fresh." })).toBeVisible();
    await signIn(page, { email });
  }
  await expect(page.getByRole("heading", { name: "Connect a client?" })).toBeVisible();
  await expect(
    page.getByText("Connecting to connections-client.test", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Calls itself “Lineupkeep test client” — names are not verified.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("https://connections-client.test/client.json", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Allow access", exact: true }).click();
  await expect(page).toHaveURL(callbackPattern);
  return { credentials: await exchangeCode(page, authorization), authorization };
}

function requiredOrigin(value: string | undefined): string {
  if (value === undefined) {
    throw new Error("Missing test origin");
  }
  return value;
}

const callbackPattern = new RegExp(`^${callback.replaceAll(".", "\\.")}\\?`);
const DiscoveryResponse = Schema.Struct({
  result: Schema.Record(Schema.String, Schema.Unknown),
});
const RefreshCredentials = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
});
const IssuedCredentials = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
  expires_in: Schema.Finite,
});

const refreshTokenReuseWindowMillis = 30_000;

async function advertisedKeyIds(origin: string): Promise<ReadonlyArray<string>> {
  const response = await fetch(new URL("/api/auth/jwks", origin));
  const document = Schema.decodeUnknownSync(
    Schema.Struct({ keys: Schema.Array(Schema.Struct({ kid: Schema.String })) }),
  )(await response.json());
  return document.keys.map((key) => key.kid);
}

function jwtHeader(token: string): { readonly kid: string } {
  return Schema.decodeUnknownSync(Schema.Struct({ kid: Schema.String }))(
    JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString()),
  );
}

async function errorCode(response: Response): Promise<string | undefined> {
  return Schema.decodeUnknownSync(Schema.Struct({ error: Schema.optional(Schema.String) }))(
    await response.json(),
  ).error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
