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
import { PlayerRef, QuerySelectionInvalid } from "@lineupkeep/backend/connections/QueryValues";
import type { ReviewLinksData } from "@lineupkeep/backend/connections/TransactionReview";
import type { TransactionReviewsShape } from "@lineupkeep/backend/connections/TransactionReview";
import { TransactionReviews } from "@lineupkeep/backend/connections/TransactionReview";
import { DateTime, Effect, Layer, Schema } from "effect";
import { Tool, Toolkit } from "effect/ai";
import { expect, it } from "vitest";

import { mcpRequest } from "./mcpEndpoint";
import { handleMcpRequest } from "./mcpServer";
import { RequiredScope } from "./toolAuthorization";

it("identifies the product during protocol discovery", async () => {
  const response = await handle(request("server/discover", {}, "read"));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    result: {
      _meta: {
        "io.modelcontextprotocol/serverInfo": { name: "Lineupkeep", version: "1.0.0" },
      },
    },
  });
});

it("derives the endpoint path and discovery challenge from the Auth resource", async () => {
  const tools = Toolkit.make();
  const run = (invocation: Request): Promise<Response> =>
    Effect.runPromise(
      mcpRequest(invocation, tools, () => Layer.empty, { name: "Example", version: "1" }).pipe(
        Effect.updateService(AuthService, (auth) => ({
          ...auth,
          oauthResource: "https://connections.example/agents",
        })),
        Effect.provide(authentication),
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
        Effect.provide(authentication),
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

it("challenges an unauthenticated client with protected-resource discovery and the whole scope set", async () => {
  const response = await handle(request("tools/list"));
  const body = await json(response);

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBe(
    'Bearer resource_metadata="https://connections.example/.well-known/oauth-protected-resource/mcp", scope="connections:read fantasy:read example:write"',
  );
  expect(body).toMatchObject({
    error: "unauthorized",
    scope: "connections:read fantasy:read example:write",
    resource_metadata: "https://connections.example/.well-known/oauth-protected-resource/mcp",
  });
});

it("names the required scope in a 403 body and points at the full advertised set", async () => {
  const response = await handle(
    request("tools/call", { name: "set_lineup", arguments: {} }, "read"),
  );
  const body = await json(response);

  expect(response.status).toBe(403);
  expect(body).toMatchObject({ error: "insufficient_scope", scope: "lineups:write" });
  expect(JSON.stringify(body)).toContain("connections:read fantasy:read example:write");
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
    "get_transactions",
    "generate_transaction_review_links",
    "set_lineup",
    "get_lineup_runs",
  ]);
});

it("rejects unexpected connection arguments as JSON-RPC invalid-params", async () => {
  const response = await handle(
    request("tools/call", { name: "list_connections", arguments: { limit: 1 } }, "read"),
  );

  expect(await json(response)).toMatchObject({ id: 1, error: { code: -32602 } });
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
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(queries),
    Layer.succeed(TransactionReviews)(unavailableReviews),
    Layer.succeed(LineupRuns)(unavailableLineups),
  );
  const run = (invocation: Request): Promise<Response> =>
    handleMcpRequest(invocation, (_request, _operation, program) =>
      Effect.runPromise(Effect.provide(program, services)),
    );

  const denied = await run(request("tools/call", { name: "list_teams", arguments: {} }, "read"));
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
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(queries),
    Layer.succeed(TransactionReviews)(unavailableReviews),
    Layer.succeed(LineupRuns)(unavailableLineups),
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

it("requires transaction review scope and returns human-review-only links", async () => {
  const teamId = Schema.decodeSync(TeamId)("00000000-0000-7000-8000-000000000001");
  const reviewData: ReviewLinksData = {
    status: "ok",
    team: {
      id: teamId,
      name: "Alpha",
      provider: "yahoo",
      league: "nfl",
      sport: "football",
      season: 2026,
    },
    links: [
      {
        status: "review_only",
        index: 0,
        kind: "add",
        url: "https://football.fantasysports.yahoo.com/f1/1000/add?apid=10001",
        players: [Schema.decodeSync(PlayerRef)("r1.test")],
        humanReview: "Review this proposal in the provider interface.",
      },
    ],
    instruction: "Review each proposal in the provider interface.",
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
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(unavailableQueries),
    Layer.succeed(TransactionReviews)(reviews),
    Layer.succeed(LineupRuns)(unavailableLineups),
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
    Layer.succeed(Connections)(unavailableConnections),
    Layer.succeed(FantasyQueries)(unavailableQueries),
    Layer.succeed(TransactionReviews)(unavailableReviews),
    Layer.succeed(LineupRuns)(lineups),
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

const authentication = Layer.succeed(AuthService)({
  signInMethods: { google: false },
  oauthResource: "https://connections.example/mcp",
  advertisedScopes: [
    { name: "connections:read", description: "Read connections." },
    { name: "fantasy:read", description: "Read fantasy data." },
    { name: "example:write", description: "Change examples." },
  ],
  getSession: () => Effect.void.pipe(Effect.as(undefined)),
  handle: () => Effect.succeed(new Response()),
  getConsentRequest: () => Effect.succeed({ status: "invalid" as const }),
  consent: () => Effect.succeed("https://client.test/callback"),
  claimDeviceAuthorization: () => Effect.succeed({ clientId: "helper", scope: "connections:read" }),
  approveDeviceAuthorization: () => Effect.void,
  denyDeviceAuthorization: () => Effect.void,
  resolveAccessToken: (token, scopes) => {
    const granted =
      token === "read"
        ? ["connections:read", "example:read"]
        : token === "fantasy"
          ? ["fantasy:read"]
          : token === "review"
            ? ["transactions:review"]
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
  startLinking: () => Effect.succeed([]),
  startReconnect: () => Effect.succeed([]),
  cancelLinking: () => Effect.succeed([]),
  completeLinking: () => Effect.succeed([]),
  completeReconnect: () => Effect.succeed([]),
  reconnect: () => Effect.succeed([]),
  disconnect: () => Effect.succeed([]),
  discoverTeams: () => Effect.succeed([]),
  listTeams: () => Effect.succeed([]),
};

function handle(
  request: Request,
  connections: ConnectionsShape = unavailableConnections,
): Promise<Response> {
  const services = Layer.mergeAll(
    authentication,
    Layer.succeed(Connections)(connections),
    Layer.succeed(FantasyQueries)(unavailableQueries),
    Layer.succeed(TransactionReviews)(unavailableReviews),
    Layer.succeed(LineupRuns)(unavailableLineups),
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
};
const unavailableReviews: TransactionReviewsShape = {
  generate: () => Effect.die(new Error("reviews unavailable")),
};
const unavailableLineups: LineupRunsShape = {
  submit: () => Effect.die(new Error("lineups unavailable")),
  get: () => Effect.die(new Error("lineups unavailable")),
  wait: () => Effect.die(new Error("lineups unavailable")),
  runsForRequest: () => Effect.die(new Error("lineups unavailable")),
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

function json(response: Response): Promise<unknown> {
  return response.json();
}
