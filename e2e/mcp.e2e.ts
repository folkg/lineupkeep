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
  expect(anonymous.headers.get("www-authenticate")).toContain(`scope="${onboardingScopes}"`);
  const toolChallenge = await mcpClient(mcpEndpoint(origin)).request("tools/call", {
    name: "set_team_automation",
    arguments: {},
  });
  expect(toolChallenge.status).toBe(401);
  expect(toolChallenge.headers.get("www-authenticate")).toContain('scope="teams:manage"');
  expect(toolChallenge.headers.get("www-authenticate")).not.toContain("feedback:manage");
  expect(toolChallenge.headers.get("www-authenticate")).not.toContain(retiredReadScope);

  const { credentials } = await authorize(
    page,
    origin,
    "fantasy:read",
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
    "propose_transactions",
    "get_transaction_proposal_set",
    "revalidate_transaction_proposal_set",
    "withdraw_transaction_proposal_items",
    "get_pending_trade_offers",
    "set_lineup",
    "get_lineup_runs",
    "set_team_automation",
    "add_team_agent_note",
    "submit_feedback",
    "list_feedback",
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
    _meta: { "io.modelcontextprotocol/serverInfo": { name: "Lineupgrade" } },
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
    [
      "propose_transactions",
      {
        items: [
          {
            team,
            kind: "drop",
            adds: [],
            drops: ["r1.test"],
            reason: "Checking the proposal scope.",
          },
        ],
      },
    ],
    ["get_transaction_proposal_set", { set: randomUUID() }],
    ["revalidate_transaction_proposal_set", { set: randomUUID() }],
    ["withdraw_transaction_proposal_items", { set: randomUUID(), items: [randomUUID()] }],
    ["get_pending_trade_offers", { team }],
    [
      "set_lineup",
      { requestId: randomUUID(), teams: [{ team, period: { coverage: "week", week: 3 } }] },
    ],
    ["get_lineup_runs", {}],
    ["set_team_automation", { teams: [{ team, action: "enable" }] }],
    ["add_team_agent_note", { team, body: "Scope probe." }],
    [
      "submit_feedback",
      { kind: "friction", title: "Scope probe", body: "Checking the feedback surface." },
    ],
    ["list_feedback", { limit: 5 }],
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
  await services.exercise(
    page,
    "link the provider fake and discover teams",
    "connectYahooAndDiscoverTeams",
    {},
  );
  const { credentials } = await authorize(page, origin);
  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);

  const listed = await client.callTool("list_connections", {});

  expect(listed.isError).toBe(false);
  expect(listed.structuredContent).toMatchObject({
    connections: [{ provider: decodeProviderKey("yahoo"), status: "ready" }],
  });
  expect(JSON.stringify(listed.structuredContent)).not.toContain("userId");

  const other = await newUser();
  await signUp(other);
  const otherAuthorization = await authorize(other, origin);
  const otherClient = mcpClient(mcpEndpoint(origin), otherAuthorization.credentials.access_token);
  const hidden = await otherClient.callTool("list_connections", {});

  expect(hidden.structuredContent).toEqual({ connections: [] });
});

