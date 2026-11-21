import { AuthService } from "@lineupkeep/backend/auth/Auth";
import type { AccessTokenResolution, AuthenticatedAgent } from "@lineupkeep/backend/auth/Auth";
import type { AuthorizationScope } from "@lineupkeep/backend/auth/AuthorizationScopes";
import { ToolCallQuota } from "@lineupkeep/backend/toolCalls/ToolCallQuota";
import type {
  ToolCallDecision,
  ToolCallQuotaUnavailable,
} from "@lineupkeep/backend/toolCalls/ToolCallQuota";
import { EffectString } from "@lineupkeep/collections";
import { optionalStringValue } from "@lineupkeep/collections";
import { Context, DateTime, Duration, Effect, Layer, Option, Result, Schema } from "effect";
import { Array as EffectArray } from "effect";
import { Option as EffectOption } from "effect";
import { Record as EffectRecord } from "effect";
import { McpProtocol, McpServer } from "effect/ai";
import type { Tool, Toolkit } from "effect/ai";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { RequiredScope, toolCallClass } from "./toolAuthorization";

export const mcpRequest = Effect.fnUntraced(function* <Tools extends Record<string, Tool.Any>, R>(
  request: Request,
  toolkit: Toolkit.Toolkit<Tools>,
  handlers: (agent: AuthenticatedAgent) => Layer.Layer<Tool.HandlersFor<Tools>, never, R>,
  application: ApplicationIdentity,
) {
  const auth = yield* AuthService;
  const resource = new URL(auth.oauthResource);
  const invocation = yield* readInvocation(request, toolkit);
  const presented = bearerToken(request.headers);

  if (Option.isSome(invocation.rpc) && invocation.rpc.value.method === discoveryMethod) {
    const grant =
      presented === undefined ? undefined : yield* auth.resolveAccessToken(presented, []);
    return yield* discoveryResponse(invocation.rpc.value, application, {
      accessTokenLifetimeSeconds: Duration.toSeconds(auth.accessTokenLifetime),
      refreshTokenGrantSupported: true,
      ...(grant === undefined ? {} : { accessToken: yield* accessTokenReport(grant) }),
    });
  }

  const scopes = requiredScopes(invocation.tool);
  const identity =
    presented === undefined
      ? { status: "invalid" as const }
      : yield* auth.resolveAccessToken(presented, scopes);
  if (identity.status !== "authenticated") {
    return yield* challengeResponse(
      resource,
      identity.status,
      identity.status === "invalid" ? identity.reason : undefined,
      challengeScope(invocation, auth.onboardingScopes),
      presented !== undefined,
    );
  }
  yield* Effect.annotateCurrentSpan({
    "auth.state": "authenticated",
    "user.id": identity.userId,
  });
  const refusal = yield* quotaRefusal(invocation, identity);
  if (refusal !== undefined) {
    return refusal;
  }
  const invalid = invalidArgumentsResponse(invocation);
  if (invalid !== undefined) {
    yield* Effect.annotateCurrentSpan({
      "app.outcome": "rejected",
      "http.response.status_code": 400,
    });
    return invalid;
  }
  return yield* serveToolkit(request, toolkit, handlers(identity), resource, application);
}, Effect.scoped);

function readInvocation<Tools extends Record<string, Tool.Any>>(
  request: Request,
  toolkit: Toolkit.Toolkit<Tools>,
): Effect.Effect<Invocation, never, never> {
  return Effect.gen(function* () {
    const input = yield* Effect.tryPromise({
      try: () => request.clone().json(),
      catch: () => "invalid_json" as const,
    }).pipe(Effect.option);
    const rpc = Option.isSome(input)
      ? Schema.decodeUnknownOption(RpcRequest)(input.value)
      : Option.none();
    const call = Option.isSome(rpc)
      ? Schema.decodeUnknownOption(ToolCall)(rpc.value)
      : Option.none();
    const tool = Option.isSome(call)
      ? EffectOption.getOrUndefined(
          EffectArray.findFirst(
            EffectRecord.values(toolkit.tools),
            (tool) => tool.name === call.value.params.name,
          ),
        )
      : undefined;
    return { rpc, call, tool };
  });
}

