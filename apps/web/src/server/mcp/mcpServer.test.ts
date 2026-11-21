import { it as effectIt } from "@effect/vitest";
import { AuthService } from "@lineupkeep/backend/auth/Auth";
import type { AccessTokenResolution } from "@lineupkeep/backend/auth/Auth";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { ConnectionPersistenceFailed } from "@lineupkeep/backend/connections/Connection";
import type { ConnectionsShape } from "@lineupkeep/backend/connections/Connections";
import { Connections } from "@lineupkeep/backend/connections/Connections";
import type { FantasyQueriesShape } from "@lineupkeep/backend/connections/FantasyQueries";
import { FantasyQueries } from "@lineupkeep/backend/connections/FantasyQueries";
import { TeamId, decodeTeamId } from "@lineupkeep/backend/connections/FantasyTeam";
import { LineupRunId } from "@lineupkeep/backend/connections/LineupRun";
import type { LineupSubmitData } from "@lineupkeep/backend/connections/LineupRun";
import type { LineupRunsShape } from "@lineupkeep/backend/connections/LineupRuns";
import { LineupRuns } from "@lineupkeep/backend/connections/LineupRuns";
import { decodeProviderKey } from "@lineupkeep/backend/connections/ProviderKey";
import {
  LeagueData,
  RosterData,
  SearchPlayersData,
  TeamSummaryData,
  TransactionsData,
} from "@lineupkeep/backend/connections/QueryResults";
import {
  PlayerRef,
  QueryCursorInvalid,
  QuerySelectionInvalid,
  QueryTeam,
} from "@lineupkeep/backend/connections/QueryValues";
import type { TeamsShape } from "@lineupkeep/backend/connections/Teams";
import { Teams } from "@lineupkeep/backend/connections/Teams";
import type { TransactionOffersShape } from "@lineupkeep/backend/connections/TransactionOffers";
import {
  TransactionOffers,
  TransactionOffersPersistenceFailed,
} from "@lineupkeep/backend/connections/TransactionOffers";
import type {
  TransactionMoveList,
  TransactionMoveTeam,
  TransactionPlanServiceShape,
} from "@lineupkeep/backend/connections/TransactionPlans";
import {
  TransactionMoveId,
  TransactionPlanMoveNotFound,
  TransactionPlanPersistenceFailed,
  TransactionPlanService,
} from "@lineupkeep/backend/connections/TransactionPlans";
import {
  Feedback,
  FeedbackContentInvalid,
  FeedbackId,
  FeedbackRateLimited,
} from "@lineupkeep/backend/feedback/Feedback";
import type { FeedbackShape } from "@lineupkeep/backend/feedback/Feedback";
import { FeedbackPersistenceFailed } from "@lineupkeep/backend/feedback/Feedback";
import jsonTools from "@lineupkeep/backend/runtime/JsonText";
import layerTools from "@lineupkeep/backend/runtime/ProvideLayer";
import { ToolCallQuota, toolCallLimits } from "@lineupkeep/backend/toolCalls/ToolCallQuota";
import type { ToolCall } from "@lineupkeep/backend/toolCalls/ToolCallQuota";
import { DateTime, Duration, Effect, Layer, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { expect, it } from "vitest";

import { mcpRequest } from "./mcpEndpoint";
import { handleMcpRequest } from "./mcpServer";
import { RequiredScope } from "./toolAuthorization";

const DiscoveryDocument = Schema.Struct({
  result: Schema.Struct({
    _meta: Schema.Record(Schema.String, Schema.Unknown),
    capabilities: Schema.Record(Schema.String, Schema.Unknown),
  }),
});

const GrantReport = Schema.Struct({
  accessTokenLifetimeSeconds: Schema.Finite,
  refreshTokenGrantSupported: Schema.Boolean,
  accessToken: Schema.optional(
    Schema.Union([
      Schema.Struct({
        status: Schema.Literal("active"),
        expiresAt: Schema.String,
        expiresInSeconds: Schema.Finite,
      }),
      Schema.Struct({ status: Schema.Literal("rejected") }),
    ]),
  ),
});

const ToolErrorResult = Schema.Struct({
  result: Schema.Struct({
    isError: Schema.Boolean,
    content: Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.String })),
  }),
});

const ToolFailure = Schema.Struct({ code: Schema.String, message: Schema.String });

it("identifies the product during protocol discovery", async () => {
  const response = await handle(request("server/discover", {}, "read"));

  expect(response.status).toBe(200);
  const body = Effect.runSync(Schema.decodeUnknownEffect(DiscoveryDocument)(await response.json()));
  expect(body.result._meta["io.modelcontextprotocol/serverInfo"]).toEqual({
    name: "Lineupgrade",
    version: "1.0.0",
  });
  expect(body.result.capabilities).toEqual({ tools: {} });
});

it("publishes the grant lifetime and the presented token's expiry during protocol discovery", async () => {
  const anonymous = await handle(request("server/discover"));
  const authenticated = await handle(request("server/discover", {}, "read"));
  const expired = await handle(request("server/discover", {}, "expired"));

  expect(anonymous.status).toBe(200);
  expect(authenticated.status).toBe(200);
  const anonymousDocument = Effect.runSync(
    Schema.decodeUnknownEffect(DiscoveryDocument)(await anonymous.json()),
  );
  const authenticatedDocument = Effect.runSync(
    Schema.decodeUnknownEffect(DiscoveryDocument)(await authenticated.json()),
  );
  expect(anonymousDocument.result._meta["lineupkeep/grant"]).toEqual({
    accessTokenLifetimeSeconds: 300,
    refreshTokenGrantSupported: true,
  });
  const grant = Effect.runSync(
    Schema.decodeUnknownEffect(GrantReport)(authenticatedDocument.result._meta["lineupkeep/grant"]),
  );
  expect(grant.accessTokenLifetimeSeconds).toBe(300);
  expect(grant.refreshTokenGrantSupported).toBe(true);
  if (grant.accessToken?.status !== "active") {
    throw new Error("Expected discovery to report the presented access token as active");
  }
  expect(grant.accessToken.expiresInSeconds).toBeGreaterThan(0);
  expect(grant.accessToken.expiresInSeconds).toBeLessThanOrEqual(120);
  expect(DateTime.makeUnsafe(grant.accessToken.expiresAt).epochMilliseconds).toBeGreaterThan(
    DateTime.nowUnsafe().epochMilliseconds,
  );
  expect(
    Effect.runSync(
      Schema.decodeUnknownEffect(GrantReport)(
        Effect.runSync(Schema.decodeUnknownEffect(DiscoveryDocument)(await expired.json())).result
          ._meta["lineupkeep/grant"],
      ),
    ).accessToken,
  ).toEqual({ status: "rejected" });
  expect(anonymousDocument.result.capabilities).toEqual(authenticatedDocument.result.capabilities);
  expect(anonymousDocument.result._meta["io.modelcontextprotocol/serverInfo"]).toEqual(
    authenticatedDocument.result._meta["io.modelcontextprotocol/serverInfo"],
  );
});

it.each(["2025-03-26", "2025-11-25"])(
  "rejects unsupported protocol %s for token-free discovery",
  async (version) => {
    const response = await handle(request("server/discover", {}, undefined, version));

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: { code: -32_022, data: { requested: version } },
    });
  },
);

it("derives the endpoint path and discovery challenge from the Auth resource", async () => {
  const tools = Toolkit.make();
  const run = (invocation: Request): Promise<Response> =>
    Effect.runPromise(
      mcpRequest(invocation, tools, () => Layer.empty, { name: "Example", version: "1" }).pipe(
        Effect.updateService(AuthService, (auth) => ({
          ...auth,
          oauthResource: "https://connections.example/agents",
        })),
        layerTools.provide(Layer.merge(authentication, permissiveQuota)),
      ),
    );
  const input = request("tools/list", {}, "read");
  const invocation = new Request("https://connections.example/agents", {
    method: "POST",
    headers: input.headers,
    body: await input.text(),
  });

  const challenged = await run(
    new Request("https://connections.example/agents", { method: "POST" }),
  );
  const served = await run(invocation);

  expect(challenged.status).toBe(401);
  expect(challenged.headers.get("www-authenticate")).toContain(
    "/.well-known/oauth-protected-resource/agents",
  );
  expect(served.status).toBe(200);
  expect(await served.json()).toMatchObject({ result: { tools: [] } });
});

it("serves composed feature toolkits without requiring connection services", async () => {
  const reads = Toolkit.make(
    Tool.make("echo", {
      parameters: Schema.Struct({ value: Schema.String }),
      success: Schema.Struct({ value: Schema.String }),
    }).annotate(RequiredScope, { name: "example:read", description: "Read examples." }),
  );
  const writes = Toolkit.make(
    Tool.make("change", { success: Schema.String }).annotate(RequiredScope, {
      name: "example:write",
      description: "Change examples.",
    }),
  );
  const tools = Toolkit.merge(reads, writes);
  const handlers = (): Layer.Layer<Tool.Handler<"change"> | Tool.Handler<"echo">, never, never> =>
    Layer.mergeAll(
      reads.toLayer({ echo: ({ value }) => Effect.succeed({ value }) }),
      writes.toLayer({ change: () => Effect.succeed("changed") }),
    );
  const run = (invocation: Request): Promise<Response> =>
    Effect.runPromise(
      mcpRequest(invocation, tools, handlers, { name: "Example", version: "1" }).pipe(
        layerTools.provide(Layer.merge(authentication, permissiveQuota)),
      ),
    );

  const listing = await run(request("tools/list", {}, "read"));
  const echo = await run(
    request("tools/call", { name: "echo", arguments: { value: "hello" } }, "read"),
  );
  const rejected = await run(request("tools/call", { name: "change", arguments: {} }, "read"));

  expect(await listing.json()).toMatchObject({
    result: { tools: [{ name: "echo" }, { name: "change" }] },
  });
  expect(await echo.json()).toMatchObject({
    result: { isError: false, structuredContent: { value: "hello" } },
  });
  expect(rejected.status).toBe(403);
  expect(rejected.headers.get("www-authenticate")).toContain('scope="example:write"');
});

it("challenges an unauthenticated client with protected-resource discovery and a minimal onboarding grant", async () => {
  const response = await handle(request("tools/list"));
  const body = await json(response);

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBe(
    'Bearer resource_metadata="https://connections.example/.well-known/oauth-protected-resource/mcp", scope="fantasy:read offline_access"',
  );
  expect(body).toMatchObject({
    error: "unauthorized",
    scope: "fantasy:read offline_access",
    resource_metadata: "https://connections.example/.well-known/oauth-protected-resource/mcp",
  });
  expect(jsonTools.jsonString(body)).not.toContain("teams:manage");
});

it("names an expired presented token as invalid_token so a client refreshes instead of authorizing again", async () => {
  const response = await handle(request("tools/list", {}, "expired"));
  const body = await json(response);

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBe(
    'Bearer resource_metadata="https://connections.example/.well-known/oauth-protected-resource/mcp", error="invalid_token", scope="fantasy:read offline_access"',
  );
  expect(body).toMatchObject({
    error: "invalid_token",
    error_code: "token_expired",
    scope: "fantasy:read offline_access",
    resource_metadata: "https://connections.example/.well-known/oauth-protected-resource/mcp",
  });
  expect(jsonTools.jsonString(body)).toContain("refresh token");
});

