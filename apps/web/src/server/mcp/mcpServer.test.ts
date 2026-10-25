import { AuthService } from "@lineupkeep/backend/auth/Auth";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import {
  NoteLifecycleConflict,
  NoteLifecycleRejected,
  NoteNotFound,
  NotePersistenceFailed,
  decodeNoteId,
} from "@lineupkeep/backend/notes/Note";
import type { NotesShape } from "@lineupkeep/backend/notes/Notes";
import { Notes } from "@lineupkeep/backend/notes/Notes";
import { Effect, Layer, Schema } from "effect";
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
          oauthResource: "https://notes.example/agents",
        })),
        Effect.provide(authentication),
      ),
    );
  const input = request("tools/list", {}, "read");
  const invocation = new Request("https://notes.example/agents", {
    method: "POST",
    headers: input.headers,
    body: await input.text(),
  });

  const challenged = await run(new Request("https://notes.example/agents", { method: "POST" }));
  const served = await run(invocation);

  expect(challenged.status).toBe(401);
  expect(challenged.headers.get("www-authenticate")).toContain(
    "/.well-known/oauth-protected-resource/agents",
  );
  expect(served.status).toBe(200);
  expect(await served.json()).toMatchObject({ result: { tools: [] } });
});

it("serves composed feature toolkits without requiring Notes services", async () => {
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

it("challenges an unauthenticated client with protected-resource discovery", async () => {
  const response = await handle(request("tools/list"));

  expect(response.status).toBe(401);
  expect(response.headers.get("www-authenticate")).toBe(
    'Bearer resource_metadata="https://notes.example/.well-known/oauth-protected-resource/mcp"',
  );
});

it.each(["create_note", "update_note", "trash_note", "restore_note"])(
  "offers scope step-up before running %s with a read token",
  async (name) => {
    const response = await handle(request("tools/call", { name, arguments: {} }, "read"));

    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain(
      'error="insufficient_scope", scope="notes:write"',
    );
  },
);

it("checks write scope for a notification-shaped tool invocation", async () => {
  const invocation = new Request("https://notes.example/mcp", {
    method: "POST",
    headers: request("tools/call", { name: "create_note" }, "read").headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "tools/call",
      params: { name: "create_note", arguments: {} },
    }),
  });

  const response = await handle(invocation);

  expect(response.status).toBe(403);
});

it.each(["2025-03-26", "2025-06-18", "2025-11-25"])(
  "rejects legacy protocol %s without creating a session",
  async (version) => {
    const response = await handle(request("tools/list", {}, "write", version));

    expect(response.status).toBe(400);
    expect(response.headers.has("mcp-session-id")).toBe(false);
  },
);

it("lists only the five annotated Notes tools with derived field constraints", async () => {
  const response = await handle(request("tools/list", {}, "read"));
  const body = await json(response);

  expect(response.status).toBe(200);
  expect(JSON.stringify(body)).toContain('"maxLength":200');
  expect(JSON.stringify(body)).toContain('"maxLength":10000');
  expect(JSON.stringify(body)).toContain('"readOnlyHint":true');
  expect(JSON.stringify(body)).toContain('"requestId"');
  expect(JSON.stringify(body)).toContain('"maximum":1000');
  expect(JSON.stringify(body)).not.toContain("delete_permanently");
  const decoded = Schema.decodeUnknownSync(
    Schema.Struct({
      result: Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) }),
    }),
  )(body);
  expect(decoded.result.tools.map((tool) => tool.name)).toEqual([
    "list_notes",
    "create_note",
    "update_note",
    "trash_note",
    "restore_note",
  ]);
});

it.each([
  { title: "Title", body: "Body" },
  { requestId: "cf8fbeec-0da5-4239-a029-cd59b63b7e69", title: " ", body: "Body" },
  { requestId: "cf8fbeec-0da5-4239-a029-cd59b63b7e69", title: "T".repeat(201), body: "Body" },
  { requestId: "cf8fbeec-0da5-4239-a029-cd59b63b7e69", title: "Title", body: " \n " },
  { requestId: "not-a-uuid", title: "Title", body: "Body" },
])("rejects invalid tool arguments as JSON-RPC invalid-params: %j", async (arguments_) => {
  const response = await handle(
    request("tools/call", { name: "create_note", arguments: arguments_ }, "write"),
  );

  expect(await json(response)).toMatchObject({ id: 1, error: { code: -32602 } });
  expect(response.status).toBe(400);
});

