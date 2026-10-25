import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";
import { Schema } from "effect";

import {
  beginAuthorization,
  callback,
  exchangeCode,
  exchangeRefreshToken,
  mcpClient,
  mcpEndpoint,
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
    "get_transactions",
    "generate_transaction_review_links",
    "set_lineup",
    "get_lineup_runs",
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

  await signUp(page);
  const { credentials } = await authorize(page, origin);
  const authenticated = await mcpClient(mcpEndpoint(origin), credentials.access_token).request(
    "server/discover",
  );

  expect(Schema.decodeUnknownSync(DiscoveryResponse)(await authenticated.json()).result).toEqual(
    document.result,
  );
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
      provider: "yahoo",
      pairingCode: "ABCD2345",
    }),
  );
  const { credentials } = await authorize(page, origin);
  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);

  const listed = await client.callTool("list_connections", {});

  expect(listed.isError).toBe(false);
  expect(listed.structuredContent).toMatchObject({
    connections: [{ id: connection.id, provider: "yahoo", status: "linking" }],
  });
  expect(JSON.stringify(listed.structuredContent)).not.toContain("userId");

  const other = await newUser();
  await signUp(other);
  const otherAuthorization = await authorize(other, origin);
  const otherClient = mcpClient(mcpEndpoint(origin), otherAuthorization.credentials.access_token);
  const hidden = await otherClient.callTool("list_connections", {});

  expect(hidden.structuredContent).toEqual({ connections: [] });
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
  "connections:read fantasy:read transactions:review lineups:write offline_access";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