it("names an invalid non-expired token as terminal so a client authorizes again", async () => {
  const response = await handle(request("tools/list", {}, "invalid"));
  const body = await json(response);

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toContain('error="invalid_token"');
  expect(body).toMatchObject({
    error: "invalid_token",
    error_code: "token_invalid",
  });
  expect(jsonTools.jsonString(body)).not.toContain("token_expired");
});

it("names only the calling tool's missing scope in a 403 body", async () => {
  const response = await handle(
    request(
      "tools/call",
      {
        name: "set_team_automation",
        arguments: { teams: [{ team: "018f79ea-7d86-7c18-9b4a-8b4d0c9164b3", action: "enable" }] },
      },
      "restricted",
    ),
  );
  const body = await json(response);

  expect(response.status).toBe(403);
  expect(response.headers.get("www-authenticate")).toContain('scope="teams:manage"');
  expect(body).toMatchObject({ error: "insufficient_scope", scope: "teams:manage" });
  expect(jsonTools.jsonString(body)).not.toContain("transactions:review");
  expect(jsonTools.jsonString(body)).not.toContain("fantasy:read");
});

it("reads on the restricted grant and refuses only the automation tool", async () => {
  const listing = await handle(request("tools/list", {}, "restricted"));
  const read = await handle(
    request("tools/call", { name: "list_connections", arguments: {} }, "restricted"),
  );
  const automation = await handle(
    request(
      "tools/call",
      {
        name: "set_team_automation",
        arguments: { teams: [{ team: "018f79ea-7d86-7c18-9b4a-8b4d0c9164b3", action: "enable" }] },
      },
      "restricted",
    ),
  );

  expect(listing.status).toBe(200);
  expect(read.status).toBe(200);
  expect(automation.status).toBe(403);
  expect(automation.headers.get("www-authenticate")).toContain('scope="teams:manage"');
});

it("asks the auth service only for the calling tool's scope", async () => {
  const requested: Array<ReadonlyArray<string>> = [];
  const tools = Toolkit.make(
    Tool.make("echo", { success: Schema.String }).annotate(RequiredScope, {
      name: "example:read",
      description: "Read examples.",
    }),
    Tool.make("change", { success: Schema.String }).annotate(RequiredScope, {
      name: "example:write",
      description: "Change examples.",
    }),
  );
  const run = (invocation: Request): Promise<Response> =>
    Effect.runPromise(
      mcpRequest(
        invocation,
        tools,
        () =>
          tools.toLayer({
            echo: () => Effect.succeed("read"),
            change: () => Effect.succeed("changed"),
          }),
        { name: "Example", version: "1" },
      ).pipe(
        layerTools.provide(
          Layer.merge(
            Layer.succeed(AuthService)({
              signInMethods: { google: false },
              oauthResource: "https://connections.example/mcp",
              onboardingScopes: [{ name: "example:read", description: "Read examples." }],
              accessTokenLifetime: Duration.minutes(5),
              getConsentRequest: () => Effect.succeed({ status: "invalid" as const }),
              consent: () => Effect.succeed("https://client.test/callback"),
              handle: () => Effect.succeed(new Response()),
              getSession: () => Effect.void.pipe(Effect.as(undefined)),
              resolveAccessToken: (_token, scopes) => {
                requested.push(scopes);
                return Effect.succeed(signedInGrant());
              },
            }),
            permissiveQuota,
          ),
        ),
      ),
    );

  await run(request("tools/call", { name: "echo", arguments: {} }, "granted"));
  await run(request("tools/call", { name: "change", arguments: {} }, "granted"));

  expect(requested).toEqual([["example:read"], ["example:write"]]);
});

it("refuses a token that grants no scopes", async () => {
  const response = await handle(
    request("tools/call", { name: "list_connections", arguments: {} }, "none"),
  );

  expect(response.status).toBe(403);
  expect(response.headers.get("www-authenticate")).toContain('scope="fantasy:read"');
});

effectIt.effect(
  "refuses a call over its allowance with Retry-After and records rejected with the tool name",
  () =>
    Effect.gen(function* () {
      const tools = rateLimitedToolkit;
      const consumed: Array<ToolCall> = [];
      const quota = Layer.succeed(ToolCallQuota)({
        consume: (call) => {
          consumed.push(call);
          return Effect.succeed({
            allowed: false as const,
            callClass: "read" as const,
            bucket: "client" as const,
            limit: toolCallLimits.read,
            retryAfter: Duration.seconds(45),
          });
        },
      });
      const observation = yield* Effect.gen(function* () {
        const response = yield* mcpRequest(
          request("tools/call", { name: "echo", arguments: {} }, "read"),
          tools,
          () => tools.toLayer({ echo: () => Effect.succeed("ok") }),
          { name: "Example", version: "1" },
        ).pipe(layerTools.provide(Layer.merge(authentication, quota)));
        const span = yield* Effect.currentSpan;
        const body = yield* Effect.promise(() => response.json() as Promise<unknown>);
        return { response, body, attributes: span.attributes };
      }).pipe(Effect.withSpan("test.tool_call_refusal"));

      expect(observation.response.status).toBe(429);
      expect(observation.response.headers.get("retry-after")).toBe("45");
      expect(observation.body).toMatchObject({
        jsonrpc: "2.0",
        id: 1,
        error: {
          code: -32_001,
          data: {
            reason: "tool_call_quota_exhausted",
            class: "read",
            bucket: "client",
            limit: 60,
            windowSeconds: 60,
            retryAfterSeconds: 45,
          },
        },
      });
      const refusal = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ error: Schema.Struct({ message: Schema.String }) }),
      )(observation.body);
      expect(refusal.error.message).toContain("Retry in 45 seconds");
      expect(observation.attributes.get("app.outcome")).toBe("rejected");
      expect(observation.attributes.get("mcp.tool.name")).toBe("echo");
      expect(consumed).toEqual([
        { userId: decodeUserId("reader"), clientId: undefined, callClass: "read" },
      ]);
    }),
);

it("spends the allowance for a failing tool, an invalid call, and an unknown tool", async () => {
  const consumed: Array<ToolCall> = [];
  const quota = Layer.succeed(ToolCallQuota)({
    consume: (call) => {
      consumed.push(call);
      return Effect.succeed({ allowed: true as const });
    },
  });
  const run = (invocation: Request): Promise<Response> => handle(invocation, undefined, quota);

  const anonymous = await run(request("tools/call", { name: "list_teams", arguments: {} }));
  expect(anonymous.status).toBe(401);
  expect(consumed).toEqual([]);

  await run(request("tools/list", {}, "read"));
  expect(consumed).toEqual([]);

  const failing = await run(request("tools/call", { name: "list_teams", arguments: {} }, "read"));
  const invalid = await run(
    request("tools/call", { name: "list_connections", arguments: { limit: 1 } }, "read"),
  );
  const missing = await run(request("tools/call", { name: "missing", arguments: {} }, "read"));

  expect(failing.status).toBe(200);
  expect(await json(failing)).toMatchObject({ result: { isError: true } });
  expect(invalid.status).toBe(400);
  expect(missing.status).not.toBe(429);
  expect(consumed.map((call) => call.callClass)).toEqual(["read", "read", "write"]);
});

it.each(["2025-03-26", "2025-06-18", "2025-11-25"])(
  "rejects legacy protocol %s without creating a session",
  async (version) => {
    const response = await handle(request("tools/list", {}, "write", version));

    expect(response.status).toBe(400);
    expect(response.headers.has("mcp-session-id")).toBe(false);
  },
);

it("lists only the read-only connection tool without exposing account identity", async () => {
  const response = await handle(request("tools/list", {}, "read"));
  const body = await json(response);

  expect(response.status).toBe(200);
  expect(jsonTools.jsonString(body)).toContain('"readOnlyHint":true');
  expect(jsonTools.jsonString(body)).not.toContain('"userId"');
  const decoded = Effect.runSync(
    Schema.decodeUnknownEffect(
      Schema.Struct({
        result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
      }),
    )(body),
  );
  expect(decoded.result.tools.map((tool) => tool.name)).toEqual([
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
    "get_pending_trade_offers",
    "list_transaction_proposals",
    "get_transaction_plan",
    "discard_transaction_move",
    "get_team_snapshot",
    "set_lineup",
    "get_lineup_runs",
    "set_team_automation",
    "add_team_agent_note",
    "submit_feedback",
    "list_feedback",
  ]);
});