function requiredScopes(tool: Tool.Any | undefined): ReadonlyArray<string> {
  return tool === undefined ? [] : [requiredScope(tool)];
}

function requiredScope(tool: Tool.Any): string {
  return Context.getUnsafe(tool.annotations, RequiredScope).name;
}

function challengeScope(
  invocation: Invocation,
  onboardingScopes: ReadonlyArray<AuthorizationScope>,
): string {
  if (invocation.tool !== undefined) {
    return requiredScope(invocation.tool);
  }
  return EffectArray.join(
    EffectArray.map(onboardingScopes, (scope) => scope.name),
    " ",
  );
}

function bearerToken(headers: Headers): string | undefined {
  const authorization = headers.get("authorization");
  return authorization === null ? undefined : /^Bearer ([^\s]+)$/iu.exec(authorization)?.[1];
}

function discoveryResponse(
  rpc: RpcRequest,
  application: ApplicationIdentity,
  grant: GrantReport,
): Effect.Effect<Response, never, never> {
  return Effect.gen(function* () {
    const requested = requestedProtocolVersion(rpc.params);
    if (requested !== undefined && requested !== supportedProtocolVersion) {
      yield* Effect.annotateCurrentSpan({
        "app.outcome": "rejected",
        "http.response.status_code": 400,
      });
      return Response.json(
        {
          jsonrpc: "2.0",
          id: rpc.id ?? null,
          error: {
            code: unsupportedProtocolVersionCode,
            message: `Unsupported protocol version '${requested}'`,
            data: { supported: [supportedProtocolVersion], requested },
          },
        },
        { status: 400 },
      );
    }
    yield* Effect.annotateCurrentSpan({
      "app.outcome": "success",
      "http.response.status_code": 200,
      "mcp.method": discoveryMethod,
    });
    return Response.json({
      jsonrpc: "2.0",
      id: rpc.id ?? null,
      result: {
        _meta: {
          "io.modelcontextprotocol/serverInfo": application,
          "lineupkeep/grant": grant,
        },
        resultType: "complete",
        ttlMs: 0,
        cacheScope: "private",
        supportedVersions: [supportedProtocolVersion],
        capabilities: {
          tools: {},
        },
      },
    });
  });
}

function requestedProtocolVersion(params: unknown): string | undefined {
  const metadata = Schema.decodeUnknownOption(RequestMetadata)(params);
  return Option.isSome(metadata)
    ? metadata.value._meta?.["io.modelcontextprotocol/protocolVersion"]
    : undefined;
}

function challengeResponse(
  resource: URL,
  status: "invalid" | "insufficient_scope",
  reason: "expired" | undefined,
  scope: string,
  tokenPresented: boolean,
): Effect.Effect<Response, never, never> {
  return Effect.gen(function* () {
    const insufficient = status === "insufficient_scope";
    const rejected = status === "invalid" && tokenPresented;
    const error = insufficient ? "insufficient_scope" : rejected ? "invalid_token" : undefined;
    const metadata = new URL(`/.well-known/oauth-protected-resource${resource.pathname}`, resource)
      .href;
    const challenge = EffectArray.join(
      [
        `Bearer resource_metadata="${metadata}"`,
        ...(error === undefined ? [] : [`error="${error}"`]),
        `scope="${scope}"`,
      ],
      ", ",
    );
    yield* Effect.annotateCurrentSpan({
      "app.outcome": "rejected",
      "auth.state": status,
      "http.response.status_code": insufficient ? 403 : 401,
    });
    return Response.json(
      insufficient
        ? {
            error: "insufficient_scope",
            scope,
            error_description: `This access token does not grant the ${scope} scope. Authorize again and request ${scope} in addition to the scopes this client already holds.`,
          }
        : rejected
          ? {
              error: "invalid_token",
              error_code: reason === "expired" ? "token_expired" : "token_invalid",
              scope,
              resource_metadata: metadata,
              error_description: `The access token is expired or invalid. Refresh it with the grant's refresh token and retry; authorize again only when the client holds no refresh token.`,
            }
          : {
              error: "unauthorized",
              scope,
              resource_metadata: metadata,
              error_description: `Authorize against the resource metadata, then send the access token as a bearer token. A first authorization can request ${scope}; each tool names the scope it needs in a 403 when the current grant lacks it.`,
            },
      {
        status: insufficient ? 403 : 401,
        headers: { "WWW-Authenticate": challenge, "Cache-Control": "no-store" },
      },
    );
  });
}

