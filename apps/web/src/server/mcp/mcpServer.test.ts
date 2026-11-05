import { it as effectIt } from "@effect/vitest";
import { AuthService } from "@lineupkeep/backend/auth/Auth";
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
  PlayerRef,
  QueryCursorInvalid,
  QuerySelectionInvalid,
} from "@lineupkeep/backend/connections/QueryValues";
import type { TeamsShape } from "@lineupkeep/backend/connections/Teams";
import { Teams } from "@lineupkeep/backend/connections/Teams";
import type {
  ProposalSet,
  ProposalSetReview,
  ProposeTransactionsResult,
  TransactionProposalsShape,
} from "@lineupkeep/backend/connections/TransactionProposals";
import {
  ProposalItem,
  ProposalSetExpired,
  ProposalSetId,
  TransactionProposals,
} from "@lineupkeep/backend/connections/TransactionProposals";
import type { ReviewLinksData } from "@lineupkeep/backend/connections/TransactionReview";
import type { TransactionReviewsShape } from "@lineupkeep/backend/connections/TransactionReview";
import { TransactionReviews } from "@lineupkeep/backend/connections/TransactionReview";
import {
  Feedback,
  FeedbackContentInvalid,
  FeedbackId,
  FeedbackRateLimited,
} from "@lineupkeep/backend/feedback/Feedback";
import type { FeedbackShape } from "@lineupkeep/backend/feedback/Feedback";
import { FeedbackPersistenceFailed } from "@lineupkeep/backend/feedback/Feedback";
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

it("identifies the product during protocol discovery", async () => {
  const response = await handle(request("server/discover", {}, "read"));

  expect(response.status).toBe(200);
  const body = Schema.decodeUnknownSync(DiscoveryDocument)(await response.json());
  expect(body.result._meta["io.modelcontextprotocol/serverInfo"]).toEqual({
    name: "Lineupkeep",
    version: "1.0.0",
  });
  expect(body.result.capabilities).toEqual({ tools: {} });
});

