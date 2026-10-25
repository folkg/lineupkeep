import { randomUUID } from "node:crypto";

import { Schema } from "effect";

import { expect, signUp, test } from "./support";
import { isMcpExchangeAttachment, McpExchangeJson } from "./verify/mcpEvidence";

test("authorizes named browser personas independently through the fixture", async ({
  page,
  newUser,
  mcp,
  services,
}) => {
  await signUp(page, "owner");
  const other = await newUser("other");
  await signUp(other);
  await services.exercise(page, "start the owner's link", "startLinking", {
    requestId: randomUUID(),
    provider: "yahoo",
  });
  const ownerClient = await mcp(["connections:read"], page);
  const otherClient = await mcp(["connections:read"], other);

  const owned = await ownerClient.callTool("list_connections", {});
  const isolated = await otherClient.callTool("list_connections", {});

  expect(owned.isError).toBe(false);
  expect(owned.structuredContent).toMatchObject({
    connections: [{ provider: "yahoo", status: "linking" }],
  });
  expect(isolated.structuredContent).toEqual({ connections: [] });
  const calls = test
    .info()
    .attachments.filter(isMcpExchangeAttachment)
    .map((attachment) => Schema.decodeUnknownSync(McpExchangeJson)(attachment.body?.toString()));
  expect(calls.at(-2)?.persona).toBe("owner");
  expect(calls.at(-1)?.persona).toBe("other");
});

test("authorizes the fixture without feature UI and lists through read scope", async ({
  mcp,
  page,
}) => {
  const reader = await mcp(["connections:read"], "owner");
  await expect(page).toHaveURL("about:blank");
  await test.step("Baseline: discover tools over MCP", async () => {
    expect((await reader.listTools()).tools.map((tool) => tool.name)).toContain("list_connections");
  });
  await test.step("Result: list owned connections with explicit read consent", async () => {
    const listed = await reader.callTool("list_connections", {});

    expect(listed.isError).toBe(false);
    expect(listed.structuredContent).toEqual({ connections: [] });
  });
  const calls = test
    .info()
    .attachments.filter(isMcpExchangeAttachment)
    .map((attachment) => Schema.decodeUnknownSync(McpExchangeJson)(attachment.body?.toString()));
  expect(calls.at(-1)?.persona).toBe("owner");
});