function accessTokenReport(
  resolution: AccessTokenResolution,
): Effect.Effect<AccessTokenReport, never, never> {
  if (resolution.status !== "authenticated") {
    return Effect.succeed({ status: "rejected" });
  }
  return DateTime.now.pipe(
    Effect.map((now) => ({
      status: "active" as const,
      expiresAt: DateTime.toDateUtc(resolution.accessTokenExpiresAt).toISOString(),
      expiresInSeconds: Math.max(
        0,
        Math.floor(
          (resolution.accessTokenExpiresAt.epochMilliseconds - now.epochMilliseconds) / 1000,
        ),
      ),
    })),
  );
}

function quotaRefusal(
  invocation: Invocation,
  identity: AuthenticatedAgent,
): Effect.Effect<Response | undefined, ToolCallQuotaUnavailable, ToolCallQuota> {
  return Effect.gen(function* () {
    const call = invocation.call;
    if (Option.isNone(call)) {
      return undefined;
    }
    const tool = call.value.params.name;
    const quota = yield* ToolCallQuota;
    const decision = yield* quota.consume({
      userId: identity.userId,
      clientId: identity.clientId,
      callClass: toolCallClass(invocation.tool),
    });
    if (decision.allowed) {
      yield* Effect.annotateCurrentSpan({ "mcp.tool.name": tool });
      return undefined;
    }
    yield* Effect.annotateCurrentSpan({
      "app.outcome": "rejected",
      "http.response.status_code": 429,
      "mcp.tool.name": tool,
      "mcp.outcome": "tool_call_quota_exhausted",
    });
    return quotaRefusalResponse(call.value.id ?? null, decision);
  });
}

function quotaRefusalResponse(
  id: string | number | null,
  decision: Extract<ToolCallDecision, { readonly allowed: false }>,
): Response {
  const retryAfterSeconds = Math.max(1, Math.ceil(Duration.toSeconds(decision.retryAfter)));
  const allowance =
    decision.bucket === "owner" ? decision.limit.ownerMax : decision.limit.clientMax;
  const windowSeconds = Math.ceil(Duration.toSeconds(decision.limit.window));
  const scope = decision.bucket === "owner" ? "account" : "client";
  const sideEffect =
    decision.bucket === "owner"
      ? "Every client of this account shares that allowance."
      : "Another client of the same account has its own allowance.";
  return Response.json(
    {
      jsonrpc: "2.0",
      id,
      error: {
        code: rateLimitedCode,
        message: `The ${decision.callClass} tool-call allowance for this ${scope} is spent: ${allowance} calls per ${windowSeconds} seconds. ${sideEffect} Retry in ${retryAfterSeconds} seconds; a refused call also counts, so wait rather than retrying immediately.`,
        data: {
          reason: "tool_call_quota_exhausted",
          class: decision.callClass,
          bucket: decision.bucket,
          limit: allowance,
          windowSeconds,
          retryAfterSeconds,
        },
      },
    },
    {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds), "Cache-Control": "no-store" },
    },
  );
}

function invalidArgumentsResponse(invocation: Invocation): Response | undefined {
  if (invocation.tool === undefined || Option.isNone(invocation.call)) {
    return undefined;
  }
  const validated = Schema.decodeResult(Schema.toEncoded(invocation.tool.parametersSchema))(
    invocation.call.value.params.arguments ?? {},
  );
  if (Result.isSuccess(validated)) {
    return undefined;
  }
  const detail = invalidArgumentsDetail(validated.failure.message);
  return Response.json(
    {
      jsonrpc: "2.0",
      id: invocation.call.value.id ?? null,
      error: {
        code: -32602,
        message: `Invalid tool arguments: ${detail.message}`,
        data: { field: detail.field },
      },
    },
    { status: 400 },
  );
}