test("reports and retrieves feedback for the acting account only", async ({
  page,
  baseURL,
  newUser,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const { credentials } = await authorize(page, origin, onboardingScopes);
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

  const nullContext = await client.callTool("submit_feedback", {
    kind: "friction",
    title: "Null context field",
    body: "The published schema allows a null optional context field.",
    context: { tool: null, surface: "mcp", client: "e2e" },
  });
  expect(nullContext.isError).toBe(false);

  const listed = await client.callTool("list_feedback", { statuses: ["open"], limit: 5 });
  expect(JSON.stringify(listed.structuredContent)).toContain(feedback);

  const other = await newUser();
  await signUp(other);
  const otherAuthorization = await authorize(other, origin, documentedScopes);
  const otherClient = mcpClient(mcpEndpoint(origin), otherAuthorization.credentials.access_token);
  const hidden = await otherClient.callTool("list_feedback", {});

  expect(hidden.structuredContent).toMatchObject({ feedback: [], page: { returned: 0 } });

  await page.goto("/feedback");
  await expect(page.getByText("Roster totals disagree")).toBeVisible();
  await expect(page.getByText("Wrong data · Open")).toBeVisible();
});

test("enforces fantasy read and transaction review scopes over MCP", async ({ page, baseURL }) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const { credentials } = await authorize(page, origin, "lineups:write");
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
  expect(denial.error_description).toContain("fantasy:read");
  expect(denial.error_description).not.toContain("teams:manage");

  const reviewDenied = await client.request("tools/call", {
    name: "propose_transactions",
    arguments: {
      items: [
        {
          team: randomUUID(),
          kind: "drop",
          adds: [],
          drops: ["r1.invalid"],
          reason: "Checking the review scope boundary.",
        },
      ],
    },
  });
  expect(reviewDenied.status).toBe(403);
  expect(reviewDenied.headers.get("www-authenticate")).toContain('scope="transactions:review"');

  const automationDenied = await client.request("tools/call", {
    name: "set_team_automation",
    arguments: { teams: [{ team: randomUUID(), action: "enable" }] },
  });
  expect(automationDenied.status).toBe(403);
  expect(automationDenied.headers.get("www-authenticate")).toContain('scope="teams:manage"');

  const notesDenied = await client.request("tools/call", {
    name: "add_team_agent_note",
    arguments: { team: randomUUID(), body: "Checking the notes scope boundary." },
  });
  expect(notesDenied.status).toBe(403);
  expect(notesDenied.headers.get("www-authenticate")).toContain('scope="notes:write"');

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
  const review = await reviewer.callTool("get_transaction_proposal_set", { set: randomUUID() });
  expect(review.isError).toBe(true);
  expect(JSON.stringify(review)).not.toContain("submit");

  const missingTeam = await client.callTool("set_lineup", {
    requestId: randomUUID(),
    teams: [{ team: randomUUID(), period: { coverage: "week", week: 3 } }],
  });
  expect(missingTeam.isError).toBe(true);
  expect(JSON.stringify(missingTeam)).not.toContain("completed");
});

test("reads on a restricted grant and refuses only the manage tools", async ({ page, baseURL }) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const { credentials } = await authorize(
    page,
    origin,
    "fantasy:read transactions:review lineups:write offline_access",
  );
  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);

  const read = await client.request("tools/call", {
    name: "list_connections",
    arguments: {},
  });
  expect(read.status).toBe(200);

  const automation = await client.request("tools/call", {
    name: "set_team_automation",
    arguments: { teams: [{ team: randomUUID(), action: "enable" }] },
  });
  expect(automation.status).toBe(403);
  expect(automation.headers.get("www-authenticate")).toContain('scope="teams:manage"');

  const submitted = await client.callTool("submit_feedback", {
    kind: "friction",
    title: "Restricted grant",
    body: "A read-only client can still report a problem.",
  });
  expect(submitted.isError).toBe(false);
  expect(JSON.stringify(submitted.structuredContent)).toContain('"status":"open"');
  const feedbackId = Schema.decodeUnknownSync(
    Schema.Struct({ feedback: Schema.Struct({ id: Schema.String }) }),
  )(submitted.structuredContent).feedback.id;

  const listed = await client.callTool("list_feedback", {});
  expect(listed.isError).toBe(false);
  expect(listed.structuredContent).toMatchObject({
    feedback: [{ id: feedbackId, status: "open", title: "Restricted grant" }],
  });
});

test("lists tools and submits feedback on the onboarding grant", async ({ page, baseURL }) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const { credentials } = await authorize(page, origin, onboardingScopes);
  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);

  const tools = await client.request("tools/list");
  const read = await client.request("tools/call", {
    name: "list_connections",
    arguments: {},
  });
  const submitted = await client.callTool("submit_feedback", {
    kind: "data-issue",
    title: "Onboarding grant",
    body: "The minimal first authorization can submit this report.",
  });
  const feedbackId = Schema.decodeUnknownSync(
    Schema.Struct({ feedback: Schema.Struct({ id: Schema.String }) }),
  )(submitted.structuredContent).feedback.id;
  const listed = await client.callTool("list_feedback", {});

  expect(tools.status).toBe(200);
  expect(read.status).toBe(200);
  expect(submitted.isError).toBe(false);
  expect(listed.isError).toBe(false);
  expect(listed.structuredContent).toMatchObject({
    feedback: [{ id: feedbackId, status: "open", title: "Onboarding grant" }],
  });
});

