import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

import { type Page, expect, test, type TestInfo } from "@playwright/test";
import { Schema } from "effect";

import { namePage, pagePersona } from "./persona.ts";
import { mcpExchangeName } from "./verify/mcpEvidence.ts";
import { CallObserver } from "./verify/performance.ts";
import { redactEvidence } from "./verify/redaction.ts";
export function mcpClient(
  endpoint: string | URL,
  token?: string,
  transport: McpTransport = fetch,
): {
  request: (
    method: string,
    params?: Record<string, unknown>,
    version?: string,
  ) => Promise<Response>;
  listTools: () => Promise<{
    readonly tools: readonly {
      readonly name: string;
      readonly inputSchema: {
        readonly [x: string]: unknown;
      };
      readonly description?: string | undefined;
    }[];
  }>;
  callTool: (
    name: string,
    arguments_: Record<string, unknown>,
  ) => Promise<{
    readonly isError?: boolean | undefined;
    readonly content: readonly {
      readonly [x: string]: unknown;
    }[];
    readonly structuredContent?:
      | {
          readonly [x: string]: unknown;
        }
      | undefined;
  }>;
} {
  const request = (
    method: string,
    params: Record<string, unknown> = {},
    version = "2026-07-28",
  ): Promise<Response> =>
    transport(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "mcp-protocol-version": version,
        "mcp-method": method,
        ...(typeof params["name"] === "string" ? { "mcp-name": params["name"] } : {}),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: randomUUID(),
        method,
        params: {
          ...params,
          _meta: {
            "io.modelcontextprotocol/protocolVersion": version,
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    });
  return {
    request,
    listTools: async () =>
      Schema.decodeUnknownSync(ToolsResponse)(await (await request("tools/list")).json()).result,
    callTool: async (name: string, arguments_: Record<string, unknown>) =>
      Schema.decodeUnknownSync(ToolResponse)(
        await (await request("tools/call", { name, arguments: arguments_ })).json(),
      ).result,
  };
}

export async function beginAuthorization(
  page: Page,
  endpoint: string | URL,
  scope: string,
  transport: McpTransport = fetch,
  requestedClientId: string = clientId,
): Promise<{
  clientId: string;
  verifier: string;
  state: `${string}-${string}-${string}-${string}-${string}`;
  tokenEndpoint: string;
  resource: string;
  clientAddress: string;
}> {
  const discovery = await discoverAuthorization(endpoint, transport);
  const verifier = randomBytes(32).toString("base64url");
  const state = randomUUID();
  const authorization = new URL(discovery.authorizationEndpoint);
  authorization.search = new URLSearchParams({
    response_type: "code",
    client_id: requestedClientId,
    redirect_uri: callback,
    resource: discovery.resource,
    scope,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  await page.route(`${callback}**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/plain",
      body: "Authorization returned to client.",
    }),
  );
  await page.goto(authorization.href);
  return {
    clientId: requestedClientId,
    verifier,
    state,
    tokenEndpoint: discovery.tokenEndpoint,
    resource: discovery.resource,

    clientAddress: `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`,
  };
}

export async function exchangeCode(
  page: Page,
  authorization: Awaited<ReturnType<typeof beginAuthorization>>,
  transport: McpTransport = fetch,
): Promise<{
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly scope: string;
  readonly expires_in?: number | undefined;
  readonly refresh_token?: string | undefined;
}> {
  const returned = new URL(page.url());
  if (returned.searchParams.get("state") !== authorization.state) {
    throw new Error("OAuth state mismatch");
  }
  const code = returned.searchParams.get("code");
  if (code === null) {
    throw new Error(
      `OAuth did not return a code: ${returned.searchParams.get("error") ?? "no error"}`,
    );
  }
  const response = await transport(authorization.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": authorization.clientAddress,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: authorization.clientId,
      redirect_uri: callback,
      code,
      code_verifier: authorization.verifier,
      resource: authorization.resource,
    }),
  });
  if (!response.ok) {
    throw new Error(`OAuth token exchange failed (${response.status})`);
  }
  return Schema.decodeUnknownSync(
    Schema.Struct({
      access_token: Schema.String,
      token_type: Schema.Literal("Bearer"),
      scope: Schema.String,
      expires_in: Schema.optional(Schema.Finite),
      refresh_token: Schema.optional(Schema.String),
    }),
  )(await response.json());
}

export async function registerPublicClientDetails(
  origin: string,
  clientName: string,
): Promise<{ readonly clientId: string; readonly scope: string }> {
  const response = await fetch(new URL("/api/auth/oauth2/register", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: clientName,
      redirect_uris: [callback],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
    }),
  });
  if (response.status !== 201) {
    throw new Error(`Public client registration failed (${response.status})`);
  }
  const body = Schema.decodeUnknownSync(
    Schema.Struct({
      client_id: Schema.String,
      client_secret: Schema.optional(Schema.String),
      scope: Schema.String,
    }),
  )(await response.json());
  if (body.client_secret !== undefined) {
    throw new Error("Public client registration returned a client secret");
  }
  return { clientId: body.client_id, scope: body.scope };
}

export function exchangeRefreshToken(
  authorization: Awaited<ReturnType<typeof beginAuthorization>>,
  refreshToken: string,
): Promise<Response> {
  return fetch(authorization.tokenEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "x-forwarded-for": authorization.clientAddress,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: authorization.clientId,
      resource: authorization.resource,
      refresh_token: refreshToken,
    }),
  });
}

export async function discoverAuthorization(
  endpoint: string | URL,
  transport: McpTransport = fetch,
): Promise<{
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
}> {
  const challenge = await mcpClient(endpoint, undefined, transport).request("tools/list");
  const metadataUrl = /\bresource_metadata="([^"]+)"/iu.exec(
    challenge.headers.get("www-authenticate") ?? "",
  )?.[1];
  if (challenge.status !== 401 || metadataUrl === undefined) {
    throw new Error("MCP discovery requires a 401 resource_metadata challenge.");
  }
  const response = await transport(new URL(metadataUrl));
  const resource = Schema.decodeUnknownSync(ResourceMetadata)(await response.json());
  const issuer = new URL(resource.authorization_servers[0] ?? "");
  const discovery = await transport(
    new URL(`/.well-known/oauth-authorization-server${issuer.pathname}`, issuer),
  );
  const metadata = Schema.decodeUnknownSync(AuthorizationMetadata)(await discovery.json());
  return {
    resource: resource.resource,
    authorizationEndpoint: metadata.authorization_endpoint,
    tokenEndpoint: metadata.token_endpoint,
  };
}

export const callback = "http://127.0.0.1:19999/callback";

const clientId = "https://connections-client.test/client.json";

const ResourceMetadata = Schema.Struct({
  resource: Schema.String,
  authorization_servers: Schema.Array(Schema.String),
});

const AuthorizationMetadata = Schema.Struct({
  authorization_endpoint: Schema.String,
  token_endpoint: Schema.String,
});

const ToolsResponse = Schema.Struct({
  result: Schema.Struct({
    tools: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        inputSchema: Schema.Record(Schema.String, Schema.Unknown),
        description: Schema.optional(Schema.String),
      }),
    ),
  }),
});

const ToolResponse = Schema.Struct({
  result: Schema.Struct({
    isError: Schema.optional(Schema.Boolean),
    content: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
    structuredContent: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  }),
});

export function mcpEndpoint(origin: string): URL {
  return new URL("/mcp", origin);
}

export function authorizedMcp(
  primaryPage: Page,
  endpoint: URL,
  info: TestInfo,
  signIn: (page: Page, account: { readonly email: string }) => Promise<void>,
  observer = new CallObserver(),
): AuthorizeMcp {
  let sequence = 0;
  return (scopes, actor = primaryPage) => {
    const page = typeof actor === "string" ? primaryPage : actor;
    const persona = typeof actor === "string" ? actor : pagePersona(page);
    namePage(page, persona);
    const transport: McpTransport = (url, init) =>
      observer.call(
        "mcp",
        new Headers(init?.headers).get("mcp-method") ?? init?.method ?? "GET",
        async (traceparent) => {
          const traceId = traceparent.split("-")[1];
          const headers = new Headers(init?.headers);
          headers.set("traceparent", traceparent);
          const body = typeof init?.body === "string" ? init.body : init?.body?.toString();
          const rpc: unknown =
            headers.get("content-type") === "application/json" && body !== undefined
              ? JSON.parse(body)
              : undefined;
          const response = await fetch(url, { ...init, headers });
          const responseBody: unknown =
            response.headers.get("content-type")?.includes("application/json") === true
              ? await response.clone().json()
              : await response.clone().text();
          const exchange = redactEvidence({
            persona,
            method: init?.method ?? "GET",
            url: String(url),
            rpcMethod: headers.get("mcp-method") ?? undefined,
            tool: headers.get("mcp-name") ?? undefined,
            arguments:
              rpc === undefined
                ? undefined
                : Schema.decodeUnknownSync(Invocation)(rpc).params.arguments,
            traceId,
            request: { headers: Object.fromEntries(headers), body: rpc ?? body },
            status: response.status,
            response: {
              headers: Object.fromEntries(response.headers),
              body: responseBody,
            },
          });
          await info.attach(
            mcpExchangeName(++sequence, headers.get("mcp-method") ?? init?.method ?? "GET"),
            {
              body: JSON.stringify(exchange, null, 2),
              contentType: "application/json",
            },
          );
          return response;
        },
      );
    return test.step(`Setup (mcp) [${persona}]: authorize ${scopes.join(" ")}`, async () => {
      const authorization = await beginAuthorization(page, endpoint, scopes.join(" "), transport);
      if (new URL(page.url()).pathname === "/auth") {
        await signIn(page, { email: `mcp-${randomUUID()}@example.com` });
      }
      await expect(page.getByRole("heading", { name: "Connect a client?" })).toBeVisible();
      await page.getByRole("button", { name: "Allow access", exact: true }).click();
      await expect(page).toHaveURL((url) => url.origin + url.pathname === callback);
      const credentials = await exchangeCode(page, authorization, transport);

      await page.goto("about:blank");
      return mcpClient(endpoint, credentials.access_token, transport);
    });
  };
}

const Invocation = Schema.Struct({
  params: Schema.Struct({ arguments: Schema.optional(Schema.Unknown) }),
});

export type McpTransport = (
  url: string | URL,
  init?: Omit<RequestInit, "body"> & { readonly body?: string | URLSearchParams },
) => Promise<Response>;

type McpClient = ReturnType<typeof mcpClient>;

export type AuthorizeMcp = (
  scopes: ReadonlyArray<string>,
  actor?: string | Page,
) => Promise<McpClient>;
