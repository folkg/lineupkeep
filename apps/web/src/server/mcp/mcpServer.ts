import type { UserId } from "@sourdough/backend/auth/User";
import { productName } from "@sourdough/brand/product";
import { Layer } from "effect";
import { Toolkit } from "effect/ai";

import { runBackend } from "#server/backendEntry.ts";

import { mcpRequest } from "./mcpEndpoint";
import { noteToolHandlers, noteTools } from "./noteTools";

export const applicationTools = Toolkit.merge(noteTools);
const applicationHandlers = (userId: UserId): ReturnType<typeof noteToolHandlers> =>
  Layer.mergeAll(noteToolHandlers(userId));

export function handleMcpRequest(
  request: Request,
  run: (
    request: Request,
    operation: "mcp.request",
    program: ReturnType<typeof applicationRequest>,
  ) => Promise<Response> = runBackend,
): Promise<Response> {
  return run(request, "mcp.request", applicationRequest(request)).catch(() =>
    Response.json(
      { jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal error" } },
      { status: 500 },
    ),
  );
}

function applicationRequest(
  request: Request,
): ReturnType<
  typeof mcpRequest<
    Toolkit.Tools<typeof applicationTools>,
    Layer.Services<ReturnType<typeof applicationHandlers>>
  >
> {
  return mcpRequest(request, applicationTools, applicationHandlers, {
    name: productName,
    version: "1.0.0",
  });
}
