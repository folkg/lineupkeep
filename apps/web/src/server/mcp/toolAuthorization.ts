import type { AuthorizationScope } from "@lineupkeep/backend/auth/AuthorizationScopes";
import { Context } from "effect";

export class RequiredScope extends Context.Service<RequiredScope, AuthorizationScope>()(
  "@lineupkeep/web/server/mcp/toolAuthorization/RequiredScope",
) {}
