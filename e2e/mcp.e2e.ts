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
import { expect, noteCard, signIn, signUp, test } from "./support.ts";
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
    "notes:read notes:write",
    `mcp-${randomUUID()}@example.com`,
  );
  const tools = await mcpClient(mcpEndpoint(origin), credentials.access_token).request(
    "tools/list",
  );

  expect(tools.status).toBe(200);
  expect(tools.headers.has("mcp-session-id")).toBe(false);
  expect(await tools.json()).toMatchObject({
    result: {
      tools: [
        { name: "list_notes" },
        { name: "create_note" },
        { name: "update_note" },
        { name: "trash_note" },
        { name: "restore_note" },
      ],
    },
  });
});

test("reuses creation identity and shows the same Note in the browser", async ({
  page,
  baseURL,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const { credentials } = await authorize(page, origin);
  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);
  const input = {
    name: "create_note",
    arguments: { requestId: randomUUID(), title: "From MCP", body: "Visible in the browser" },
  };

  const first = Schema.decodeUnknownSync(NoteResult)(
    await (await client.request("tools/call", input)).json(),
  );
  const retry = Schema.decodeUnknownSync(NoteResult)(
    await (await client.request("tools/call", input)).json(),
  );
  await page.goto("/notes");

  expect(retry.result.structuredContent.note.id).toBe(first.result.structuredContent.note.id);
  await expect(noteCard(page, "From MCP")).toHaveCount(1);
  await expect(noteCard(page, "From MCP")).toContainText("Visible in the browser");
});

test("updates, trashes and restores a Note through tools", async ({ page, baseURL }) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const { credentials } = await authorize(page, origin);
  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);
  const created = await client.request("tools/call", {
    name: "create_note",
    arguments: { requestId: randomUUID(), title: "Lifecycle", body: "Original" },
  });
  const id = Schema.decodeUnknownSync(NoteResult)(await created.json()).result.structuredContent
    .note.id;

  for (const [name, arguments_] of [
    ["update_note", { id, title: "Updated over MCP", body: "Updated" }],
    ["trash_note", { id }],
    ["restore_note", { id }],
  ] as const) {
    const changed = await client.request("tools/call", { name, arguments: arguments_ });
    expect(changed.status).toBe(200);
    expect(await changed.json()).toMatchObject({ result: { isError: false } });
    const listed = await client.request("tools/call", {
      name: "list_notes",
      arguments: { lifecycle: name === "trash_note" ? "trashed" : "active" },
    });
    expect(await listed.json()).toMatchObject({
      result: {
        structuredContent: { notes: [{ id, title: "Updated over MCP", body: "Updated" }] },
      },
    });
  }
  await page.goto("/notes");
  await expect(noteCard(page, "Updated over MCP")).toContainText("Updated");
});

test("keeps another person's Notes invisible and unmodifiable in browser and MCP", async ({
  page,
  baseURL,
  newUser,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const { credentials } = await authorize(page, origin);
  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);
  const created = await client.request("tools/call", {
    name: "create_note",
    arguments: { requestId: randomUUID(), title: "Private MCP Note", body: "Only mine" },
  });
  const id = Schema.decodeUnknownSync(NoteResult)(await created.json()).result.structuredContent
    .note.id;
  const other = await newUser();
  await signUp(other);
  await expect(other.getByRole("heading", { name: "Private MCP Note", exact: true })).toHaveCount(
    0,
  );
  const otherAuthorization = await authorize(other, origin);
  const otherClient = mcpClient(mcpEndpoint(origin), otherAuthorization.credentials.access_token);

  const hidden = await otherClient.request("tools/call", { name: "list_notes", arguments: {} });
  const forbidden = await otherClient.request("tools/call", {
    name: "restore_note",
    arguments: { id },
  });

  expect(await hidden.json()).toMatchObject({ result: { structuredContent: { notes: [] } } });
  expect(await forbidden.json()).toMatchObject({ result: { isError: true } });
  await page.goto("/notes");
  await expect(noteCard(page, "Private MCP Note")).toContainText("Only mine");
});

test("returns access_denied and the original state when consent is denied", async ({
  page,
  baseURL,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const authorization = await beginAuthorization(page, mcpEndpoint(origin), "notes:read");
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
    "?client_id=https%3A%2F%2Fnotes-client.test%2Fclient.json&sig=forged",
  ]) {
    await page.goto(`/consent${query}`);
    await expect(
      page.getByRole("heading", { name: "Invalid authorization request" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Allow access", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Deny access", exact: true })).toHaveCount(0);
  }
});

test("challenges a read-only token to step up before a write", async ({ page, baseURL }) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const { credentials } = await authorize(page, origin, "notes:read");
  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);
  expect((await client.request("tools/list")).status).toBe(200);

  const write = await client.request("tools/call", {
    name: "create_note",
    arguments: { requestId: randomUUID(), title: "No permission", body: "" },
  });

  expect(write.status).toBe(403);
  expect(write.headers.get("www-authenticate")).toContain(
    'error="insufficient_scope", scope="notes:write"',
  );
});

test("rejects legacy protocols and dynamic client registration", async ({ page, baseURL }) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const { credentials } = await authorize(page, origin, "notes:read");

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
    "notes:read notes:write offline_access",
  );
  const initial = Schema.decodeUnknownSync(RefreshCredentials)(credentials);

  const response = await exchangeRefreshToken(authorization, initial.refresh_token);
  expect(response.status).toBe(200);
  const rotated = Schema.decodeUnknownSync(RefreshCredentials)(await response.json());
  const tools = await mcpClient(mcpEndpoint(origin), rotated.access_token).request("tools/call", {
    name: "list_notes",
    arguments: {},
  });

  expect(rotated.refresh_token).not.toBe(initial.refresh_token);
  expect(tools.status).toBe(200);
  expect(await tools.json()).toMatchObject({ result: { structuredContent: { notes: [] } } });
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
  scope = "notes:read notes:write",
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
  await expect(page.getByText("Connecting to notes-client.test", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Calls itself “Notes test client” — names are not verified.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("https://notes-client.test/client.json", { exact: true }),
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
const NoteResult = Schema.Struct({
  result: Schema.Struct({
    structuredContent: Schema.Struct({ note: Schema.Struct({ id: Schema.String }) }),
  }),
});
const RefreshCredentials = Schema.Struct({
  access_token: Schema.String,
  refresh_token: Schema.String,
});
