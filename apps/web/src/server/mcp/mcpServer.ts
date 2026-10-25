import type { UserId } from "@lineupkeep/backend/auth/User";
import { productName } from "@lineupkeep/brand/product";
import { Layer } from "effect";
import { Toolkit } from "effect/ai";

import { runBackend } from "#server/backendEntry.ts";

import { connectionToolHandlers, connectionTools } from "./connectionTools";
import { mcpRequest } from "./mcpEndpoint";

export const applicationTools = Toolkit.merge(connectionTools);
const applicationHandlers = (userId: UserId): ReturnType<typeof connectionToolHandlers> =>
  connectionToolHandlers(userId);

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