it("answers server discovery without a token and publishes the same document", async () => {
  const anonymous = await handle(request("server/discover"));
  const authenticated = await handle(request("server/discover", {}, "read"));

  expect(anonymous.status).toBe(200);
  expect(await anonymous.json()).toEqual(await authenticated.json());
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
        Effect.provide(Layer.merge(authentication, permissiveQuota)),
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
        Effect.provide(Layer.merge(authentication, permissiveQuota)),
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
  expect(JSON.stringify(body)).not.toContain("teams:manage");
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
  expect(JSON.stringify(body)).not.toContain("transactions:review");
  expect(JSON.stringify(body)).not.toContain("fantasy:read");
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
        Effect.provide(
          Layer.merge(
            Layer.succeed(AuthService)({
              signInMethods: { google: false },
              oauthResource: "https://connections.example/mcp",
              onboardingScopes: [{ name: "example:read", description: "Read examples." }],
              getConsentRequest: () => Effect.succeed({ status: "invalid" as const }),
              consent: () => Effect.succeed("https://client.test/callback"),
              handle: () => Effect.succeed(new Response()),
              getSession: () => Effect.void.pipe(Effect.as(undefined)),
              resolveAccessToken: (_token, scopes) => {
                requested.push(scopes);
                return Effect.succeed({
                  status: "authenticated" as const,
                  userId: decodeUserId("reader"),
                });
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
        ).pipe(Effect.provide(Layer.merge(authentication, quota)));
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
  expect(JSON.stringify(body)).toContain('"readOnlyHint":true');
  expect(JSON.stringify(body)).not.toContain('"userId"');
  const decoded = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
    }),
  )(body);
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
    "generate_transaction_review_links",
    "propose_transactions",
    "get_transaction_proposal_set",
    "revalidate_transaction_proposal_set",
    "get_pending_trade_offers",
    "set_lineup",
    "get_lineup_runs",
    "set_team_automation",
    "submit_feedback",
    "list_feedback",
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
  expect(JSON.stringify(body)).toContain("internal server error");
  expect(JSON.stringify(body)).not.toContain("private database");
});

it("enforces fantasy read scope and serves bounded query results over MCP", async () => {
  const queries: FantasyQueriesShape = {
    ...unavailableQueries,
    listTeams: () =>
      Effect.succeed({
        status: "ok",
        teams: [],
        page: { returned: 0, complete: true, remaining: 0 },
        budget: { targetBytes: 12_288, hardLimitBytes: 16_384 },
      }),
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(queries),
    Layer.succeed(TransactionReviews)(unavailableReviews),
    Layer.succeed(TransactionProposals)(unavailableProposals),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const run = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(Effect.provide(program, services)),
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
  const teamId = Schema.decodeSync(TeamId)("00000000-0000-7000-8000-000000000001");
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
        budget: { targetBytes: 12_288, hardLimitBytes: 16_384 },
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
    Layer.succeed(TransactionReviews)(unavailableReviews),
    Layer.succeed(TransactionProposals)(unavailableProposals),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(feedback),
  );
  const run = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(Effect.provide(program, services)),
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
  const teamId = Schema.decodeSync(TeamId)("00000000-0000-7000-8000-000000000001");
  const run = (arguments_: Record<string, unknown>, name: string): Promise<Response> =>
    handleMcpRequest(
      request("tools/call", { name, arguments: arguments_ }, "fantasy"),
      (_request, _operation, program) =>
        Effect.runPromise(
          Effect.provide(
            program,
            Layer.mergeAll(
              authentication,
              permissiveQuota,
              Layer.succeed(Connections)(unavailableConnections),
              Layer.succeed(FantasyQueries)(unavailableQueries),
              Layer.succeed(TransactionReviews)(unavailableReviews),
              Layer.succeed(TransactionProposals)(unavailableProposals),
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
    expect(JSON.stringify(malformedBody)).toContain("Expected a valid UTC DateTime string");
    expect(JSON.stringify(malformedBody)).toContain("since");
    expect(tagged.status).toBe(400);
    expect(taggedBody).toMatchObject({ error: { code: -32_602, data: { field: '["since"]' } } });
  }
});

it("reaches search_players with an empty query and returns the remedy instead of invalid-params", async () => {
  const teamId = Schema.decodeSync(TeamId)("00000000-0000-7000-8000-000000000001");
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
    Layer.succeed(TransactionReviews)(unavailableReviews),
    Layer.succeed(TransactionProposals)(unavailableProposals),
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
    (_request, _operation, program) => Effect.runPromise(Effect.provide(program, services)),
  );
  const body = await json(response);

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ result: { isError: true } });
  expect(JSON.stringify(body)).toContain('\\"code\\":\\"selection_invalid\\"');
  expect(JSON.stringify(body)).toContain("Omit the query");
});

it("publishes and serves the scoring-period schedule group over MCP", async () => {
  const teamId = Schema.decodeSync(TeamId)("00000000-0000-7000-8000-000000000001");
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
              player: Schema.decodeSync(PlayerRef)("r1.test"),
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
        coverage: [],
        failures: [],
        page: { returned: 0, complete: true, remaining: 0 },
        budget: { targetBytes: 12_288, hardLimitBytes: 16_384 },
      }),
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(queries),
    Layer.succeed(TransactionReviews)(unavailableReviews),
    Layer.succeed(TransactionProposals)(unavailableProposals),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const run = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(Effect.provide(program, services)),
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
  expect(JSON.stringify(listed)).toContain("schedule.detail");
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
  const teamId = Schema.decodeSync(TeamId)("00000000-0000-7000-8000-000000000001");
  const queries: FantasyQueriesShape = {
    ...unavailableQueries,
    getTeamSummary: () => Effect.fail(QueryCursorInvalid.make({ reason: "mismatch" })),
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(queries),
    Layer.succeed(TransactionReviews)(unavailableReviews),
    Layer.succeed(TransactionProposals)(unavailableProposals),
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
    (_request, _operation, program) => Effect.runPromise(Effect.provide(program, services)),
  );
  const body = await json(response);
  const text = JSON.stringify(body);

  expect(response.status).toBe(200);
  expect(body).toMatchObject({ result: { isError: true } });
  expect(text).toContain('\\"code\\":\\"cursor_invalid\\"');
  expect(text).toContain("issued for a different request");
  expect(text).not.toContain("invalid or expired");
});

