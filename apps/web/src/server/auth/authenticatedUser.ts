import { getCurrentAuthSession } from "@lineupkeep/backend/auth/AuthSession";
import type { SignInSessionId } from "@lineupkeep/backend/auth/SignInSessions";
import type { UserId } from "@lineupkeep/backend/auth/User";
import { Effect } from "effect";

import type { AuthenticationFailureResult } from "#contracts/auth/authContract.ts";

export function withAuthenticatedUser<A, E, R>(
  useCase: (userId: UserId, sessionId: SignInSessionId) => Effect.Effect<A, E, R>,
): Effect.Effect<
  A | AuthenticationFailureResult,
  | E
  | (
      | import("@lineupkeep/backend/auth/Auth").AuthenticationInvalidResponse
      | import("@lineupkeep/backend/auth/Auth").AuthenticationUnavailable
    ),
  | R
  | import("@lineupkeep/backend/auth/Auth").AuthService
  | import("@lineupkeep/backend/runtime/RequestContext").RequestContext
> {
  return Effect.flatMap(
    getCurrentAuthSession(),
    (session): Effect.Effect<A | AuthenticationFailureResult, E, R> => {
      if (session.status === "anonymous") {
        const failure: AuthenticationFailureResult = {
          type: "error",
          error: { type: "auth.required" },
        };
        return Effect.annotateCurrentSpan({
          "app.outcome": "rejected",
          "auth.state": session.status,
          "error.type": failure.error.type,
          "http.response.status_code": 200,
        }).pipe(Effect.as(failure));
      }
      return Effect.annotateCurrentSpan({
        "auth.state": "authenticated",
        "user.id": session.user.id,
      }).pipe(Effect.andThen(useCase(session.user.id, session.sessionId)));
    },
  );
}