test("serves read tools to a grant minted with the retired connections:read name", async ({
  page,
  baseURL,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const clientId = await registerRetiredScopeClient(page, origin, retiredReadScope);
  const { credentials } = await authorizeLegacy(page, origin, clientId, retiredReadScope);

  expect(credentials.scope.split(" ")).toEqual([retiredReadScope]);

  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);
  const connections = await client.callTool("list_connections", {});
  const teams = await client.callTool("list_teams", {});
  const automation = await client.request("tools/call", {
    name: "set_team_automation",
    arguments: { teams: [{ team: randomUUID(), action: "enable" }] },
  });

  expect(connections.isError).toBe(false);
  expect(teams.isError).toBe(false);
  expect(teams.structuredContent).toMatchObject({ status: "ok", teams: [] });
  expect(automation.status).toBe(403);
  expect(automation.headers.get("www-authenticate")).toContain('scope="teams:manage"');
});

test("proposes transactions without writing to the provider and reads pending offers", async ({
  page,
  baseURL,
  newUser,
  services,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const discovered = Schema.decodeUnknownSync(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
      }),
    ),
  )(
    await services.exercise(
      page,
      "link the provider fake and discover teams",
      "connectYahooAndDiscoverTeams",
      {},
    ),
  );
  const football = discovered.find((team) => team.name === "Embedded Browser Team");
  const hockey = discovered.find((team) => team.name === "Hosted Hockey Team");
  expect(football, "a football team").toBeDefined();
  expect(hockey, "a hockey team").toBeDefined();
  if (football === undefined || hockey === undefined) {
    return;
  }

  const { credentials } = await authorize(page, origin, "fantasy:read transactions:review");
  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);

  const roster = await client.callTool("get_rosters", { team: football.id });
  expect(roster.isError).toBe(false);
  const players = Schema.decodeUnknownSync(
    Schema.Struct({ players: Schema.Array(Schema.Struct({ player: Schema.String })) }),
  )(roster.structuredContent).players;
  expect(players.length).toBeGreaterThan(0);
  const drop = players[0]?.player;
  expect(drop, "a rostered player reference").toBeDefined();
  if (drop === undefined) {
    return;
  }

  const proposed = await client.callTool("propose_transactions", {
    items: [
      {
        team: football.id,
        kind: "drop",
        adds: [],
        drops: [drop],
        reason: "Open a bench spot for the incoming wing.",
      },
    ],
  });
  expect(proposed.isError).toBe(false);
  const set = Schema.decodeUnknownSync(
    Schema.Struct({
      created: Schema.Boolean,
      reviewUrl: Schema.String,
      set: Schema.Struct({ id: Schema.String, closed: Schema.Boolean }),
      items: Schema.Array(Schema.Struct({ outcome: Schema.String })),
    }),
  )(proposed.structuredContent);
  expect(set.created).toBe(true);
  expect(set.set.closed).toBe(false);
  expect(set.reviewUrl).toBe(`${origin}/transactions/${set.set.id}`);
  expect(set.items).toMatchObject([{ outcome: "accepted" }]);

  const repeated = await client.callTool("propose_transactions", {
    items: [
      {
        team: football.id,
        kind: "drop",
        adds: [],
        drops: [drop],
        reason: "Open a bench spot for the incoming wing.",
      },
    ],
  });
  expect(repeated.structuredContent).toMatchObject({
    created: false,
    set: { id: set.set.id },
  });

  const read = await client.callTool("get_transaction_proposal_set", { set: set.set.id });
  expect(read.isError).toBe(false);
  const review = Schema.decodeUnknownSync(
    Schema.Struct({
      teams: Schema.Array(
        Schema.Struct({
          team: Schema.Struct({ id: Schema.String }),
          items: Schema.Array(Schema.Unknown),
        }),
      ),
    }),
  )(read.structuredContent);
  expect(review.teams.map((entry) => entry.team.id).sort()).toEqual(
    [football.id, hockey.id].sort(),
  );
  expect(review.teams.find((entry) => entry.team.id === football.id)?.items).toHaveLength(1);
  expect(review.teams.find((entry) => entry.team.id === hockey.id)?.items).toHaveLength(0);
  expect(JSON.stringify(read)).not.toContain("461.p.90001");

  const other = await newUser();
  await signUp(other);
  const otherAuthorization = await authorize(other, origin, "fantasy:read transactions:review");
  const otherClient = mcpClient(mcpEndpoint(origin), otherAuthorization.credentials.access_token);
  const hidden = await otherClient.callTool("get_transaction_proposal_set", { set: set.set.id });
  expect(hidden.isError).toBe(true);
  expect(JSON.stringify(hidden)).not.toContain("Open a bench spot");

  const offers = await client.callTool("get_pending_trade_offers", { team: hockey.id });
  expect(offers.isError).toBe(false);
  expect(offers.structuredContent).toMatchObject({
    status: "available",
    readOnly: true,
    offers: [
      {
        canRespond: true,
        proposingTeam: { name: "Synthetic Rival" },
        receivingTeam: { name: "Hosted Hockey Team" },
        players: [{ name: "Synthetic Incoming" }],
        picks: [{ round: 3 }],
      },
    ],
  });
  expect(JSON.stringify(offers)).not.toContain("465.p.95001");
});

