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
  expect(await tools.json()).toMatchObject({
    result: {
      tools: [{ name: "list_connections" }],
    },
  });
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

test("rejects legacy protocols and dynamic client registration", async ({ page, baseURL }) => {
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
    body: JSON.stringify({ redirect_uris: [callback] }),
  });

  expect(legacy.status).toBe(400);
  expect(legacy.headers.has("mcp-session-id")).toBe(false);
  expect(registration.status).toBe(403);
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
const RefreshCredentials = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
});
