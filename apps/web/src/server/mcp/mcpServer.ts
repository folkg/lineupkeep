import type { AuthService } from "@lineupkeep/backend/auth/Auth";
import type { UserId } from "@lineupkeep/backend/auth/User";
import type { Connections } from "@lineupkeep/backend/connections/Connections";
import type { FantasyQueries } from "@lineupkeep/backend/connections/FantasyQueries";
import type { LineupRuns } from "@lineupkeep/backend/connections/LineupRuns";
import type { Teams } from "@lineupkeep/backend/connections/Teams";
import type { TransactionProposals } from "@lineupkeep/backend/connections/TransactionProposals";
import type { TransactionReviews } from "@lineupkeep/backend/connections/TransactionReview";
import type { Feedback } from "@lineupkeep/backend/feedback/Feedback";
import { productName } from "@lineupkeep/brand/product";
import { Layer } from "effect";
import type { Tool } from "effect/ai";
import { Toolkit } from "effect/ai";

import { runBackend } from "#server/backendEntry.ts";

import { connectionToolHandlers, connectionTools } from "./connectionTools";
import { fantasyQueryToolHandlers, fantasyQueryTools } from "./fantasyQueryTools";
import { feedbackToolHandlers, feedbackTools } from "./feedbackTools";
import { lineupToolHandlers, lineupTools } from "./lineupTools";
import { mcpRequest } from "./mcpEndpoint";
import { proposalToolHandlers, proposalTools } from "./proposalTools";
import { teamToolHandlers, teamTools } from "./teamTools";
import { transactionToolHandlers, transactionTools } from "./transactionTools";

export const applicationTools = Toolkit.merge(
  connectionTools,
  fantasyQueryTools,
  transactionTools,
  proposalTools,
  lineupTools,
  teamTools,
  feedbackTools,
);
const applicationHandlers = (
  userId: UserId,
): Layer.Layer<
  Tool.HandlersFor<Toolkit.Tools<typeof applicationTools>>,
  never,
  | Connections
  | FantasyQueries
  | TransactionReviews
  | TransactionProposals
  | LineupRuns
  | Teams
  | Feedback
  | AuthService
> =>
  Layer.mergeAll(
    connectionToolHandlers(userId),
    fantasyQueryToolHandlers(userId),
    transactionToolHandlers(userId),
    proposalToolHandlers(userId),
    lineupToolHandlers(userId),
    teamToolHandlers(userId),
    feedbackToolHandlers(userId),
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