it("composes the team snapshot from the reads in one tool call", async () => {
  const team = decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c9164b5");
  const teamView = Effect.runSync(
    Schema.decodeEffect(QueryTeam)({
      id: team,
      name: "Alpha",
      provider: "yahoo",
      league: "nhl",
      sport: "hockey",
      season: 2026,
    }),
  );
  const page = { returned: 0, complete: true, remaining: 0 } as const;
  const budget = { targetBytes: 28 * 1024, hardLimitBytes: 32 * 1024 } as const;
  const queries: FantasyQueriesShape = {
    ...unavailableQueries,
    getTeamSummary: () =>
      Effect.succeed(
        Effect.runSync(
          Schema.decodeEffect(TeamSummaryData)({
            status: "ok",
            team: teamView,
            ownerNote: { status: "not_set" },
            agentNotes: [],
            coverage: [],
            failures: [],
            page,
            budget,
          }),
        ),
      ),
    getLeague: () =>
      Effect.succeed(
        Effect.runSync(
          Schema.decodeEffect(LeagueData)({
            status: "ok",
            team: teamView,
            coverage: [],
            failures: [],
            page,
            budget,
          }),
        ),
      ),
    getRosters: () =>
      Effect.succeed(
        Effect.runSync(
          Schema.decodeEffect(RosterData)({
            status: "ok",
            scope: "team",
            team: teamView,
            players: [],
            coverage: [],
            failures: [],
            page,
            budget,
          }),
        ),
      ),
    getTransactions: () =>
      Effect.succeed(
        Effect.runSync(
          Schema.decodeEffect(TransactionsData)({
            status: "ok",
            team: teamView,
            transactions: [],
            window: { fetched: 0, truncated: false },
            coverage: [],
            failures: [],
            page,
            budget,
          }),
        ),
      ),
    searchPlayers: () =>
      Effect.succeed(
        Effect.runSync(
          Schema.decodeEffect(SearchPlayersData)({
            status: "ok",
            team: teamView,
            players: [],
            coverage: [],
            failures: [],
            page,
            budget,
          }),
        ),
      ),
  };
  const plans = {
    ...unavailablePlans,
    plan: () => Effect.fail(TransactionPlanPersistenceFailed.make({ cause: new Error("plan") })),
  };
  const offers = {
    readPendingOffers: () =>
      Effect.fail(TransactionOffersPersistenceFailed.make({ cause: new Error("offers") })),
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(queries),
    Layer.succeed(TransactionOffers)(offers),
    Layer.succeed(TransactionPlanService)(plans),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const response = await handleMcpRequest(
    request("tools/call", { name: "get_team_snapshot", arguments: { team } }, "fantasy"),
    (_request, _operation, program) =>
      Effect.runPromise(layerTools.provideLayer(program, services)),
  );
  const body = await json(response);

  expect(response.status).toBe(200);
  expect(body).toMatchObject({
    result: {
      isError: false,
      content: [],
      structuredContent: {
        status: "ok",
        summary: { status: "ok" },
        league: { status: "ok" },
        roster: { status: "ok" },
        transactions: { status: "ok" },
        pool: { status: "ok" },
      },
    },
  });
  const content = Effect.runSync(
    Schema.decodeUnknownEffect(
      Schema.Struct({
        result: Schema.Struct({
          structuredContent: Schema.Struct({
            failures: Schema.Array(Schema.Struct({ section: Schema.String })),
          }),
        }),
      }),
    )(body),
  );
  expect(content.result.structuredContent.failures.map((failure) => failure.section)).toEqual([
    "plan",
    "offers",
  ]);
});

it("rejects unexpected connection arguments as JSON-RPC invalid-params and names the field", async () => {
  const response = await handle(
    request("tools/call", { name: "list_connections", arguments: { limit: 1 } }, "read"),
  );
  const body = await json(response);

  expect(body).toMatchObject({
    id: 1,
    error: {
      code: -32602,
      message: 'Invalid tool arguments: Expected never at ["limit"]',
      data: { field: '["limit"]' },
    },
  });
  expect(response.status).toBe(400);
});

it("returns a stateless tool result without initializing a session", async () => {
  const response = await handle(
    request("tools/call", { name: "list_connections", arguments: {} }, "read"),
  );

  expect(response.status).toBe(200);
  expect(await json(response)).toMatchObject({
    result: { structuredContent: { connections: [] }, isError: false },
  });
  expect(response.headers.has("mcp-session-id")).toBe(false);
});

it("drops the duplicate text copy from a successful tool result", async () => {
  const response = await handle(
    request("tools/call", { name: "list_connections", arguments: {} }, "read"),
  );
  const body = await json(response);

  expect(body).toMatchObject({
    result: { isError: false, structuredContent: { connections: [] }, content: [] },
  });
});

it("scrubs unexpected persistence details from the tool response", async () => {
  const response = await handle(
    request("tools/call", { name: "list_connections", arguments: {} }, "read"),
    {
      ...unavailableConnections,
      list: () =>
        Effect.fail(
          ConnectionPersistenceFailed.make({
            cause: new Error("private database password and provider cookie"),
          }),
        ),
    },
  );

  const body = await json(response);

  expect(body).toMatchObject({ result: { isError: true } });
  expect(jsonTools.jsonString(body)).toContain("internal server error");
  expect(jsonTools.jsonString(body)).not.toContain("private database");
});

it("enforces fantasy read scope and serves bounded query results over MCP", async () => {
  const queries: FantasyQueriesShape = {
    ...unavailableQueries,
    listTeams: () =>
      Effect.succeed({
        status: "ok",
        teams: [],
        page: { returned: 0, complete: true, remaining: 0 },
        budget: { targetBytes: 28_672, hardLimitBytes: 32_768 },
      }),
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(queries),
    Layer.succeed(TransactionOffers)(unavailableOffers),
    Layer.succeed(TransactionPlanService)(unavailablePlans),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const run = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(layerTools.provideLayer(program, services)),
    );

  const denied = await run(request("tools/call", { name: "list_teams", arguments: {} }, "review"));
  const listed = await run(request("tools/call", { name: "list_teams", arguments: {} }, "fantasy"));
  const invalid = await run(
    request("tools/call", { name: "list_teams", arguments: { limit: 0 } }, "fantasy"),
  );

  expect(denied.status).toBe(403);
  expect(denied.headers.get("www-authenticate")).toContain('scope="fantasy:read"');
  expect(listed.status).toBe(200);
  expect(await listed.json()).toMatchObject({
    result: {
      isError: false,
      structuredContent: { status: "ok", teams: [] },
    },
  });
  expect(invalid.status).toBe(400);
  expect(await json(invalid)).toMatchObject({ error: { code: -32602 } });
});

it("accepts ISO 8601 instants for transaction and feedback filters", async () => {
  const teamId = Effect.runSync(
    Schema.decodeEffect(TeamId)("00000000-0000-7000-8000-000000000001"),
  );
  const transactionFilters: Array<Parameters<FantasyQueriesShape["getTransactions"]>[1]> = [];
  const feedbackFilters: Array<Parameters<FeedbackShape["list"]>[1]> = [];
  const queries: FantasyQueriesShape = {
    ...unavailableQueries,
    getTransactions: (_userId, input) => {
      transactionFilters.push(input);
      return Effect.succeed({
        status: "ok",
        team: {
          id: teamId,
          name: "Synthetic Team",
          provider: decodeProviderKey("yahoo"),
          league: "nfl",
          sport: "football",
          season: 2026,
        },
        transactions: [],
        window: { fetched: 0, truncated: false },
        coverage: [],
        failures: [],
        page: { returned: 0, complete: true, remaining: 0 },
        budget: { targetBytes: 28_672, hardLimitBytes: 32_768 },
      });
    },
  };
  const feedback: FeedbackShape = {
    ...unavailableFeedback,
    list: (_userId, filter) => {
      feedbackFilters.push(filter);
      return Effect.succeed([]);
    },
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(queries),
    Layer.succeed(TransactionOffers)(unavailableOffers),
    Layer.succeed(TransactionPlanService)(unavailablePlans),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(feedback),
  );
  const run = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(layerTools.provideLayer(program, services)),
    );

  for (const since of [
    "2026-09-20T00:00:00Z",
    "2026-09-20T00:00:00.000Z",
    "2026-09-20T00:00:00+00:00",
    "2026-09-20T00:00:00.0000000Z",
  ]) {
    const transactions = await run(
      request(
        "tools/call",
        { name: "get_transactions", arguments: { team: teamId, since } },
        "fantasy",
      ),
    );
    const feedbackRead = await run(
      request("tools/call", { name: "list_feedback", arguments: { since } }, "fantasy"),
    );

    expect(transactions.status).toBe(200);
    expect(feedbackRead.status).toBe(200);
  }

  expect(transactionFilters).toHaveLength(4);
  expect(feedbackFilters).toHaveLength(4);
  for (const input of transactionFilters) {
    const since = input.since;
    if (since === undefined) {
      throw new Error("Expected the transaction filter to carry a decoded since instant");
    }
    expect(DateTime.formatIso(since)).toBe("2026-09-20T00:00:00.000Z");
  }
  for (const filter of feedbackFilters) {
    const since = filter.since;
    if (since === undefined) {
      throw new Error("Expected the feedback filter to carry a decoded since instant");
    }
    expect(DateTime.formatIso(since)).toBe("2026-09-20T00:00:00.000Z");
  }
  expect(transactionFilters[0]?.until).toBeUndefined();
});

it("refuses a malformed or tagged instant with a readable field message", async () => {
  const teamId = Effect.runSync(
    Schema.decodeEffect(TeamId)("00000000-0000-7000-8000-000000000001"),
  );
  const run = (arguments_: Record<string, unknown>, name: string): Promise<Response> =>
    handleMcpRequest(
      request("tools/call", { name, arguments: arguments_ }, "fantasy"),
      (_request, _operation, program) =>
        Effect.runPromise(
          layerTools.provideLayer(
            program,
            Layer.mergeAll(
              authentication,
              permissiveQuota,
              Layer.succeed(Connections)(unavailableConnections),
              Layer.succeed(FantasyQueries)(unavailableQueries),
              Layer.succeed(TransactionOffers)(unavailableOffers),
              Layer.succeed(TransactionPlanService)(unavailablePlans),
              Layer.succeed(LineupRuns)(unavailableLineups),
              Layer.succeed(Teams)(unavailableTeams),
              Layer.succeed(Feedback)(unavailableFeedback),
            ),
          ),
        ),
    );

  for (const name of ["get_transactions", "list_feedback"]) {
    const malformed = await run({ team: teamId, since: "2026-13-40T00:00:00Z" }, name);
    const tagged = await run({ team: teamId, since: { epochMilliseconds: 1789862400000 } }, name);
    const malformedBody = await json(malformed);
    const taggedBody = await json(tagged);

    expect(malformedBody).toMatchObject({ result: { isError: true } });
    expect(jsonTools.jsonString(malformedBody)).toContain("Expected a valid UTC DateTime string");
    expect(jsonTools.jsonString(malformedBody)).toContain("since");
    expect(tagged.status).toBe(400);
    expect(taggedBody).toMatchObject({ error: { code: -32_602, data: { field: '["since"]' } } });
  }
});

it("reaches search_players with an empty query and returns the remedy instead of invalid-params", async () => {
  const teamId = Effect.runSync(
    Schema.decodeEffect(TeamId)("00000000-0000-7000-8000-000000000001"),
  );
  const queries: FantasyQueriesShape = {
    ...unavailableQueries,
    searchPlayers: () =>
      Effect.fail(
        QuerySelectionInvalid.make({
          detail:
            "The player search query must contain at least one visible character. Omit the query to search the whole available player pool.",
        }),
      ),
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(queries),
    Layer.succeed(TransactionOffers)(unavailableOffers),
    Layer.succeed(TransactionPlanService)(unavailablePlans),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const response = await handleMcpRequest(
    request(
      "tools/call",
      { name: "search_players", arguments: { team: teamId, query: "" } },
      "fantasy",
    ),
    (_request, _operation, program) =>
      Effect.runPromise(layerTools.provideLayer(program, services)),
  );
  const body = await json(response);

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ result: { isError: true } });
  expect(jsonTools.jsonString(body)).toContain('\\"code\\":\\"selection_invalid\\"');
  expect(jsonTools.jsonString(body)).toContain("Omit the query");
});

it("publishes and serves the scoring-period schedule group over MCP", async () => {
  const teamId = Effect.runSync(
    Schema.decodeEffect(TeamId)("00000000-0000-7000-8000-000000000001"),
  );
  const queries: FantasyQueriesShape = {
    ...unavailableQueries,
    getTeamSummary: () =>
      Effect.succeed({
        status: "ok",
        team: {
          id: teamId,
          name: "Synthetic Team",
          provider: decodeProviderKey("yahoo"),
          league: "nhl",
          sport: "hockey",
          season: 2026,
        },
        schedule: {
          status: "available",
          coverage: "date",
          period: { week: 5 },
          window: { start: "2026-10-26", end: "2026-10-27", source: "period" },
          observedAt: DateTime.makeUnsafe("2026-10-26T12:00:00.000Z"),
          dates: [
            { date: "2026-10-26", rosterGames: 0 },
            { date: "2026-10-27", rosterGames: 2 },
          ],
          offNights: {
            status: "unsupported",
            detail:
              "Off nights need the league's professional games, which are unavailable: This league has no professional-game source.",
          },
          gamesRemaining: {
            status: "available",
            sources: ["provider_opponent"],
            observedAt: DateTime.makeUnsafe("2026-10-26T12:00:00.000Z"),
            detail: "The counts come from the provider's own opponent fact.",
          },
          players: [
            {
              player: Effect.runSync(Schema.decodeEffect(PlayerRef)("r1.test")),
              name: "Synthetic Skater",
              proTeam: "SYN",
              status: "scheduled",
              gameCount: 1,
              games: [{ date: "2026-10-27", opponent: "TOR", home: false }],
              gamesRemaining: {
                status: "available",
                count: 1,
                source: "provider_opponent",
              },
            },
          ],
          detail: "Each rostered player's opponent on each of the 2 dates of scoring period 5.",
        },
        roster: [],
        ownerNote: { status: "not_set" },
        agentNotes: [],
        coverage: [],
        failures: [],
        page: { returned: 0, complete: true, remaining: 0 },
        budget: { targetBytes: 28_672, hardLimitBytes: 32_768 },
      }),
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(queries),
    Layer.succeed(TransactionOffers)(unavailableOffers),
    Layer.succeed(TransactionPlanService)(unavailablePlans),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const run = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(layerTools.provideLayer(program, services)),
    );

  const listed = await json(await run(request("tools/list", {}, "fantasy")));
  const response = await run(
    request(
      "tools/call",
      { name: "get_team_summary", arguments: { team: teamId, groups: ["schedule"] } },
      "fantasy",
    ),
  );

  expect(response.status).toBe(200);
  expect(jsonTools.jsonString(listed)).toContain("schedule.detail");
  expect(await json(response)).toMatchObject({
    result: {
      isError: false,
      structuredContent: {
        schedule: {
          status: "available",
          coverage: "date",
          period: { week: 5 },
          window: { start: "2026-10-26", end: "2026-10-27", source: "period" },
          observedAt: "2026-10-26T12:00:00.000Z",
          dates: [
            { date: "2026-10-26", rosterGames: 0 },
            { date: "2026-10-27", rosterGames: 2 },
          ],
          players: [
            {
              player: "r1.test",
              name: "Synthetic Skater",
              proTeam: "SYN",
              status: "scheduled",
              gameCount: 1,
              games: [{ date: "2026-10-27", opponent: "TOR", home: false }],
            },
          ],
          detail: "Each rostered player's opponent on each of the 2 dates of scoring period 5.",
        },
      },
    },
  });
});