it.each([0, 1001, 1.5])("rejects an invalid Notes page limit of %s", async (limit) => {
  const response = await handle(
    request("tools/call", { name: "list_notes", arguments: { limit } }, "read"),
  );

  expect(response.status).toBe(400);
  expect(await json(response)).toMatchObject({ id: 1, error: { code: -32602 } });
});

it("returns an actionable tool error for a Note not owned by the User", async () => {
  const response = await handle(
    request("tools/call", { name: "restore_note", arguments: { id: noteId } }, "write"),
  );

  expect(response.status).toBe(200);
  const body = await json(response);
  expect(body).toMatchObject({ result: { isError: true } });
  expect(JSON.stringify(body)).toContain("Note not found");
});

it("returns a stateless tool result without initializing a session", async () => {
  const response = await handle(
    request("tools/call", { name: "list_notes", arguments: {} }, "read"),
  );

  expect(response.status).toBe(200);
  expect(await json(response)).toMatchObject({
    result: { structuredContent: { notes: [] }, isError: false },
  });
  expect(response.headers.has("mcp-session-id")).toBe(false);
});

it.each([
  [
    "restore_note",
    () => NoteLifecycleConflict.make({ id: noteId, expected: "trashed" }),
    "current state",
  ],
  [
    "restore_note",
    () =>
      NoteLifecycleRejected.make({ id: noteId, lifecycle: "active", event: "RestoreRequested" }),
    "current state",
  ],
] as const)("returns an actionable %s rejection for %s", async (name, failure, message) => {
  const fail = (): Effect.Effect<never, NoteLifecycleConflict | NoteLifecycleRejected, never> =>
    Effect.fail(failure());
  const arguments_ = { id: noteId };

  const response = await handle(request("tools/call", { name, arguments: arguments_ }, "write"), {
    ...unavailableNotes,
    create: fail,
    restore: fail,
  });

  expect(response.status).toBe(200);
  const body = await json(response);
  expect(body).toMatchObject({ result: { isError: true } });
  expect(JSON.stringify(body)).toContain(message);
});

it("scrubs unexpected persistence details from the tool response", async () => {
  const response = await handle(
    request("tools/call", { name: "restore_note", arguments: { id: noteId } }, "write"),
    {
      ...unavailableNotes,
      restore: () =>
        Effect.fail(
          NotePersistenceFailed.make({
            cause: new Error("private database password and Note content"),
          }),
        ),
    },
  );

  const body = await json(response);

  expect(body).toMatchObject({ result: { isError: true } });
  expect(JSON.stringify(body)).toContain("internal server error");
  expect(JSON.stringify(body)).not.toContain("private database");
});

const noteId = decodeNoteId("af2927f1-6aaa-493a-a3d8-0fc07b76fa88");
const notFound = (): Effect.Effect<never, NoteNotFound, never> =>
  Effect.fail(NoteNotFound.make({ id: noteId }));
const authentication = Layer.succeed(AuthService)({
  signInMethods: { google: false },
  oauthResource: "https://notes.example/mcp",
  getSession: () => Effect.void.pipe(Effect.as(undefined)),
  handle: () => Effect.succeed(new Response()),
  getConsentRequest: () => Effect.succeed({ status: "invalid" as const }),
  consent: () => Effect.succeed("https://client.test/callback"),
  resolveAccessToken: (token, scopes) =>
    Effect.succeed(
      token === "read" && scopes.some((scope) => scope.endsWith(":write"))
        ? { status: "insufficient_scope" as const }
        : { status: "authenticated" as const, userId: decodeUserId("reader") },
    ),
});
const unavailableNotes: NotesShape = {
  list: () => Effect.succeed({ items: [] }),
  create: notFound,
  update: notFound,
  moveToTrash: notFound,
  restore: notFound,
  deletePermanently: notFound,
};

function handle(request: Request, notes: NotesShape = unavailableNotes): Promise<Response> {
  const services = Layer.merge(authentication, Layer.succeed(Notes)(notes));
  return handleMcpRequest(request, (_request, _operation, program) =>
    Effect.runPromise(Effect.provide(program, services)),
  );
}

function request(
  method: string,
  params: Record<string, unknown> = {},
  token?: string,
  version = "2026-07-28",
): Request {
  return new Request("https://notes.example/mcp", {
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
