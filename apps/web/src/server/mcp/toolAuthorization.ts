import type { AuthorizationScope } from "@lineupkeep/backend/auth/AuthorizationScopes";
import type { ToolCallClass } from "@lineupkeep/backend/toolCalls/ToolCallQuota";
import { Context } from "effect";
import { Tool } from "effect/ai";

export class RequiredScope extends Context.Service<RequiredScope, AuthorizationScope>()(
  "@lineupkeep/web/server/mcp/toolAuthorization/RequiredScope",
) {}

export function toolCallClass(tool: Tool.Any | undefined): ToolCallClass {
  if (tool === undefined) {
    return "write";
  }
  if (Context.get(tool.annotations, Tool.Destructive)) {
    return "destructive";
  }
  return Context.get(tool.annotations, Tool.Readonly) ? "read" : "write";
}