function invalidArgumentsDetail(message: string): {
  readonly message: string;
  readonly field: string | undefined;
} {
  const [reason = message, location] = EffectString.split(message, "\n  at ");
  const field = optionalStringValue(location, (value) => EffectString.trim(value));
  return {
    message: field === undefined ? reason : `${reason} at ${field}`,
    field,
  };
}

const serveToolkit = Effect.fnUntraced(function* <Tools extends Record<string, Tool.Any>, R>(
  request: Request,
  toolkit: Toolkit.Toolkit<Tools>,
  handlers: Layer.Layer<Tool.HandlersFor<Tools>, never, R>,
  resource: URL,
  application: ApplicationIdentity,
) {
  const path = yield* Schema.decodeUnknownEffect(Schema.TemplateLiteral(["/", Schema.String]))(
    resource.pathname,
  );
  const server = McpServer.layerHttp({
    ...application,
    path,
    protocols: [McpProtocol.v2026_07_28],
  });
  const app = McpServer.toolkit(toolkit).pipe(Layer.provide(handlers), Layer.provideMerge(server));
  const http = yield* HttpRouter.toHttpEffect(app);
  const response = yield* http.pipe(
    Effect.provideService(HttpServerRequest.HttpServerRequest, HttpServerRequest.fromWeb(request)),
  );
  yield* Effect.annotateCurrentSpan({
    "http.response.status_code": response.status,
    ...(response.status >= 400 ? { "app.outcome": "rejected" } : {}),
  });
  return yield* dropDuplicateToolText(HttpServerResponse.toWeb(response));
});

function dropDuplicateToolText(response: Response): Effect.Effect<Response, never, never> {
  return Effect.gen(function* () {
    if (!EffectString.includes(response.headers.get("content-type") ?? "", "application/json")) {
      return response;
    }
    const decoded = yield* Effect.tryPromise({
      try: () => response.clone().text(),
      catch: () => undefined,
    }).pipe(
      Effect.flatMap((text) => Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text)),
      Effect.option,
    );
    if (Option.isNone(decoded) || !clearStructuredCopy(decoded.value)) {
      return response;
    }
    const encoded = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(
      decoded.value,
    ).pipe(Effect.option);
    if (Option.isNone(encoded)) {
      return response;
    }
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    return new Response(encoded.value, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  });
}

function clearStructuredCopy(body: unknown): boolean {
  if (typeof body !== "object" || body === null) {
    return false;
  }
  const result = (body as { readonly result?: unknown }).result;
  if (typeof result !== "object" || result === null) {
    return false;
  }
  const entry = result as { structuredContent?: unknown; content?: unknown };
  if (entry.structuredContent === undefined || !EffectArray.isArray(entry.content)) {
    return false;
  }
  entry.content = [];
  return true;
}

const discoveryMethod = "server/discover";
const supportedProtocolVersion = "2026-07-28";
const unsupportedProtocolVersionCode = -32_022;
const rateLimitedCode = -32_001;

const RpcRequest = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.String, Schema.Finite, Schema.Null])),
  method: Schema.String,
  params: Schema.optional(Schema.Unknown),
});
type RpcRequest = typeof RpcRequest.Type;

const RequestMetadata = Schema.Struct({
  _meta: Schema.optional(
    Schema.Struct({
      "io.modelcontextprotocol/protocolVersion": Schema.optional(Schema.String),
    }),
  ),
});

const ToolCall = Schema.Struct({
  id: Schema.optional(Schema.Union([Schema.String, Schema.Finite, Schema.Null])),
  method: Schema.Literal("tools/call"),
  params: Schema.Struct({ name: Schema.String, arguments: Schema.optional(Schema.Unknown) }),
});

type Invocation = {
  readonly rpc: Option.Option<RpcRequest>;
  readonly call: Option.Option<typeof ToolCall.Type>;
  readonly tool: Tool.Any | undefined;
};

type ApplicationIdentity = { readonly name: string; readonly version: string };

type GrantReport = {
  readonly accessTokenLifetimeSeconds: number;
  readonly refreshTokenGrantSupported: boolean;
  readonly accessToken?: AccessTokenReport;
};

type AccessTokenReport =
  | { readonly status: "active"; readonly expiresAt: string; readonly expiresInSeconds: number }
  | { readonly status: "rejected" };
