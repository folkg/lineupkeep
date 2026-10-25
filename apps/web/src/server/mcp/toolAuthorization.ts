import type { AuthorizationScope } from "@sourdough/backend/auth/AuthorizationScopes";
import { Context } from "effect";

export class RequiredScope extends Context.Service<RequiredScope, AuthorizationScope>()(
  "@sourdough/web/server/mcp/toolAuthorization/RequiredScope",
) {}