it("names the cause when a continuation cursor is reused with different arguments", async () => {
  const teamId = Effect.runSync(
    Schema.decodeEffect(TeamId)("00000000-0000-7000-8000-000000000001"),
  );
  const queries: FantasyQueriesShape = {
    ...unavailableQueries,
    getTeamSummary: () => Effect.fail(QueryCursorInvalid.make({ reason: "mismatch" })),
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(queries),
    Layer.succeed(TransactionOffers)(unavailableOffers),
    Layer.succeed(TransactionPlanService)(unavailablePlans),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const response = await handleMcpRequest(
    request(
      "tools/call",
      {
        name: "get_team_summary",
        arguments: { team: teamId, groups: ["league"], cursor: "c1.x.y" },
      },
      "fantasy",
    ),
    (_request, _operation, program) =>
      Effect.runPromise(layerTools.provideLayer(program, services)),
  );
  const body = await json(response);
  const text = jsonTools.jsonString(body);

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ result: { isError: true } });
  expect(text).toContain('\\"code\\":\\"cursor_invalid\\"');
  expect(text).toContain("issued for a different request");
  expect(text).not.toContain("invalid or expired");
});

it("appends moves to one team queue and lists them across teams", async () => {
  const team = decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c9164b0");
  const otherTeam = decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c9164b1");
  const teamView = {
    id: team,
    name: "Alpha",
    league: "nfl" as const,
    sport: "football" as const,
    season: 2026,
  };
  const otherTeamView = {
    ...teamView,
    id: otherTeam,
    name: "Beta",
    league: "nhl" as const,
    sport: "hockey" as const,
  };
  const move = {
    move: Effect.runSync(
      Schema.decodeEffect(TransactionMoveId)("018f79ea-7d86-7c18-9b4a-8b4d0c9165b1"),
    ),
    team: teamView,
    kind: "drop" as const,
    position: 0,
    decision: "now" as const,
    status: "open_now" as const,
    reason: "Open a bench place.",
    attempts: [],
    adds: [],
    fallbacks: [],
    drops: [{ name: "Riverside Receiver" }],
    picks: [],
    confirmation: {
      by: decodeUserId("reader"),
      at: DateTime.makeUnsafe("2026-11-11T16:00:00.000Z"),
    },
    runAt: DateTime.makeUnsafe("2026-11-11T17:00:00.000Z"),
    decidedBy: "owner" as const,
    surface: "transactions.confirm",
    validation: { status: "current" as const, reasons: [] },
    check: { status: "checked" as const },
  };
  const emptyRead = (
    target: TransactionMoveTeam,
    moves: ReadonlyArray<typeof move>,
  ): {
    readonly team: TransactionMoveTeam;
    readonly today: string;
    readonly nextCheckAt: DateTime.Utc;
    readonly moves: ReadonlyArray<typeof move>;
    readonly days: ReadonlyArray<{
      readonly day: string;
      readonly groupedBy: "runDay";
      readonly today: boolean;
      readonly moves: ReadonlyArray<typeof move>;
    }>;
    readonly groups: ReadonlyArray<never>;
    readonly snapshot: {
      readonly status: "live";
      readonly checkedAt: DateTime.Utc;
      readonly source: string;
    };
  } => ({
    team: target,
    today: "2026-11-11",
    nextCheckAt: DateTime.makeUnsafe("2026-11-11T12:55:00.000Z"),
    snapshot: {
      status: "live",
      checkedAt: DateTime.makeUnsafe("2026-11-11T12:00:00.000Z"),
      source: "week 1",
    },
    moves,
    days:
      moves.length === 0
        ? []
        : [{ day: "2026-11-11", groupedBy: "runDay" as const, today: true, moves }],
    groups: [],
  });
  const listed: Array<{ readonly team?: string; readonly state?: string }> = [];
  const proposed: Array<{
    userId: string;
    input: {
      readonly team: string;
      readonly moves: ReadonlyArray<{
        readonly move?: TransactionMoveId;
        readonly kind?: string;
        readonly player?: string;
      }>;
    };
  }> = [];
  const plans: TransactionPlanServiceShape = {
    ...unavailablePlans,
    proposeRefs: (userId, input) => {
      proposed.push({ userId, input });
      return Effect.succeed({
        plan: {
          team: input.team,
          today: "2026-11-11",
          moves: [],
          groups: [],
        },
        refused: [],
        confirmationCleared: input.moves.some((entry) => entry.move !== undefined),
      });
    },
    plan: (_userId, input) =>
      Effect.succeed(emptyRead(input.team === team ? teamView : otherTeamView, [move])),
    list: (_userId, input): Effect.Effect<TransactionMoveList> => {
      listed.push({
        ...(input.team === undefined ? {} : { team: input.team }),
        ...(input.state === undefined ? {} : { state: input.state }),
      });
      const data = {
        status: "ok" as const,
        nextCheckAt: DateTime.makeUnsafe("2026-11-11T12:55:00.000Z"),
        ...(input.team === undefined
          ? {}
          : { team: input.team === team ? teamView : otherTeamView }),
        moves: [move],
        days: [
          {
            day: "2026-11-11",
            groupedBy: "runDay" as const,
            today: true,
            teams: [{ team: teamView, moves: [move] }],
          },
        ],
        teamFacts: [],
        counts: { open: 1, today: 1, saved: 0, ended: 0 },
        teamCount: 2,
        groups: [],
        page: { returned: 1, complete: true },
      };
      return Effect.succeed(data);
    },
  };
  const run = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(
        layerTools.provideLayer(
          program,
          Layer.mergeAll(
            authentication,
            permissiveQuota,
            Layer.succeed(Connections)(unavailableConnections),
            Layer.succeed(FantasyQueries)(unavailableQueries),
            Layer.succeed(TransactionOffers)(unavailableOffers),
            Layer.succeed(TransactionPlanService)(plans),
            Layer.succeed(LineupRuns)(unavailableLineups),
            Layer.succeed(Teams)(unavailableTeams),
            Layer.succeed(Feedback)(unavailableFeedback),
          ),
        ),
      ),
    );

  const denied = await run(
    request(
      "tools/call",
      {
        name: "propose_transactions",
        arguments: {
          team,
          moves: [{ kind: "drop", drops: ["r1.test"], reason: "A stated reason." }],
        },
      },
      "fantasy",
    ),
  );
  expect(denied.status).toBe(403);
  expect(denied.headers.get("www-authenticate")).toContain('scope="transactions:review"');
  expect(proposed).toEqual([]);

  const proposedOnce = await run(
    request(
      "tools/call",
      {
        name: "propose_transactions",
        arguments: {
          team,
          moves: [{ kind: "drop", drops: ["r1.test"], reason: "A stated reason." }],
        },
      },
      "review",
    ),
  );
  const proposedBody = await json(proposedOnce);
  expect(proposedOnce.status).toBe(200);
  expect(proposedBody).toMatchObject({
    result: {
      isError: false,
      structuredContent: { team: { id: team }, refused: [], confirmationCleared: false },
    },
  });

  const proposedAgain = await run(
    request(
      "tools/call",
      {
        name: "propose_transactions",
        arguments: {
          team,
          moves: [{ kind: "drop", drops: ["r1.other"], reason: "A later reason." }],
        },
      },
      "review",
    ),
  );
  expect(proposedAgain.status).toBe(200);
  expect(proposed).toHaveLength(2);
  expect(proposed.map((entry) => entry.userId)).toEqual(["reader", "reader"]);
  expect(proposed[0]?.input.team).toBe(team);
  expect(proposed[1]?.input.team).toBe(team);

  const moveId = Effect.runSync(
    Schema.decodeEffect(TransactionMoveId)("018f79ea-7d86-7c18-9b4a-8b4d0c9165b2"),
  );
  const amended = await run(
    request(
      "tools/call",
      {
        name: "propose_transactions",
        arguments: {
          team,
          moves: [
            {
              move: moveId,
              kind: "drop",
              drops: ["r1.amended"],
              reason: "An amended reason.",
            },
          ],
        },
      },
      "review",
    ),
  );
  expect(amended.status).toBe(200);
  expect(proposed).toHaveLength(3);
  expect(proposed[2]?.input.moves[0]?.move).toBe(moveId);
  const amendedBody = await json(amended);
  expect(amendedBody).toMatchObject({
    result: { isError: false, structuredContent: { confirmationCleared: true } },
  });

  const stashed = await run(
    request(
      "tools/call",
      {
        name: "propose_transactions",
        arguments: {
          team,
          moves: [{ kind: "stash", player: "r1.stashed", reason: "Park a player." }],
        },
      },
      "review",
    ),
  );
  expect(stashed.status).toBe(200);
  expect(proposed).toHaveLength(4);
  expect(proposed[3]?.input.moves[0]).toMatchObject({
    kind: "stash",
    player: "r1.stashed",
  });

  const listedResponse = await run(
    request(
      "tools/call",
      { name: "list_transaction_proposals", arguments: { team, state: "saved" } },
      "fantasy",
    ),
  );
  const listedBody = await json(listedResponse);
  expect(listedResponse.status).toBe(200);
  expect(listedBody).toMatchObject({
    result: {
      isError: false,
      structuredContent: {
        status: "ok",
        team: { id: team },
        days: [{ groupedBy: "runDay" as const, today: true, teams: [{ team: { id: team } }] }],
        counts: { open: 1, today: 1, saved: 0, ended: 0 },
        teamCount: 2,
        page: { returned: 1, complete: true },
      },
    },
  });
  expect(listed).toEqual([{ team, state: "saved" }]);

  const planResponse = await run(
    request("tools/call", { name: "get_transaction_plan", arguments: { team } }, "fantasy"),
  );
  const planBody = await json(planResponse);
  expect(planResponse.status).toBe(200);
  expect(planBody).toMatchObject({
    result: {
      isError: false,
      structuredContent: {
        team: { id: team },
        today: "2026-11-11",
        days: [{ day: "2026-11-11", groupedBy: "runDay" as const, today: true }],
        moves: [
          {
            decision: "now",
            confirmation: {
              by: "reader",
              at: "2026-11-11T16:00:00.000Z",
            },
            runAt: "2026-11-11T17:00:00.000Z",
            decidedBy: "owner",
            surface: "transactions.confirm",
          },
        ],
      },
    },
  });
  expect(jsonTools.jsonString(planBody)).not.toContain("461.p.");
});

