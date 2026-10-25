import type { UserId } from "@lineupkeep/backend/auth/User";
import type { Connections } from "@lineupkeep/backend/connections/Connections";
import type { FantasyQueries } from "@lineupkeep/backend/connections/FantasyQueries";
import type { TransactionReviews } from "@lineupkeep/backend/connections/TransactionReview";
import { productName } from "@lineupkeep/brand/product";
import { Layer } from "effect";
import type { Tool } from "effect/ai";
import { Toolkit } from "effect/ai";

import { runBackend } from "#server/backendEntry.ts";

import { connectionToolHandlers, connectionTools } from "./connectionTools";
import { fantasyQueryToolHandlers, fantasyQueryTools } from "./fantasyQueryTools";
import { mcpRequest } from "./mcpEndpoint";
import { transactionToolHandlers, transactionTools } from "./transactionTools";

export const applicationTools = Toolkit.merge(connectionTools, fantasyQueryTools, transactionTools);
const applicationHandlers = (
  userId: UserId,
): Layer.Layer<
  Tool.HandlersFor<Toolkit.Tools<typeof applicationTools>>,
  never,
  Connections | FantasyQueries | TransactionReviews
> =>
  Layer.mergeAll(
    connectionToolHandlers(userId),
    fantasyQueryToolHandlers(userId),
    transactionToolHandlers(userId),
  );

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