it("requires transaction review scope and returns human-review-only links", async () => {
  const teamId = Schema.decodeSync(TeamId)("00000000-0000-7000-8000-000000000001");
  const reviewData: ReviewLinksData = {
    status: "ok",
    team: {
      id: teamId,
      name: "Alpha",
      provider: decodeProviderKey("yahoo"),
      league: "nfl",
      sport: "football",
      season: 2026,
    },
    linkTemplate: { provider: decodeProviderKey("yahoo"), version: "yahoo-review-links-v2" },
    links: [
      {
        status: "review_only",
        index: 0,
        kind: "add",
        url: "https://football.fantasysports.yahoo.com/f1/1000/addplayer?apid=10001",
        players: [Schema.decodeSync(PlayerRef)("r1.test")],
        humanReview: "Review this proposal in the provider interface.",
      },
    ],
    instruction: "Review each proposal in the provider interface.",
    ownerNote: { status: "not_set" },
    coverage: [],
    failures: [],
    page: { returned: 1, complete: true, remaining: 0 },
    budget: { targetBytes: 12_288, hardLimitBytes: 16_384 },
  };
  const reviews: TransactionReviewsShape = {
    ...unavailableReviews,
    generate: () => Effect.succeed(reviewData),
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(unavailableQueries),
    Layer.succeed(TransactionReviews)(reviews),
    Layer.succeed(TransactionProposals)(unavailableProposals),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const run = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(Effect.provide(program, services)),
    );
  const arguments_ = {
    team: teamId,
    intents: [{ kind: "add", add: Schema.decodeSync(PlayerRef)("r1.test") }],
  };

  const denied = await run(
    request(
      "tools/call",
      { name: "generate_transaction_review_links", arguments: arguments_ },
      "fantasy",
    ),
  );
  const allowed = await run(
    request(
      "tools/call",
      { name: "generate_transaction_review_links", arguments: arguments_ },
      "review",
    ),
  );

  expect(denied.status).toBe(403);
  expect(denied.headers.get("www-authenticate")).toContain('scope="transactions:review"');
  expect(allowed.status).toBe(200);
  const body = await json(allowed);
  expect(body).toMatchObject({
    result: {
      isError: false,
      structuredContent: {
        status: "ok",
        links: [{ status: "review_only", kind: "add" }],
      },
    },
  });
  expect(JSON.stringify(body)).not.toContain("submit");
});

