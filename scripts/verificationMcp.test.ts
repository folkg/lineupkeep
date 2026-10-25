import { createServer } from "node:http";

import { assert, expect, it } from "vitest";

import { discoverAuthorization, mcpClient } from "#e2e/mcpClient.ts";

it("decodes tool discovery and calls while preserving raw protocol responses", async () => {
  await using server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.on("end", () => {
      if (request.url !== "/agent/channel") {
        response.writeHead(404).end();
        return;
      }
      response.setHeader("content-type", "application/json");
      response.end(
        body.includes("tools/list")
          ? JSON.stringify({
              result: { tools: [{ name: "echo", inputSchema: { type: "object" } }] },
            })
          : JSON.stringify({
              result: {
                isError: false,
                content: [{ type: "text", text: "hello" }],
                structuredContent: { value: "hello" },
              },
            }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address !== null && typeof address === "object");
  const client = mcpClient(`http://127.0.0.1:${address.port}/agent/channel`, "memory-only-token");
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["echo"]);
  expect(await client.callTool("echo", { value: "hello" })).toMatchObject({
    isError: false,
    structuredContent: { value: "hello" },
  });
  expect((await client.request("tools/list")).status).toBe(200);
});

it("discovers authorization from the configured endpoint's challenge without guessing metadata paths", async () => {
  const endpoint = "https://app.test/agent/channel";
  const resourceMetadata = "https://metadata.test/resources/channel.json";
  const issuer = "https://identity.test/tenant";
  const responses = new Map([
    [
      endpoint,
      () =>
        Response.json(
          { error: "unauthorized" },
          {
            status: 401,
            headers: { "www-authenticate": `Bearer resource_metadata="${resourceMetadata}"` },
          },
        ),
    ],
    [
      resourceMetadata,
      () => Response.json({ resource: endpoint, authorization_servers: [issuer] }),
    ],
    [
      "https://identity.test/.well-known/oauth-authorization-server/tenant",
      () =>
        Response.json({
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
        }),
    ],
  ]);

  const discovery = await discoverAuthorization(endpoint, (url) => {
    const response = responses.get(String(url));
    if (response === undefined) {
      throw new Error(`Unexpected discovery URL: ${String(url)}`);
    }
    return Promise.resolve(response());
  });

  expect(discovery).toEqual({
    resource: endpoint,
    authorizationEndpoint: `${issuer}/authorize`,
    tokenEndpoint: `${issuer}/token`,
  });
});

it("rejects protocol errors from typed calls while preserving them through raw access", async () => {
  const error = {
    jsonrpc: "2.0",
    id: "request",
    error: { code: -32602, message: "Invalid arguments" },
  };
  const client = mcpClient("https://app.test", "memory-only", () =>
    Promise.resolve(Response.json(error, { status: 400 })),
  );

  await expect(client.listTools()).rejects.toThrow();
  await expect(client.callTool("echo", {})).rejects.toThrow();
  const raw = await client.request("tools/call", { name: "echo", arguments: {} });
  expect(raw.status).toBe(400);
  expect(await raw.json()).toEqual(error);
});
