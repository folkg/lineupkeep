import { AuthService } from "@lineupkeep/backend/auth/Auth";
import type { AuthorizationScope } from "@lineupkeep/backend/auth/AuthorizationScopes";
import type { UserId } from "@lineupkeep/backend/auth/User";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { McpProtocol, McpServer } from "effect/ai";
import type { Tool, Toolkit } from "effect/ai";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { RequiredScope } from "./toolAuthorization";

export const mcpRequest = Effect.fnUntraced(function* <Tools extends Record<string, Tool.Any>, R>(
  request: Request,
  toolkit: Toolkit.Toolkit<Tools>,
  handlers: (userId: UserId) => Layer.Layer<Tool.HandlersFor<Tools>, never, R>,
  application: ApplicationIdentity,
) {
  const auth = yield* AuthService;
  const resource = new URL(auth.oauthResource);
  const invocation = yield* readInvocation(request, toolkit);

  if (Option.isSome(invocation.rpc) && invocation.rpc.value.method === discoveryMethod) {
    return yield* discoveryResponse(invocation.rpc.value, application);
  }

  const scopes = requiredScopes(invocation.tool);
  const bearer = bearerToken(request.headers);
  const identity =
    bearer === undefined
      ? { status: "invalid" as const }
      : yield* auth.resolveAccessToken(bearer, scopes);
  if (identity.status !== "authenticated") {
    return yield* challengeResponse(resource, identity.status, scopes, auth.advertisedScopes);
  }
  yield* Effect.annotateCurrentSpan({
    "auth.state": "authenticated",
    "user.id": identity.userId,
  });
  const invalid = invalidArgumentsResponse(invocation);
  if (invalid !== undefined) {
    yield* Effect.annotateCurrentSpan({
      "app.outcome": "rejected",
      "http.response.status_code": 400,
    });
    return invalid;
  }
  return yield* serveToolkit(request, toolkit, handlers(identity.userId), resource, application);
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
      ? Object.values(toolkit.tools).find((tool) => tool.name === call.value.params.name)
      : undefined;
    return { rpc, call, tool };
  });
}

function requiredScopes(tool: Tool.Any | undefined): ReadonlyArray<string> {
  return tool === undefined ? [] : [Context.getUnsafe(tool.annotations, RequiredScope).name];
}

function bearerToken(headers: Headers): string | undefined {
  const authorization = headers.get("authorization");
  return authorization === null ? undefined : /^Bearer ([^\s]+)$/iu.exec(authorization)?.[1];
}

function discoveryResponse(
  rpc: RpcRequest,
  application: ApplicationIdentity,
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
        _meta: { "io.modelcontextprotocol/serverInfo": application },
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
  requiredScopes: ReadonlyArray<string>,
  advertisedScopes: ReadonlyArray<AuthorizationScope>,
): Effect.Effect<Response, never, never> {
  return Effect.gen(function* () {
    const insufficient = status === "insufficient_scope";
    const metadata = new URL(`/.well-known/oauth-protected-resource${resource.pathname}`, resource)
      .href;
    const advertised = advertisedScopes.map((scope) => scope.name).join(" ");
    const scope = insufficient ? requiredScopes.join(" ") : advertised;
    const challenge = [
      `Bearer resource_metadata="${metadata}"`,
      ...(insufficient ? ['error="insufficient_scope"'] : []),
      `scope="${scope}"`,
    ].join(", ");
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
            error_description: `This access token does not grant the ${scope} scope. Authorize again and request every advertised scope (${advertised}).`,
          }
        : {
            error: "unauthorized",
            scope,
            resource_metadata: metadata,
            error_description: `Authorize against the resource metadata, request every advertised scope (${advertised}), and send the access token as a bearer token.`,
          },
      {
        status: insufficient ? 403 : 401,
        headers: { "WWW-Authenticate": challenge, "Cache-Control": "no-store" },
      },
    );
  });
}

function invalidArgumentsResponse(invocation: Invocation): Response | undefined {
  if (
    invocation.tool === undefined ||
    Option.isNone(invocation.call) ||
    Schema.is(Schema.toEncoded(invocation.tool.parametersSchema))(
      invocation.call.value.params.arguments ?? {},
    )
  ) {
    return undefined;
  }
  return Response.json(
    {
      jsonrpc: "2.0",
      id: invocation.call.value.id ?? null,
      error: { code: -32602, message: "Invalid tool arguments" },
    },
    { status: 400 },
  );
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
  return HttpServerResponse.toWeb(response);
});

const discoveryMethod = "server/discover";
const supportedProtocolVersion = "2026-07-28";
const unsupportedProtocolVersionCode = -32_022;

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