it("discards one saved move and reports why a run move stays", async () => {
  const team = decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c9164b3");
  const teamView = {
    id: team,
    name: "Gamma",
    league: "nfl" as const,
    sport: "football" as const,
    season: 2026,
  };
  const moveId = Effect.runSync(
    Schema.decodeEffect(TransactionMoveId)("018f79ea-7d86-7c18-9b4a-8b4d0c9165b3"),
  );
  const move = {
    move: moveId,
    team: teamView,
    kind: "drop" as const,
    position: 0,
    decision: "saved" as const,
    status: "open_saved" as const,
    reason: "Open a bench place.",
    attempts: [],
    adds: [],
    fallbacks: [],
    drops: [{ name: "Riverside Receiver" }],
    picks: [],
    validation: { status: "current" as const, reasons: [] },
    check: { status: "checked" as const },
  };
  const planRead = {
    team: teamView,
    today: "2026-11-11",
    nextCheckAt: DateTime.makeUnsafe("2026-11-11T12:55:00.000Z"),
    snapshot: {
      status: "live" as const,
      checkedAt: DateTime.makeUnsafe("2026-11-11T12:00:00.000Z"),
      source: "week 1",
    },
    moves: [move],
    days: [{ day: "2026-11-11", groupedBy: "runDay" as const, today: true, moves: [move] }],
    groups: [],
  };
  const discarded: Array<{
    userId: string;
    input: { readonly team: TeamId; readonly move: TransactionMoveId };
  }> = [];
  let outcome: "ok" | "ended" | "missing" = "ok";
  const plans: TransactionPlanServiceShape = {
    ...unavailablePlans,
    discard: (userId, input) => {
      discarded.push({ userId, input });
      if (outcome === "missing") {
        return Effect.fail(
          TransactionPlanMoveNotFound.make({ team: input.team, move: input.move }),
        );
      }
      return Effect.succeed({
        plan: { team: input.team, today: "2026-11-11", moves: [], groups: [] },
        refused:
          outcome === "ended"
            ? [
                {
                  code: "move_not_open",
                  team: input.team,
                  detail: "Drop Riverside Receiver has ended, so the plan no longer changes it.",
                  moves: [0],
                },
              ]
            : [],
      });
    },
    plan: (_userId, input) =>
      Effect.succeed({
        ...planRead,
        team: input.team === team ? teamView : move.team,
      }),
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(unavailableQueries),
    Layer.succeed(TransactionOffers)(unavailableOffers),
    Layer.succeed(TransactionPlanService)(plans),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const run = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(layerTools.provideLayer(program, services)),
    );

  const denied = await run(
    request(
      "tools/call",
      { name: "discard_transaction_move", arguments: { team, move: moveId, reason: "Duplicate." } },
      "fantasy",
    ),
  );
  expect(denied.status).toBe(403);
  expect(discarded).toEqual([]);

  const discardedOnce = await run(
    request(
      "tools/call",
      { name: "discard_transaction_move", arguments: { team, move: moveId, reason: "Duplicate." } },
      "review",
    ),
  );
  expect(discardedOnce.status).toBe(200);
  expect(await json(discardedOnce)).toMatchObject({
    result: {
      isError: false,
      structuredContent: { team: { id: team }, reason: "Duplicate.", refused: [] },
    },
  });
  expect(discarded).toEqual([
    {
      userId: "reader",
      input: {
        team,
        move: moveId,
        decision: { decidedBy: "agent", surface: "discard_transaction_move" },
      },
    },
  ]);

  outcome = "ended";
  const ended = await run(
    request(
      "tools/call",
      { name: "discard_transaction_move", arguments: { team, move: moveId } },
      "review",
    ),
  );
  expect(ended.status).toBe(200);
  expect(await json(ended)).toMatchObject({
    result: {
      isError: false,
      structuredContent: {
        team: { id: team },
        refused: [{ code: "move_not_open", team }],
      },
    },
  });

  outcome = "missing";
  const missing = await run(
    request(
      "tools/call",
      { name: "discard_transaction_move", arguments: { team, move: moveId } },
      "review",
    ),
  );
  const decoded = Effect.runSync(Schema.decodeUnknownEffect(ToolErrorResult)(await json(missing)));
  const text = decoded.result.content.map((entry) => entry.text).join(" ");
  const failure = Effect.runSync(Schema.decodeEffect(Schema.fromJsonString(ToolFailure))(text));
  expect(decoded.result.isError).toBe(true);
  expect(failure.code).toBe("move_not_found");
});

it("reads every effect of an activate and the reason a failed move ended", async () => {
  const team = decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c9164b5");
  const teamView = {
    id: team,
    name: "Delta",
    league: "nhl" as const,
    sport: "hockey" as const,
    season: 2026,
  };
  const move = {
    move: Effect.runSync(
      Schema.decodeEffect(TransactionMoveId)("018f79ea-7d86-7c18-9b4a-8b4d0c9165b8"),
    ),
    team: teamView,
    kind: "activate" as const,
    position: 0,
    decision: "now" as const,
    status: "failed" as const,
    reason: "Activate the reserve forward and drop the bench winger.",
    attempts: [],
    adds: [],
    fallbacks: [],
    drops: [{ name: "Anton Frondell" }],
    picks: [],
    intent: { kind: "activate" as const, player: { name: "Jake Neighbours" } },
    placement: {
      playerName: "Jake Neighbours",
      fromSlot: "IR",
      toSlot: "BN",
      detail: "Jake Neighbours moves to BN.",
    },
    validation: { status: "current" as const, reasons: [] },
    check: { status: "checked" as const },
    result: "failed" as const,
    resultDetail: "The drop reached your league, but the activate failed.",
    resultAt: DateTime.makeUnsafe("2026-11-11T18:05:00.000Z"),
  };
  const planRead = {
    team: teamView,
    today: "2026-11-11",
    nextCheckAt: DateTime.makeUnsafe("2026-11-11T12:55:00.000Z"),
    snapshot: {
      status: "live" as const,
      checkedAt: DateTime.makeUnsafe("2026-11-11T12:00:00.000Z"),
      source: "week 1",
    },
    moves: [move],
    days: [{ day: "2026-11-11", groupedBy: "runDay" as const, today: true, moves: [move] }],
    groups: [],
  };
  const plans: TransactionPlanServiceShape = {
    ...unavailablePlans,
    proposeRefs: (_userId, input) =>
      Effect.succeed({
        plan: { team: input.team, today: "2026-11-11", moves: [], groups: [] },
        refused: [],
        confirmationCleared: false,
      }),
    plan: () => Effect.succeed(planRead),
    list: (): Effect.Effect<TransactionMoveList> =>
      Effect.succeed({
        status: "ok" as const,
        team: teamView,
        nextCheckAt: DateTime.makeUnsafe("2026-11-11T12:55:00.000Z"),
        moves: [move],
        days: [
          {
            day: "2026-11-11",
            groupedBy: "runDay" as const,
            today: true,
            teams: [{ team: teamView, moves: [move] }],
          },
        ],
        teamFacts: [],
        counts: { open: 1, today: 1, saved: 0, ended: 0 },
        teamCount: 1,
        groups: [],
        page: { returned: 1, complete: true },
      }),
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(unavailableQueries),
    Layer.succeed(TransactionOffers)(unavailableOffers),
    Layer.succeed(TransactionPlanService)(plans),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const run = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(layerTools.provideLayer(program, services)),
    );

  const planResponse = await run(
    request("tools/call", { name: "get_transaction_plan", arguments: { team } }, "fantasy"),
  );
  expect(planResponse.status).toBe(200);
  expect(await json(planResponse)).toMatchObject({
    result: {
      isError: false,
      structuredContent: {
        moves: [
          {
            intent: { player: { name: "Jake Neighbours" } },
            drops: [{ name: "Anton Frondell" }],
            resultDetail: "The drop reached your league, but the activate failed.",
            resultAt: "2026-11-11T18:05:00.000Z",
          },
        ],
      },
    },
  });

  const listResponse = await run(
    request("tools/call", { name: "list_transaction_proposals", arguments: { team } }, "fantasy"),
  );
  expect(listResponse.status).toBe(200);
  expect(await json(listResponse)).toMatchObject({
    result: {
      isError: false,
      structuredContent: {
        moves: [
          {
            intent: { player: { name: "Jake Neighbours" } },
            drops: [{ name: "Anton Frondell" }],
            resultDetail: "The drop reached your league, but the activate failed.",
            resultAt: "2026-11-11T18:05:00.000Z",
          },
        ],
      },
    },
  });

  const proposed = await run(
    request(
      "tools/call",
      {
        name: "propose_transactions",
        arguments: {
          team,
          moves: [
            { kind: "activate", player: "r1.activated", drops: ["r1.dropped"], reason: "Test." },
          ],
        },
      },
      "review",
    ),
  );
  expect(proposed.status).toBe(200);
  expect(await json(proposed)).toMatchObject({
    result: {
      isError: false,
      structuredContent: {
        moves: [
          {
            intent: { player: { name: "Jake Neighbours" } },
            drops: [{ name: "Anton Frondell" }],
          },
        ],
      },
    },
  });
});

it("returns a coded remedy instead of a 500 when a move list cannot be read", async () => {
  const team = decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c9164b0");
  const plans: TransactionPlanServiceShape = {
    ...unavailablePlans,
    list: () =>
      Effect.fail(
        TransactionPlanPersistenceFailed.make({ cause: new Error("private database password") }),
      ),
  };
  const response = await handleMcpRequest(
    request("tools/call", { name: "list_transaction_proposals", arguments: { team } }, "fantasy"),
    (_request, _operation, program) =>
      Effect.runPromise(
        layerTools.provideLayer(
          program,
          Layer.mergeAll(
            authentication,
            permissiveQuota,
            Layer.succeed(Connections)(unavailableConnections),
            Layer.succeed(FantasyQueries)(unavailableQueries),
            Layer.succeed(TransactionOffers)(unavailableOffers),
            Layer.succeed(TransactionPlanService)(plans),
            Layer.succeed(LineupRuns)(unavailableLineups),
            Layer.succeed(Teams)(unavailableTeams),
            Layer.succeed(Feedback)(unavailableFeedback),
          ),
        ),
      ),
  );
  const body = await json(response);
  const decoded = Effect.runSync(Schema.decodeUnknownEffect(ToolErrorResult)(body));
  const text = decoded.result.content.map((entry) => entry.text).join(" ");
  const failure = Effect.runSync(Schema.decodeEffect(Schema.fromJsonString(ToolFailure))(text));
  expect(decoded.result.isError).toBe(true);
  expect(failure.code).toBe("plan_unavailable");
  expect(failure.message).toContain("start again from the first page");
  expect(failure.message).not.toContain("private database");
  expect(failure.message).not.toContain("internal server error");
});

