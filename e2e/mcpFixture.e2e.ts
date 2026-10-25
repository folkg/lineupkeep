import { randomUUID } from "node:crypto";

import { Schema } from "effect";

import { expect, signUp, test } from "./support";
import { isMcpExchangeAttachment, McpExchangeJson } from "./verify/mcpEvidence";

test("authorizes named browser personas independently through the fixture", async ({
  page,
  newUser,
  mcp,
}) => {
  await signUp(page, "owner");
  const other = await newUser("other");
  await signUp(other);
  const ownerClient = await mcp(["notes:read", "notes:write"], page);
  const otherClient = await mcp(["notes:read"], other);

  const created = await ownerClient.callTool("create_note", {
    requestId: randomUUID(),
    title: "Owned",
    body: "Private",
  });
  const isolated = await otherClient.callTool("list_notes", {});

  expect(created.isError).toBe(false);
  expect(isolated.structuredContent).toEqual({ notes: [] });
  const calls = test
    .info()
    .attachments.filter(isMcpExchangeAttachment)
    .map((attachment) => Schema.decodeUnknownSync(McpExchangeJson)(attachment.body?.toString()));
  expect(calls.at(-2)?.persona).toBe("owner");
  expect(calls.at(-1)?.persona).toBe("other");
});

test("authorizes the fixture without feature UI and steps up a read-only client", async ({
  mcp,
  page,
}) => {
  const reader = await mcp(["notes:read"], "owner");
  await expect(page).toHaveURL("about:blank");
  await test.step("Baseline: discover tools over MCP", async () => {
    expect((await reader.listTools()).tools.map((tool) => tool.name)).toContain("create_note");
  });
  await test.step("Result: reject a write without write scope", async () => {
    const response = await reader.request("tools/call", {
      name: "create_note",
      arguments: { requestId: randomUUID(), title: "Denied", body: "Denied" },
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('scope="notes:write"');
  });
  const writer = await mcp(["notes:read", "notes:write"], "owner step-up");
  await test.step("Result: create and read with explicit write consent", async () => {
    const created = await writer.callTool("create_note", {
      requestId: randomUUID(),
      title: "Fixture protocol proof",
      body: "Through real OAuth",
    });
    const listed = await writer.callTool("list_notes", {});

    expect(created.isError).toBe(false);
    expect(listed.structuredContent).toMatchObject({
      notes: [{ title: "Fixture protocol proof", body: "Through real OAuth" }],
    });
    expect((await reader.callTool("list_notes", {})).structuredContent).toEqual(
      listed.structuredContent,
    );
  });
  const calls = test
    .info()
    .attachments.filter(isMcpExchangeAttachment)
    .map((attachment) => Schema.decodeUnknownSync(McpExchangeJson)(attachment.body?.toString()));
  expect(calls.at(-1)?.persona).toBe("owner");
  expect(calls.at(-2)?.persona).toBe("owner step-up");
});
