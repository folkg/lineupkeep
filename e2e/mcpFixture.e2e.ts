import { decodeProviderKey } from "@lineupkeep/backend/connections/ProviderKey";
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
  await services.exercise(
    page,
    "link the provider fake and discover teams",
    "connectYahooAndDiscoverTeams",
    {},
  );
  const ownerClient = await mcp(["fantasy:read"], page);
  const otherClient = await mcp(["fantasy:read"], other);

  const owned = await ownerClient.callTool("list_connections", {});
  const isolated = await otherClient.callTool("list_connections", {});

  expect(owned.isError).toBe(false);
  expect(owned.structuredContent).toMatchObject({
    connections: [{ provider: decodeProviderKey("yahoo"), status: "ready" }],
  });
  expect(isolated.structuredContent).toEqual({ connections: [] });
  const calls = test
    .info()
    .attachments.filter(isMcpExchangeAttachment)
    .map((attachment) => Schema.decodeUnknownSync(McpExchangeJson)(attachment.body?.toString()));
  expect(calls.at(-2)?.persona).toBe("owner");
  expect(calls.at(-1)?.persona).toBe("other");
});
