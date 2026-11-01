import {
  AuthenticationInvalidResponse,
  AuthenticationUnavailable,
} from "@lineupkeep/backend/auth/Auth";
import type { SignInSessionId } from "@lineupkeep/backend/auth/SignInSessions";
import type { UserId } from "@lineupkeep/backend/auth/User";
import type { BackendOperation, BackendServices } from "@lineupkeep/backend/runtime/BackendRuntime";
import type { RequestContext } from "@lineupkeep/backend/runtime/RequestContext";
import { Effect, Schema } from "effect";

import { deploymentTarget } from "#deployment-target";

import { withAuthenticatedUser } from "./auth/authenticatedUser.ts";
export function runUseCase<A, E, R extends BackendServices, Code extends string>(
  request: Request,
  operation: BackendOperation,
  useCase: (userId: UserId, sessionId: SignInSessionId) => Effect.Effect<A, E, R | RequestContext>,
  mapExpectedError: (error: E) => ExpectedFailure<Code>,
): Promise<
  | import("#contracts/auth/authContract.ts").AuthenticationFailureResult
  | {
      type: "error";
      error: {
        type: Code;
      };
    }
  | {
      type: "success";
      data: A;
    }
> {
  const program = authenticatedUseCase(useCase, mapExpectedError).pipe(
    Effect.tapError((error) =>
      Effect.annotateCurrentSpan({
        "app.outcome": "failure",
        "error.type": error._tag,
        "http.response.status_code": 503,
      }),
    ),
  );
  return runBackend(request, operation, program).catch(mapAuthenticationFailure);
}

export function runBackend<A, E, R extends BackendServices | RequestContext>(
  request: Request,
  operation: BackendOperation,
  program: Effect.Effect<A, E, R>,
): Promise<A> {
  return deploymentTarget.backend.run(program, request, operation);
}

export function mapAuthenticationFailure(error: unknown): never {
  if (
    Schema.is(AuthenticationUnavailable)(error) ||
    Schema.is(AuthenticationInvalidResponse)(error)
  ) {
    throw new Response("Authentication unavailable", { status: 503 });
  }

  throw error;
}

export function authenticatedUseCase<A, E, R, Code extends string>(
  useCase: (userId: UserId, sessionId: SignInSessionId) => Effect.Effect<A, E, R>,
  mapExpectedError: (error: E) => ExpectedFailure<Code>,
): Effect.Effect<
  | import("#contracts/auth/authContract.ts").AuthenticationFailureResult
  | {
      type: "error";
      error: {
        type: Code;
      };
    }
  | {
      type: "success";
      data: A;
    },
  AuthenticationInvalidResponse | AuthenticationUnavailable,
  R | import("@lineupkeep/backend/auth/Auth").AuthService | RequestContext
> {
  return withAuthenticatedUser((userId, sessionId) =>
    Effect.matchEffect(useCase(userId, sessionId), {
      onFailure: (error) => {
        const failure = mapExpectedError(error);
        return Effect.annotateCurrentSpan({
          "app.outcome": failure.outcome,
          "error.type": failure.type,
          "http.response.status_code": 200,
        }).pipe(Effect.as({ type: "error" as const, error: { type: failure.type } }));
      },
      onSuccess: (data) =>
        Effect.annotateCurrentSpan({
          "app.outcome": "success",
          "http.response.status_code": 200,
        }).pipe(Effect.as({ type: "success" as const, data })),
    }),
  );
}

export function correlateResponse(response: Response, requestId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("x-request-id", requestId);

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export type ExpectedFailure<Code extends string> = {
  readonly type: Code;
  readonly outcome: "rejected" | "conflict" | "failure";
};