it("returns a durable queued lineup reference without claiming success", async () => {
  const at = DateTime.makeUnsafe("2026-10-25T12:00:00Z");
  const team = decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c9164b0");
  const lineups: LineupRunsShape = {
    ...unavailableLineups,
    submit: (_userId, input) =>
      Effect.succeed({
        request: input.requestId,
        delivery: "queued",
        runs: [
          {
            run: Effect.runSync(
              Schema.decodeEffect(LineupRunId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164b1"),
            ),
            request: input.requestId,
            team,
            target: { coverage: "week", week: 3 },
            trigger: "manual",
            implementation: "provider_native",
            implementationVersion: "provider-native/1",
            status: "queued",
            attempts: 0,
            createdAt: at,
            updatedAt: at,
            pending: { reason: "queued", detail: "The durable run is in progress." },
          },
        ],
      } satisfies LineupSubmitData),
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(unavailableQueries),
    Layer.succeed(TransactionOffers)(unavailableOffers),
    Layer.succeed(TransactionPlanService)(unavailablePlans),
    Layer.succeed(LineupRuns)(lineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const call = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(layerTools.provideLayer(program, services)),
    );

  const response = await call(
    request(
      "tools/call",
      {
        name: "set_lineup",
        arguments: {
          requestId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164b2",
          teams: [{ team, period: { coverage: "week", week: 3 } }],
        },
      },
      "write",
    ),
  );
  const body = await json(response);

  expect(response.status).toBe(200);
  expect(body).toMatchObject({
    result: {
      isError: false,
      structuredContent: {
        delivery: "queued",
        runs: [{ status: "queued" }],
        wait: { timeoutMs: 0, settled: false },
      },
    },
  });
  expect(jsonTools.jsonString(body)).not.toContain("completed");
});

it("requires teams:manage and changes automation through the shared team service", async () => {
  const at = DateTime.makeUnsafe("2026-10-25T12:00:00Z");
  const team = decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c9164c0");
  let enabled = false;
  const teams: TeamsShape = {
    ...unavailableTeams,
    control: (_userId, inputs) =>
      Effect.succeed(
        inputs.map((input) => {
          enabled = input.action === "enable";
          return {
            outcome: "changed" as const,
            team: input.team,
            action: input.action,
            enrolled: enabled,
            availability: "available" as const,
            automation: {
              status: enabled ? ("enabled" as const) : ("disabled" as const),
              changedAt: at,
            },
            detail: enabled ? "Automation is enabled." : "Automation is disabled.",
          };
        }),
      ),
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(unavailableQueries),
    Layer.succeed(TransactionOffers)(unavailableOffers),
    Layer.succeed(TransactionPlanService)(unavailablePlans),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(teams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const call = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(layerTools.provideLayer(program, services)),
    );
  const arguments_ = { teams: [{ team, action: "enable" }] };

  const denied = await call(
    request("tools/call", { name: "set_team_automation", arguments: arguments_ }, "read"),
  );

  expect(denied.status).toBe(403);
  expect(denied.headers.get("www-authenticate")).toContain('scope="teams:manage"');
  expect(enabled).toBe(false);

  const allowed = await call(
    request("tools/call", { name: "set_team_automation", arguments: arguments_ }, "teams"),
  );

  expect(allowed.status).toBe(200);
  expect(await allowed.json()).toMatchObject({
    result: {
      isError: false,
      structuredContent: {
        teams: [
          {
            outcome: "changed",
            enrolled: true,
            availability: "available",
            automation: { status: "enabled" },
          },
        ],
      },
    },
  });
  expect(enabled).toBe(true);
});

it("requires notes:write and attributes an agent note to the authenticated client", async () => {
  const at = DateTime.makeUnsafe("2026-10-25T12:00:00Z");
  const team = decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c9164c1");
  const recorded: Array<{ userId: string; author: unknown; input: unknown }> = [];
  const teams: TeamsShape = {
    ...unavailableTeams,
    addAgentNote: (userId, author, input) => {
      recorded.push({ userId, author, input });
      return Effect.succeed({ team: input.team, author, body: input.body, writtenAt: at });
    },
  };
  const withClient: AuthService["Service"] = {
    ...authenticationService,
    resolveAccessToken: (token, scopes) => {
      const granted = token.startsWith("notes")
        ? ["fantasy:read", "notes:write"]
        : ["fantasy:read"];
      return Effect.succeed(
        scopes.every((scope) => granted.includes(scope))
          ? {
              ...signedInGrant(),
              ...(token === "notes" ? { clientId: "client-note", clientName: "Note Agent" } : {}),
            }
          : { status: "insufficient_scope" as const },
      );
    },
  };
  const services = Layer.mergeAll(
    Layer.succeed(AuthService)(withClient),
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(unavailableQueries),
    Layer.succeed(TransactionOffers)(unavailableOffers),
    Layer.succeed(TransactionPlanService)(unavailablePlans),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(teams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const call = (token: string, body: string): Promise<Response> =>
    handleMcpRequest(
      request("tools/call", { name: "add_team_agent_note", arguments: { team, body } }, token),
      (_request, _operation, program) =>
        Effect.runPromise(layerTools.provideLayer(program, services)),
    );

  const denied = await call("read", "The goalie bubble is thin.");
  const allowed = await call("notes", "The manager hoards goaltenders.");
  const unattributed = await call("notes-without-client", "This has no client.");

  expect(denied.status).toBe(403);
  expect(denied.headers.get("www-authenticate")).toContain('scope="notes:write"');
  const allowedBody = await json(allowed);
  expect(allowedBody).toMatchObject({
    result: {
      isError: false,
      structuredContent: {
        team,
        author: { clientId: "client-note", name: "Note Agent" },
        body: "The manager hoards goaltenders.",
        writtenAt: "2026-10-25T12:00:00.000Z",
      },
    },
  });
  expect(recorded).toEqual([
    {
      userId: "reader",
      author: { clientId: "client-note", name: "Note Agent" },
      input: { team, body: "The manager hoards goaltenders." },
    },
  ]);
  const unattributedBody = await json(unattributed);
  expect(unattributedBody).toMatchObject({ result: { isError: true } });
  expect(jsonTools.jsonString(unattributedBody)).toContain("identified client");
  expect(recorded).toHaveLength(1);
});

it("records agent feedback for the authenticated account on a read grant", async () => {
  const at = DateTime.makeUnsafe("2026-10-25T12:00:00Z");
  const submitted: Array<{ readonly userId: string; readonly submitter: unknown }> = [];
  const lists: Array<{ readonly userId: string; readonly filter: unknown }> = [];
  const feedback: FeedbackShape = {
    ...unavailableFeedback,
    list: (userId, filter) => {
      lists.push({ userId, filter });
      return Effect.succeed([
        {
          id: Effect.runSync(
            Schema.decodeEffect(FeedbackId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164b3"),
          ),
          submitter: { kind: "agent" as const, reference: "mcp" },
          kind: "bug" as const,
          status: "acknowledged" as const,
          title: "Week is wrong",
          body: "The run used the next week.",
          context: { tool: "get_rosters", surface: "mcp" as const },
          createdAt: at,
          updatedAt: at,
        },
      ]);
    },
    submit: (userId, submitter, submissions) => {
      submitted.push({ userId, submitter });
      return Effect.succeed(
        submissions.map(() => ({
          id: Effect.runSync(
            Schema.decodeEffect(FeedbackId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164b3"),
          ),
          submitter,
          kind: "bug" as const,
          status: "open" as const,
          title: "Week is wrong",
          body: "The run used the next week.",
          context: { tool: "get_rosters", surface: "mcp" as const },
          createdAt: at,
          updatedAt: at,
        })),
      );
    },
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(unavailableQueries),
    Layer.succeed(TransactionOffers)(unavailableOffers),
    Layer.succeed(TransactionPlanService)(unavailablePlans),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(feedback),
  );
  const call = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(layerTools.provideLayer(program, services)),
    );
  const arguments_ = {
    kind: "bug",
    title: "Week is wrong",
    body: "The run used the next week.",
    context: { tool: null, surface: "mcp", client: "Muse" },
  };

  const denied = await call(
    request("tools/call", { name: "submit_feedback", arguments: arguments_ }, "review"),
  );

  expect(denied.status).toBe(403);
  expect(denied.headers.get("www-authenticate")).toContain('scope="fantasy:read"');
  expect(submitted).toEqual([]);

  const allowed = await call(
    request("tools/call", { name: "submit_feedback", arguments: arguments_ }, "read"),
  );
  const body = await json(allowed);

  expect(allowed.status).toBe(200);
  expect(body).toMatchObject({
    result: {
      isError: false,
      structuredContent: {
        feedback: {
          id: "018f79ea-7d86-7c18-9b4a-8b4d0c9164b3",
          status: "open",
          kind: "bug",
        },
      },
    },
  });
  expect(submitted).toEqual([{ userId: "reader", submitter: { kind: "agent", reference: "mcp" } }]);
  expect(jsonTools.jsonString(body)).not.toContain("cause");

  const listed = await call(
    request("tools/call", { name: "list_feedback", arguments: {} }, "read"),
  );
  const listedBody = await json(listed);

  expect(listed.status).toBe(200);
  expect(listedBody).toMatchObject({
    result: {
      isError: false,
      structuredContent: {
        feedback: [
          {
            id: "018f79ea-7d86-7c18-9b4a-8b4d0c9164b3",
            status: "acknowledged",
            title: "Week is wrong",
          },
        ],
        page: { returned: 1, limit: 20 },
      },
    },
  });
  expect(lists).toEqual([{ userId: "reader", filter: { limit: 20 } }]);
});

it("returns an actionable failure for refused feedback instead of leaking persistence details", async () => {
  const limited: FeedbackShape = {
    ...unavailableFeedback,
    submit: () => Effect.fail(FeedbackRateLimited.make({ retryAfterSeconds: 900 })),
  };
  const rejected: FeedbackShape = {
    ...unavailableFeedback,
    submit: () =>
      Effect.fail(FeedbackContentInvalid.make({ detail: "Remove control characters." })),
  };
  const broken: FeedbackShape = {
    ...unavailableFeedback,
    list: () =>
      Effect.fail(
        FeedbackPersistenceFailed.make({ cause: new Error("private database password") }),
      ),
  };
  const run = (
    service: FeedbackShape,
    name: string,
    arguments_: Record<string, unknown>,
    token: string,
  ): Promise<Response> =>
    handleMcpRequest(
      request("tools/call", { name, arguments: arguments_ }, token),
      (_request, _operation, program) =>
        Effect.runPromise(
          layerTools.provideLayer(
            program,
            Layer.mergeAll(
              authentication,
              permissiveQuota,
              Layer.succeed(Connections)(unavailableConnections),
              Layer.succeed(FantasyQueries)(unavailableQueries),
              Layer.succeed(TransactionOffers)(unavailableOffers),
              Layer.succeed(TransactionPlanService)(unavailablePlans),
              Layer.succeed(LineupRuns)(unavailableLineups),
              Layer.succeed(Teams)(unavailableTeams),
              Layer.succeed(Feedback)(service),
            ),
          ),
        ),
    );
  const submission = { kind: "bug", title: "Title", body: "Body" };

  const throttled = await run(limited, "submit_feedback", submission, "read");
  const invalid = await run(rejected, "submit_feedback", submission, "read");
  const failed = await run(broken, "list_feedback", {}, "restricted");
  const invalidLimit = await run(broken, "list_feedback", { limit: 0 }, "restricted");

  const throttledBody = await json(throttled);
  const invalidBody = await json(invalid);
  expect(throttledBody).toMatchObject({ result: { isError: true } });
  expect(jsonTools.jsonString(throttledBody)).toContain("900 seconds");
  expect(invalidBody).toMatchObject({ result: { isError: true } });
  expect(jsonTools.jsonString(invalidBody)).toContain("control characters");
  const failedBody = await json(failed);
  expect(failed.status).toBe(200);
  expect(jsonTools.jsonString(failedBody)).not.toContain("private database");
  expect(jsonTools.jsonString(failedBody)).toContain("internal server error");
  expect(invalidLimit.status).toBe(400);
  expect(await json(invalidLimit)).toMatchObject({ error: { code: -32602 } });
});

const rateLimitedToolkit = Toolkit.make(
  Tool.make("echo", {
    parameters: Schema.Struct({ value: Schema.String }),
    success: Schema.String,
  })
    .annotate(RequiredScope, { name: "example:read", description: "Read examples." })
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false),
);

const permissiveQuota = Layer.succeed(ToolCallQuota)({
  consume: () => Effect.succeed({ allowed: true as const }),
});

const signedInGrant = (): Extract<AccessTokenResolution, { status: "authenticated" }> => ({
  status: "authenticated",
  userId: decodeUserId("reader"),
  accessTokenExpiresAt: DateTime.makeUnsafe(DateTime.nowUnsafe().epochMilliseconds + 120_000),
});

const authenticationService: AuthService["Service"] = {
  signInMethods: { google: false },
  oauthResource: "https://connections.example/mcp",
  onboardingScopes: [
    { name: "fantasy:read", description: "Read fantasy data." },
    { name: "offline_access", description: "Stay connected." },
  ],
  accessTokenLifetime: Duration.minutes(5),
  getSession: () => Effect.void.pipe(Effect.as(undefined)),
  handle: () => Effect.succeed(new Response()),
  getConsentRequest: () => Effect.succeed({ status: "invalid" as const }),
  consent: () => Effect.succeed("https://client.test/callback"),
  resolveAccessToken: (token, scopes) => {
    if (token === "expired") {
      return Effect.succeed({ status: "invalid" as const, reason: "expired" as const });
    }
    if (token === "invalid") {
      return Effect.succeed({ status: "invalid" as const });
    }
    const granted =
      token === "read"
        ? ["fantasy:read", "example:read"]
        : token === "fantasy"
          ? ["fantasy:read"]
          : token === "review"
            ? ["transactions:review"]
            : token === "restricted"
              ? ["fantasy:read", "transactions:review", "lineups:write", "offline_access"]
              : token === "none"
                ? []
                : scopes;
    return Effect.succeed(
      scopes.every((scope) => granted.includes(scope))
        ? signedInGrant()
        : { status: "insufficient_scope" as const },
    );
  },
};
const authentication = Layer.succeed(AuthService)(authenticationService);
const unavailableConnections: ConnectionsShape = {
  list: () => Effect.succeed([]),
  link: () => Effect.succeed([]),
  completeReconnect: () => Effect.succeed([]),
  disconnect: () => Effect.succeed([]),
  discoverTeams: () => Effect.succeed([]),
  listTeams: () => Effect.succeed([]),
};

function handle(
  request: Request,
  connections: ConnectionsShape = unavailableConnections,
  quota: Layer.Layer<ToolCallQuota> = permissiveQuota,
): Promise<Response> {
  const services = Layer.mergeAll(
    authentication,
    quota,
    Layer.succeed(Connections)(connections),
    Layer.succeed(FantasyQueries)(unavailableQueries),
    Layer.succeed(TransactionOffers)(unavailableOffers),
    Layer.succeed(TransactionPlanService)(unavailablePlans),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  return handleMcpRequest(request, (_request, _operation, program) =>
    Effect.runPromise(layerTools.provideLayer(program, services)),
  );
}

const unavailableQueries: FantasyQueriesShape = {
  listTeams: () => Effect.die(new Error("queries unavailable")),
  getCalendar: () => Effect.die(new Error("queries unavailable")),
  getLeague: () => Effect.die(new Error("queries unavailable")),
  getRosters: () => Effect.die(new Error("queries unavailable")),
  searchPlayers: () => Effect.die(new Error("queries unavailable")),
  getPlayers: () => Effect.die(new Error("queries unavailable")),
  getMatchups: () => Effect.die(new Error("queries unavailable")),
  getTransactions: () => Effect.die(new Error("queries unavailable")),
  getTeamSummary: () => Effect.die(new Error("queries unavailable")),
};
const unavailableOffers: TransactionOffersShape = {
  readPendingOffers: () => Effect.die(new Error("offers unavailable")),
};
const unavailablePlans: TransactionPlanServiceShape = {
  propose: () => Effect.die(new Error("plans unavailable")),
  proposeRefs: () => Effect.die(new Error("plans unavailable")),
  save: () => Effect.die(new Error("plans unavailable")),
  edit: () => Effect.die(new Error("plans unavailable")),
  discard: () => Effect.die(new Error("plans unavailable")),
  discardGroup: () => Effect.die(new Error("plans unavailable")),
  fix: () => Effect.die(new Error("plans unavailable")),
  retry: () => Effect.die(new Error("plans unavailable")),
  confirm: () => Effect.die(new Error("plans unavailable")),
  submit: () => Effect.die(new Error("plans unavailable")),
  runDue: () => Effect.die(new Error("plans unavailable")),
  timeline: () => Effect.die(new Error("plans unavailable")),
  list: () => Effect.die(new Error("plans unavailable")),
  plan: () => Effect.die(new Error("plans unavailable")),
  counts: () => Effect.die(new Error("plans unavailable")),
};
const unavailableLineups: LineupRunsShape = {
  submit: () => Effect.die(new Error("lineups unavailable")),
  get: () => Effect.die(new Error("lineups unavailable")),
  wait: () => Effect.die(new Error("lineups unavailable")),
};
const unavailableTeams: TeamsShape = {
  list: () => Effect.die(new Error("teams unavailable")),
  get: () => Effect.die(new Error("teams unavailable")),
  control: () => Effect.die(new Error("teams unavailable")),
  saveNote: () => Effect.die(new Error("teams unavailable")),
  addAgentNote: () => Effect.die(new Error("teams unavailable")),
};
const unavailableFeedback: FeedbackShape = {
  submit: () => Effect.die(new Error("feedback unavailable")),
  list: () => Effect.die(new Error("feedback unavailable")),
};

function request(
  method: string,
  params: Record<string, unknown> = {},
  token?: string,
  version = "2026-07-28",
): Request {
  return new Request("https://connections.example/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": version,
      "mcp-method": method,
      ...(typeof params["name"] === "string" ? { "mcp-name": params["name"] } : {}),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: jsonTools.jsonString({
      jsonrpc: "2.0",
      id: 1,
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
}

it("publishes one queue per team", async () => {
  const response = await handle(request("tools/list", {}, "read"));
  const listed = Effect.runSync(Schema.decodeUnknownEffect(ToolListing)(await json(response)));
  const propose = listed.result.tools.find((tool) => tool.name === "propose_transactions");
  const plan = listed.result.tools.find((tool) => tool.name === "get_transaction_plan");
  if (propose === undefined || plan === undefined) {
    throw new Error("Expected the tool list to include both plan tools");
  }
  const published = jsonTools.jsonString(propose.inputSchema);
  expect(published).toContain('"team"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"moves"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"validation"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"places"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"reserve"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"canFree"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"addsWithFixes"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"illegal"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"groups"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"partly_done"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"actions"');
});

it("leaves confirmation to the owner and says a saved move waits", async () => {
  const response = await handle(request("tools/list", {}, "read"));
  const listed = Effect.runSync(Schema.decodeUnknownEffect(ToolListing)(await json(response)));
  const propose = listed.result.tools.find((tool) => tool.name === "propose_transactions");
  if (propose === undefined) {
    throw new Error("Expected the tool list to include propose_transactions");
  }

  expect(listed.result.tools.map((tool) => tool.name)).not.toContain("confirm_transaction_move");
  expect(propose.description).toContain("A saved move waits in Today for the owner to confirm it");
  expect(propose.description).toContain("no tool confirms a move");
});

it("asks an agent for adds, drops, reserves, and activations, in plain words", async () => {
  const response = await handle(request("tools/list", {}, "read"));
  const listed = Effect.runSync(Schema.decodeUnknownEffect(ToolListing)(await json(response)));
  const propose = listed.result.tools.find((tool) => tool.name === "propose_transactions");
  if (propose === undefined) {
    throw new Error("Expected the tool list to include propose_transactions");
  }

  const wording = [
    propose.description,
    ...schemaDescriptions(propose.inputSchema, "propose_transactions.input").map(
      (field) => field.text,
    ),
  ].join(" ");
  expect(wording).toMatch(/the server chooses the place/u);
  expect(wording).toMatch(/Name no slot/u);
  const kinds = schemaLiterals(propose.inputSchema).filter((value) =>
    ["free_agent_add", "waiver_claim", "drop", "trade", "activate", "stash", "slot_move"].includes(
      value,
    ),
  );
  expect(kinds.sort()).toEqual(["activate", "drop", "free_agent_add", "stash", "waiver_claim"]);
  const names = schemaPropertyNames(propose.inputSchema);
  expect(names).toContain("adds");
  expect(names).toContain("drops");
  expect(names).toContain("player");
  expect(names).not.toContain("slotMove");
  expect(names).not.toContain("to");
});

it("publishes fallback choices, a group label, and a stored check on the plan", async () => {
  const response = await handle(request("tools/list", {}, "read"));
  const listed = Effect.runSync(Schema.decodeUnknownEffect(ToolListing)(await json(response)));
  const propose = listed.result.tools.find((tool) => tool.name === "propose_transactions");
  const plan = listed.result.tools.find((tool) => tool.name === "get_transaction_plan");
  if (propose === undefined || plan === undefined) {
    throw new Error("Expected the tool list to include both plan tools");
  }

  expect(jsonTools.jsonString(propose.inputSchema)).toContain('"fallbacks"');
  expect(jsonTools.jsonString(propose.inputSchema)).toContain('"group"');
  expect(jsonTools.jsonString(propose.inputSchema)).toContain('"window"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"checkedAt"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"effectiveDate"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"runDay"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"sendsAt"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"nextCheckAt"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"groupedBy"');
  expect(jsonTools.jsonString(plan.outputSchema)).not.toContain('"runsOn"');
  expect(jsonTools.jsonString(plan.outputSchema)).not.toContain('"nextRunAt"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"reason"');
  expect(jsonTools.jsonString(plan.outputSchema)).toContain('"check"');
  expect(jsonTools.jsonString(propose.inputSchema)).toContain("not the effective date");
});

it("publishes the rolling move list with today, saved, and ended filters", async () => {
  const response = await handle(request("tools/list", {}, "read"));
  const listed = Effect.runSync(Schema.decodeUnknownEffect(ToolListing)(await json(response)));
  const list = listed.result.tools.find((tool) => tool.name === "list_transaction_proposals");
  if (list === undefined) {
    throw new Error("Expected the tool list to include list_transaction_proposals");
  }

  expect(jsonTools.jsonString(list.inputSchema)).toContain('"saved"');
  expect(jsonTools.jsonString(list.inputSchema)).toContain('"ended"');
  expect(jsonTools.jsonString(list.outputSchema)).toContain('"counts"');
  expect(jsonTools.jsonString(list.outputSchema)).toContain('"teamCount"');
  expect(jsonTools.jsonString(list.outputSchema)).toContain('"days"');
  expect(jsonTools.jsonString(list.outputSchema)).toContain('"checkedAt"');
  expect(jsonTools.jsonString(list.outputSchema)).toContain('"teamFacts"');
  expect(jsonTools.jsonString(list.outputSchema)).not.toContain('"sets"');
});

it("points compact player search rows at get_players for detail", async () => {
  const response = await handle(request("tools/list", {}, "read"));
  const listed = Effect.runSync(Schema.decodeUnknownEffect(ToolListing)(await json(response)));
  const search = listed.result.tools.find((tool) => tool.name === "search_players");
  const detail = listed.result.tools.find((tool) => tool.name === "get_players");

  expect(search?.description).toContain("Use `get_players` for stats and full detail");
  expect(detail?.description).toContain("`search_players` or `get_rosters`");
});

it("keeps every published description inside its budget", async () => {
  const response = await handle(request("tools/list", {}, "read"));
  const listed = Effect.runSync(Schema.decodeUnknownEffect(ToolListing)(await json(response)));
  const budgets: Readonly<Record<string, number>> = {
    add_team_agent_note: 220,
    discard_transaction_move: 220,
    get_calendar: 220,
    get_league: 220,
    get_lineup_runs: 220,
    get_matchups: 220,
    get_pending_trade_offers: 220,
    get_players: 220,
    get_rosters: 220,
    get_team_summary: 220,
    get_team_snapshot: 220,
    get_transaction_plan: 300,
    get_transactions: 220,
    list_connections: 220,
    list_feedback: 220,
    list_teams: 220,
    list_transaction_proposals: 360,
    propose_transactions: 400,
    search_players: 220,
    set_lineup: 220,
    set_team_automation: 220,
    submit_feedback: 280,
  };

  expect(listed.result.tools.map((tool) => tool.name).sort()).toEqual(Object.keys(budgets).sort());
  const overBudget = listed.result.tools
    .map((tool) => ({ name: tool.name, length: tool.description.length }))
    .filter((tool) => tool.length > (budgets[tool.name] ?? 0));
  expect(overBudget).toEqual([]);
  expect(
    listed.result.tools.reduce((total, tool) => total + tool.description.length, 0),
  ).toBeLessThanOrEqual(3_900);

  const fields = listed.result.tools.flatMap((tool) => [
    ...schemaDescriptions(tool.inputSchema, `${tool.name}.input`),
    ...schemaDescriptions(tool.outputSchema ?? {}, `${tool.name}.output`),
  ]);
  expect(fields.filter((field) => field.text.length > 200)).toEqual([]);
  expect(fields.reduce((total, field) => total + field.text.length, 0)).toBeLessThanOrEqual(32_000);
});

it("publishes the accepted player-statistics periods and the compact standings form before a call", async () => {
  const response = await handle(request("tools/list", {}, "read"));
  const listed = Effect.runSync(Schema.decodeUnknownEffect(ToolListing)(await json(response)));
  const tool = (name: string): (typeof listed.result.tools)[number] => {
    const found = listed.result.tools.find((entry) => entry.name === name);
    if (found === undefined) {
      throw new Error(`Expected the tool list to include ${name}`);
    }
    return found;
  };

  const playersSchema = jsonTools.jsonString(tool("get_players").inputSchema);
  for (const shape of ["season", "week", "last_days", "last_weeks", "range"]) {
    expect(playersSchema).toContain(shape);
  }
  expect(playersSchema).toContain("periodSupport");
  const searchWindow = jsonTools.jsonString(tool("search_players").inputSchema);
  expect(searchWindow).toContain("last_days");
  expect(searchWindow).toContain("last_weeks");
  expect(searchWindow).toContain("get_league");
  expect(searchWindow).toContain("every player off a roster");
  expect(searchWindow).toContain("`free_agent` lists free agents only");
  expect(searchWindow).toContain("`waiver` lists waiver-listed players only");
  expect(jsonTools.jsonString(tool("get_league").outputSchema)).toContain("playerSearch");
  expect(jsonTools.jsonString(tool("get_players").outputSchema)).toContain("aggregated");
  expect(playersSchema).toContain("1 to 25 private player references");
  expect(playersSchema).toContain("another team");
  expect(playersSchema).toContain('"maxItems":25');
  expect(playersSchema).toContain("league named by");
  const rosterInput = jsonTools.jsonString(tool("get_rosters").inputSchema);
  expect(rosterInput).toContain("`full` adds `undroppable` and `ownerNote`");
  expect(rosterInput).toContain("scope: league");
  expect(rosterInput).toContain("league");
  expect(rosterInput).toContain("whole teams");
  const rosterOutput = jsonTools.jsonString(tool("get_rosters").outputSchema);
  expect(rosterOutput).toContain('"teams"');
  expect(rosterOutput).toContain('"owned"');
  expect(rosterOutput).toContain('"total"');
  expect(rosterOutput).toContain("playsThisWeek");
  expect(rosterOutput).toContain("projectedRank");
  expect(rosterOutput).toContain("Reserve places do not count");
  expect(rosterOutput).toContain('"reserve"');
  expect(rosterOutput).not.toContain("playerSchedule");

  const calendarOutput = jsonTools.jsonString(tool("get_calendar").outputSchema);
  expect(calendarOutput).toContain('"week"');
  expect(calendarOutput).toContain('"games"');
  expect(calendarOutput).toContain("notCovered");
  expect(calendarOutput).not.toContain("lockContext");
  expect(calendarOutput).not.toContain("historical");

  const summaryOutput = jsonTools.jsonString(tool("get_team_summary").outputSchema);
  expect(summaryOutput).toContain("playsThisWeek");
  expect(summaryOutput).not.toContain("probableStarters");
  expect(summaryOutput).toContain("could not be identified");
  expect(summaryOutput).toContain('"unknown"');
  expect(summaryOutput).toContain("transactionTiming");
  expect(summaryOutput).toContain("rosterChange");
  expect(summaryOutput).toContain('"canFree"');
  expect(summaryOutput).toContain('"addsWithFixes"');
  expect(summaryOutput).toContain('"illegal"');
  expect(summaryOutput).toContain("seasonProgress");
  expect(searchWindow).toContain("gamesWindow");
  expect(searchWindow).toContain("next_weeks");
  expect(jsonTools.jsonString(tool("search_players").outputSchema)).toContain("gameDays");
  expect(jsonTools.jsonString(tool("search_players").outputSchema)).toContain("gameWeeks");
  expect(jsonTools.jsonString(tool("search_players").outputSchema)).toContain(
    "plays in a requested window",
  );
  const leagueGames = jsonTools.jsonString(tool("get_league").outputSchema);
  expect(leagueGames).toContain("date_window");
  expect(leagueGames).toContain("scoring_week");
  expect(leagueGames).toContain("refuses a date window");
  expect(leagueGames).toContain("next_weeks");

  const playersOutput = jsonTools.jsonString(tool("get_players").outputSchema);
  expect(playersOutput).toContain("not_published");
  expect(playersOutput).toContain("basis");
  expect(playersOutput).toContain("period");
  expect(playersOutput).toContain("gameDays");
  expect(playersOutput).toContain("gameWeeks");
  expect(jsonTools.jsonString(tool("get_players").inputSchema)).toContain('"schedule"');
  expect(jsonTools.jsonString(tool("get_players").inputSchema)).toContain("gamesWindow");
  expect(jsonTools.jsonString(tool("get_players").inputSchema)).toContain("search_players");
  expect(tool("get_calendar").description).toContain("dated league returns week `unsupported`");
  expect(jsonTools.jsonString(tool("search_players").outputSchema)).toContain("playsThisWeek");
  expect(jsonTools.jsonString(tool("get_league").outputSchema)).toContain("inline player name");
  expect(jsonTools.jsonString(tool("get_pending_trade_offers").outputSchema)).toContain(
    "ownerNote",
  );
  const agentNote = tool("add_team_agent_note");
  const summaryAgentNotes = jsonTools.jsonString(tool("get_team_summary").outputSchema);
  expect(summaryAgentNotes).toContain("client memory");
  expect(summaryAgentNotes).toContain("owner's note");
  expect(agentNote.description).toContain("append-only");
  expect(agentNote.description).toContain("owner's note");
  expect(jsonTools.jsonString(agentNote.outputSchema)).toContain("writtenAt");

  const league = tool("get_league");
  const leagueInput = jsonTools.jsonString(league.inputSchema);
  const leagueOutput = jsonTools.jsonString(league.outputSchema);
  expect(leagueInput).toContain("standingsDetail");
  expect(leagueInput).toContain("compact");
  expect(leagueOutput).toContain("transactionRules");
  expect(leagueOutput).toContain("acquisition limits");
  expect(leagueOutput).toContain("not_set");
  expect(leagueOutput).toContain("acquisitionUsage");
  expect(leagueOutput).toContain("remaining counts");
  expect(league.description).not.toContain("13-team league fits in one result");
  expect(league.description).not.toContain("acquisition usage is not published");

  const transactionRules = jsonTools.jsonString(league.outputSchema);
  expect(transactionRules).toContain("transactionRules");
  expect(transactionRules).toContain("acquisitionLimits");
  expect(transactionRules).toContain("acquisitionUsage");
  expect(transactionRules).toContain("remaining");
  expect(transactionRules).toContain("gamesCaps");
  expect(transactionRules).toContain("not_published");
  expect(transactionRules).toContain("ratification");

  const search = jsonTools.jsonString(tool("search_players").outputSchema);
  expect(search).toContain("percentOwnedDelta");
  expect(search).not.toContain("percentOwnedChange");
  expect(search).toContain("ownership-change window");
  expect(search).toContain("injured_reserve");
  expect(search).toContain("observedAt");

  const scoring = jsonTools.jsonString(tool("get_league").outputSchema);
  expect(scoring).toContain("informational");
  expect(scoring).toContain("published but does not count");

  const cursor = jsonTools.jsonString(tool("get_team_summary").inputSchema);
  expect(cursor).toContain("bound to the call's arguments");
});

function json(response: Response): Promise<unknown> {
  return response.json();
}

const ToolListing = Schema.Struct({
  result: Schema.Struct({
    tools: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        description: Schema.String,
        inputSchema: Schema.Record(Schema.String, Schema.Unknown),
        outputSchema: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
      }),
    ),
  }),
});

type SchemaDescription = { readonly path: string; readonly text: string };

function schemaDescriptions(schema: unknown, path: string): ReadonlyArray<SchemaDescription> {
  if (Array.isArray(schema)) {
    return schema.flatMap((entry, index) => schemaDescriptions(entry, `${path}[${String(index)}]`));
  }
  if (typeof schema !== "object" || schema === null) {
    return [];
  }
  return Object.entries(schema).flatMap(([key, value]) =>
    key === "description" && typeof value === "string"
      ? [{ path, text: value }]
      : schemaDescriptions(value, `${path}.${key}`),
  );
}

function schemaLiterals(schema: unknown): ReadonlyArray<string> {
  if (Array.isArray(schema)) {
    return schema.flatMap((entry) => schemaLiterals(entry));
  }
  if (typeof schema !== "object" || schema === null) {
    return [];
  }
  const record: Readonly<Record<string, unknown>> = { ...schema };
  return Object.entries(record).flatMap(([key, value]) => {
    if (key === "const" && typeof value === "string") {
      return [value];
    }
    if (key === "enum" && Array.isArray(value)) {
      return value.filter((entry): entry is string => typeof entry === "string");
    }
    return schemaLiterals(value);
  });
}

function schemaPropertyNames(schema: unknown): ReadonlyArray<string> {
  if (Array.isArray(schema)) {
    return schema.flatMap((entry) => schemaPropertyNames(entry));
  }
  if (typeof schema !== "object" || schema === null) {
    return [];
  }
  const record: Readonly<Record<string, unknown>> = { ...schema };
  return Object.entries(record).flatMap(([key, value]) => {
    if (key === "properties" && typeof value === "object" && value !== null) {
      return [...Object.keys(value), ...schemaPropertyNames(value)];
    }
    return schemaPropertyNames(value);
  });
}