test("appends an agent note that reads back with its author on the summary and trade read", async ({
  page,
  baseURL,
  services,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const discovered = Schema.decodeUnknownSync(
    Schema.Array(Schema.Struct({ id: Schema.String, name: Schema.String })),
  )(
    await services.exercise(
      page,
      "link the provider fake and discover teams",
      "connectYahooAndDiscoverTeams",
      {},
    ),
  );
  const football = discovered.find((team) => team.name === "Embedded Browser Team");
  const hockey = discovered.find((team) => team.name === "Hosted Hockey Team");
  expect(football, "a football team").toBeDefined();
  expect(hockey, "a hockey team").toBeDefined();
  if (football === undefined || hockey === undefined) {
    return;
  }

  const readOnly = await authorize(page, origin, "fantasy:read");
  const denied = await mcpClient(mcpEndpoint(origin), readOnly.credentials.access_token).request(
    "tools/call",
    {
      name: "add_team_agent_note",
      arguments: { team: hockey.id, body: "A read-only grant must not write." },
    },
  );
  expect(denied.status).toBe(403);
  expect(denied.headers.get("www-authenticate")).toContain('scope="notes:write"');

  const { credentials } = await authorize(page, origin, "fantasy:read notes:write");
  const client = mcpClient(mcpEndpoint(origin), credentials.access_token);

  const first = await client.callTool("add_team_agent_note", {
    team: hockey.id,
    body: "The manager hoards goaltenders before the deadline.",
  });
  expect(first.isError).toBe(false);
  expect(first.structuredContent).toMatchObject({
    team: hockey.id,
    author: {
      clientId: "https://connections-client.test/client.json",
      name: "Lineupgrade test client",
    },
    body: "The manager hoards goaltenders before the deadline.",
  });
  expect(first.structuredContent?.["writtenAt"]).toEqual(expect.any(String));

  await delay(10);
  const second = await client.callTool("add_team_agent_note", {
    team: hockey.id,
    body: "A later note about the same bubble.",
  });
  expect(second.isError).toBe(false);

  const summary = await client.callTool("get_team_summary", {
    team: hockey.id,
    groups: ["league"],
  });
  expect(summary.isError).toBe(false);
  expect(summary.structuredContent).toMatchObject({
    ownerNote: { status: "not_set" },
    agentNotes: [
      {
        author: { name: "Lineupgrade test client" },
        body: "A later note about the same bubble.",
      },
      {
        author: { name: "Lineupgrade test client" },
        body: "The manager hoards goaltenders before the deadline.",
      },
    ],
  });

  const empty = await client.callTool("get_team_summary", {
    team: football.id,
    groups: ["league"],
  });
  expect(empty.isError).toBe(false);
  expect(empty.structuredContent).toMatchObject({ agentNotes: [] });

  const offers = await client.callTool("get_pending_trade_offers", { team: hockey.id });
  expect(offers.isError).toBe(false);
  expect(offers.structuredContent).toMatchObject({
    ownerNote: { status: "not_set" },
    agentNotes: [
      {
        author: {
          clientId: "https://connections-client.test/client.json",
          name: "Lineupgrade test client",
        },
        body: "A later note about the same bubble.",
      },
      {
        author: { name: "Lineupgrade test client" },
        body: "The manager hoards goaltenders before the deadline.",
      },
    ],
  });
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
      {},
    ),
  );
  const team = discovered[0]?.id;
  expect(team, "a discovered team").toBeDefined();
  if (team === undefined) {
    return;
  }

  const readOnly = await authorize(page, origin, "fantasy:read");
  const reader = mcpClient(mcpEndpoint(origin), readOnly.credentials.access_token);
  const denied = await reader.request("tools/call", {
    name: "set_team_automation",
    arguments: { teams: [{ team, action: "enable" }] },
  });
  expect(denied.status).toBe(403);
  expect(denied.headers.get("www-authenticate")).toContain('scope="teams:manage"');

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
  expect(teamAutomation(await client.callTool("list_teams", {}), team)).toMatchObject({
    automation: { status: "disabled" },
  });
});