it("proposes a transaction set under the review scope and returns the review link", async () => {
  const at = DateTime.makeUnsafe("2026-10-25T12:00:00Z");
  const team = decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c9164b0");
  const set: ProposalSet = {
    id: Schema.decodeSync(ProposalSetId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164d0"),
    proposedBy: { kind: "agent", reference: "mcp", surface: "mcp" },
    createdAt: at,
    expiresAt: DateTime.addDuration(at, 86_400_000),
    expired: false,
    reviewPath: "/transactions/018f79ea-7d86-7c18-9b4a-8b4d0c9164d0",
  };
  const providerRefusal =
    "The provider rejected the transaction with HTTP 400. It said: Player Travis Konecny is in a IR position on your roster, but is no longer on the real-life IR. Please edit your lineup to activate this player from your IR and then attempt your transaction again.";
  const illegalDetail =
    "Travis Konecny is in the IR slot, but it does not accept his positions (LW, RW). No open slot accepts him, and choosing which player to drop is yours. Drop a player to make room, then propose this transaction again.";
  const failedItem = Schema.decodeSync(ProposalItem)({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9164d1",
    team,
    kind: "drop",
    adds: [],
    drops: [],
    reason: "A stated reason.",
    state: "failed",
    staleness: { status: "current", checkedAt: at, reasons: [] },
    execution: {
      outcome: "failed",
      detail: providerRefusal,
      decidedAt: at,
      steps: [],
    },
    createdAt: at,
    updatedAt: at,
  });
  const illegalItem = Schema.decodeSync(ProposalItem)({
    id: "018f79ea-7d86-7c18-9b4a-8b4d0c9164d2",
    team,
    kind: "drop",
    adds: [],
    drops: [],
    reason: "A stated reason.",
    state: "proposed",
    staleness: {
      status: "illegal",
      checkedAt: at,
      reasons: [{ code: "slot_illegal", detail: illegalDetail }],
    },
    createdAt: at,
    updatedAt: at,
  });
  const review = {
    set,
    teams: [
      {
        team: {
          id: team,
          name: "Alpha",
          provider: decodeProviderKey("yahoo"),
          league: "nfl",
          sport: "football",
          season: 2026,
        },
        items: [failedItem, illegalItem],
        pendingOffers: [],
      },
    ],
  } satisfies ProposalSetReview;
  const proposed: Array<{ userId: string; proposer: unknown }> = [];
  let revalidations = 0;
  const proposals: TransactionProposalsShape = {
    ...unavailableProposals,
    propose: (userId, proposer) => {
      proposed.push({ userId, proposer });
      return Effect.succeed({
        set,
        created: true,
        items: [],
        detail: "Created the set.",
      } satisfies ProposeTransactionsResult);
    },
    read: () => Effect.succeed(review),
    revalidate: () => {
      revalidations += 1;
      return revalidations === 1
        ? Effect.succeed(review)
        : Effect.fail(ProposalSetExpired.make({ set: set.id, expiresAt: set.expiresAt }));
    },
    readPendingOffers: () => Effect.die(new Error("pending offers are not read here")),
  };
  const services = Layer.mergeAll(
    authentication,
    permissiveQuota,
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(unavailableQueries),
    Layer.succeed(TransactionReviews)(unavailableReviews),
    Layer.succeed(TransactionProposals)(proposals),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const call = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(Effect.provide(program, services)),
    );
  const arguments_ = {
    items: [{ team, kind: "drop", adds: [], drops: ["r1.test"], reason: "A stated reason." }],
  };

  const denied = await call(
    request("tools/call", { name: "propose_transactions", arguments: arguments_ }, "fantasy"),
  );

  expect(denied.status).toBe(403);
  expect(denied.headers.get("www-authenticate")).toContain('scope="transactions:review"');
  expect(proposed).toEqual([]);

  const allowed = await call(
    request("tools/call", { name: "propose_transactions", arguments: arguments_ }, "review"),
  );
  const body = await json(allowed);

  expect(allowed.status).toBe(200);
  expect(body).toMatchObject({
    result: {
      isError: false,
      structuredContent: {
        created: true,
        reviewUrl: "https://connections.example/transactions/018f79ea-7d86-7c18-9b4a-8b4d0c9164d0",
        set: { id: "018f79ea-7d86-7c18-9b4a-8b4d0c9164d0", expired: false },
      },
    },
  });
  expect(proposed).toEqual([
    {
      userId: "reader",
      proposer: { kind: "agent", reference: "mcp", surface: "mcp" },
    },
  ]);
  expect(revalidations).toBe(1);

  const read = await call(
    request(
      "tools/call",
      { name: "get_transaction_proposal_set", arguments: { set: set.id } },
      "review",
    ),
  );
  expect(read.status).toBe(200);
  const readBody = await json(read);
  expect(readBody).toMatchObject({
    result: {
      isError: false,
      structuredContent: {
        reviewUrl: "https://connections.example/transactions/018f79ea-7d86-7c18-9b4a-8b4d0c9164d0",
      },
    },
  });
  expect(JSON.stringify(readBody)).toContain(providerRefusal);
  expect(JSON.stringify(readBody)).toContain(illegalDetail);

  const expired = await call(
    request(
      "tools/call",
      { name: "revalidate_transaction_proposal_set", arguments: { set: set.id } },
      "review",
    ),
  );
  const expiredBody = await json(expired);
  expect(expiredBody).toMatchObject({ result: { isError: true } });
  expect(JSON.stringify(expiredBody)).toContain("expired");
  expect(JSON.stringify(expiredBody)).not.toContain("cause");
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
            run: Schema.decodeSync(LineupRunId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164b1"),
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
    Layer.succeed(TransactionReviews)(unavailableReviews),
    Layer.succeed(TransactionProposals)(unavailableProposals),
    Layer.succeed(LineupRuns)(lineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const call = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(Effect.provide(program, services)),
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
  expect(JSON.stringify(body)).not.toContain("completed");
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
    Layer.succeed(TransactionReviews)(unavailableReviews),
    Layer.succeed(TransactionProposals)(unavailableProposals),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(teams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  const call = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(Effect.provide(program, services)),
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
          id: Schema.decodeSync(FeedbackId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164b3"),
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
          id: Schema.decodeSync(FeedbackId)("018f79ea-7d86-7c18-9b4a-8b4d0c9164b3"),
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
    Layer.succeed(TransactionReviews)(unavailableReviews),
    Layer.succeed(TransactionProposals)(unavailableProposals),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(feedback),
  );
  const call = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(Effect.provide(program, services)),
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
  expect(JSON.stringify(body)).not.toContain("cause");

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
          Effect.provide(
            program,
            Layer.mergeAll(
              authentication,
              permissiveQuota,
              Layer.succeed(Connections)(unavailableConnections),
              Layer.succeed(FantasyQueries)(unavailableQueries),
              Layer.succeed(TransactionReviews)(unavailableReviews),
              Layer.succeed(TransactionProposals)(unavailableProposals),
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
  expect(JSON.stringify(throttledBody)).toContain("900 seconds");
  expect(invalidBody).toMatchObject({ result: { isError: true } });
  expect(JSON.stringify(invalidBody)).toContain("control characters");
  const failedBody = await json(failed);
  expect(failed.status).toBe(200);
  expect(JSON.stringify(failedBody)).not.toContain("private database");
  expect(JSON.stringify(failedBody)).toContain("internal server error");
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

const authentication = Layer.succeed(AuthService)({
  signInMethods: { google: false },
  oauthResource: "https://connections.example/mcp",
  onboardingScopes: [
    { name: "fantasy:read", description: "Read fantasy data." },
    { name: "offline_access", description: "Stay connected." },
  ],
  getSession: () => Effect.void.pipe(Effect.as(undefined)),
  handle: () => Effect.succeed(new Response()),
  getConsentRequest: () => Effect.succeed({ status: "invalid" as const }),
  consent: () => Effect.succeed("https://client.test/callback"),
  resolveAccessToken: (token, scopes) => {
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
        ? { status: "authenticated" as const, userId: decodeUserId("reader") }
        : { status: "insufficient_scope" as const },
    );
  },
});
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
    Layer.succeed(TransactionReviews)(unavailableReviews),
    Layer.succeed(TransactionProposals)(unavailableProposals),
    Layer.succeed(LineupRuns)(unavailableLineups),
    Layer.succeed(Teams)(unavailableTeams),
    Layer.succeed(Feedback)(unavailableFeedback),
  );
  return handleMcpRequest(request, (_request, _operation, program) =>
    Effect.runPromise(Effect.provide(program, services)),
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
const unavailableReviews: TransactionReviewsShape = {
  generate: () => Effect.die(new Error("reviews unavailable")),
};
const unavailableProposals: TransactionProposalsShape = {
  propose: () => Effect.die(new Error("proposals unavailable")),
  revalidate: () => Effect.die(new Error("proposals unavailable")),
  read: () => Effect.die(new Error("proposals unavailable")),
  submit: () => Effect.die(new Error("proposals unavailable")),
  readPendingOffers: () => Effect.die(new Error("proposals unavailable")),
  withdrawTrade: () => Effect.die(new Error("proposals unavailable")),
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
    body: JSON.stringify({
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

it("publishes the accepted player-statistics periods and the compact standings form before a call", async () => {
  const response = await handle(request("tools/list", {}, "read"));
  const body = await json(response);
  const listed = Schema.decodeUnknownSync(
    Schema.Struct({
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
    }),
  )(body);
  const tool = (name: string): (typeof listed.result.tools)[number] => {
    const found = listed.result.tools.find((entry) => entry.name === name);
    if (found === undefined) {
      throw new Error(`Expected the tool list to include ${name}`);
    }
    return found;
  };

  const players = JSON.stringify(tool("get_players").inputSchema);
  for (const shape of [
    "season",
    "preset",
    "range",
    "last_7_days",
    "last_14_days",
    "last_30_days",
  ]) {
    expect(players).toContain(shape);
  }
  expect(tool("get_players").description).toContain("periodSupport");
  expect(tool("get_players").description).toContain("aggregated");
  expect(tool("get_players").description).toContain("25-reference");
  expect(tool("get_players").description).toContain("another team");
  expect(players).toContain("25-reference");
  expect(players).toContain("league named by");
  expect(tool("get_rosters").description).toContain("ownerNote");
  expect(tool("get_rosters").description).toContain("detail: full");
  expect(tool("get_rosters").description).toContain('scope: "league"');
  const rosterInput = JSON.stringify(tool("get_rosters").inputSchema);
  expect(rosterInput).toContain("league");
  expect(rosterInput).toContain("whole teams");
  const rosterOutput = JSON.stringify(tool("get_rosters").outputSchema);
  expect(rosterOutput).toContain('"teams"');
  expect(rosterOutput).toContain('"owned"');
  expect(rosterOutput).toContain('"total"');
  expect(tool("get_league").description).toContain("inline player name");
  expect(tool("get_pending_trade_offers").description).toContain("ownerNote");
  expect(tool("generate_transaction_review_links").description).toContain("ownerNote");

  const league = tool("get_league");
  expect(JSON.stringify(league.inputSchema)).toContain("standingsDetail");
  expect(JSON.stringify(league.inputSchema)).toContain("compact");
  expect(league.description).toContain("13");
  expect(league.description).toContain("transactionRules");
  expect(league.description).toContain("acquisition limits");
  expect(league.description).toContain("not_set");
  expect(league.description).toContain("acquisitionUsage");
  expect(league.description).toContain("remaining count");
  expect(league.description).not.toContain("13-team league fits in one result");
  expect(league.description).toContain("not_set");
  expect(league.description).not.toContain("acquisition usage is not published");

  const transactionRules = JSON.stringify(league.outputSchema);
  expect(transactionRules).toContain("transactionRules");
  expect(transactionRules).toContain("acquisitionLimits");
  expect(transactionRules).toContain("acquisitionUsage");
  expect(transactionRules).toContain("remaining");
  expect(transactionRules).toContain("gamesCaps");
  expect(transactionRules).toContain("not_published");
  expect(transactionRules).toContain("ratification");

  const search = JSON.stringify(tool("search_players").outputSchema);
  expect(search).toContain("percentOwnedDelta");
  expect(search).not.toContain("percentOwnedChange");
  expect(search).toContain("ownership-change window");
  expect(search).toContain("injured_reserve");
  expect(search).toContain("observedAt");

  const scoring = JSON.stringify(tool("get_league").outputSchema);
  expect(scoring).toContain("informational");
  expect(scoring).toContain("display-only");

  const cursor = JSON.stringify(tool("get_team_summary").inputSchema);
  expect(cursor).toContain("bound to the arguments");
});

function json(response: Response): Promise<unknown> {
  return response.json();
}