test("returns access_denied and the original state when consent is denied", async ({
  page,
  baseURL,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const authorization = await beginAuthorization(page, mcpEndpoint(origin), "fantasy:read");
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
  const { credentials } = await authorize(page, origin, "fantasy:read");

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
  expect(isRecord(registered) ? registered["scope"] : undefined).toBe(registrableScopes);
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
    page.getByText("Calls itself “Muse probe”. Names are not verified.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Allow access", exact: true }).click();
  await expect(page).toHaveURL(callbackPattern);

  const credentials = await exchangeCode(page, authorization);
  expect(credentials.scope.split(" ")).toEqual(
    expect.arrayContaining(["fantasy:read", "lineups:write"]),
  );
});

test("rotates refresh credentials over HTTP and replays the previous token", async ({
  page,
  baseURL,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);
  const { credentials, authorization } = await authorize(
    page,
    origin,
    "fantasy:read offline_access",
  );
  const initial = Schema.decodeUnknownSync(IssuedCredentials)(credentials);

  expect(initial.expires_in).toBe(300);
  expect(await advertisedKeyIds(origin)).toContain(jwtHeader(initial.access_token).kid);
  const response = await exchangeRefreshToken(authorization, initial.refresh_token);
  expect(response.status).toBe(200);
  const rotated = Schema.decodeUnknownSync(IssuedCredentials)(await response.json());
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
  expect(
    (await mcpClient(mcpEndpoint(origin), rotated.access_token).callTool("list_connections", {}))
      .isError,
  ).toBe(false);
});

test("issues a refresh token only for a grant that asks for offline_access", async ({
  page,
  baseURL,
}) => {
  const origin = requiredOrigin(baseURL);
  await signUp(page);

  const { credentials: withoutOffline } = await authorize(page, origin, "fantasy:read");
  expect(withoutOffline.refresh_token).toBeUndefined();

  const { credentials: withOffline } = await authorize(page, origin, "fantasy:read offline_access");
  expect(withOffline.refresh_token).toBeDefined();
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
const onboardingScopes = "fantasy:read offline_access";
const documentedScopes =
  "fantasy:read transactions:review lineups:write teams:manage notes:write offline_access";
const retiredReadScope = "connections:read";
const registrableScopes = `${documentedScopes} ${retiredReadScope}`;
const retiredClientName = "Lineupgrade retired scope probe";

async function authorize(
  page: Page,
  origin: string,
  scope = "fantasy:read",
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
    page.getByText("Calls itself “Lineupgrade test client”. Names are not verified.", {
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

async function registerRetiredScopeClient(
  page: Page,
  origin: string,
  scope: string,
): Promise<string> {
  const cookies = await page.context().cookies(origin);
  const response = await fetch(new URL("/api/auth/oauth2/create-client", origin), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
    },
    body: JSON.stringify({
      client_name: retiredClientName,
      redirect_uris: [callback],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      application_type: "native",
      scope,
    }),
  });
  expect(response.status, "a managed client registration").toBe(201);
  const registered = Schema.decodeUnknownSync(
    Schema.Struct({ client_id: Schema.String, scope: Schema.String }),
  )(await response.json());
  expect(registered.scope).toBe(scope);
  return registered.client_id;
}

async function authorizeLegacy(
  page: Page,
  origin: string,
  clientId: string,
  scope: string,
): Promise<{
  credentials: { readonly access_token: string; readonly scope: string };
  authorization: Awaited<ReturnType<typeof beginAuthorization>>;
}> {
  const authorization = await beginAuthorization(page, mcpEndpoint(origin), scope, fetch, clientId);
  await expect(page.getByRole("heading", { name: "Connect a client?" })).toBeVisible();
  await expect(
    page.getByText(`Calls itself “${retiredClientName}”. Names are not verified.`, {
      exact: true,
    }),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
