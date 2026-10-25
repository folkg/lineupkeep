import { AuthService, type SignInMethods } from "@lineupkeep/backend/auth/Auth";
import { getCurrentAuthSession, type AuthSessionValue } from "@lineupkeep/backend/auth/AuthSession";
import { Effect, Schema } from "effect";

import { mapAuthenticationFailure, runBackend } from "#server/backendEntry.ts";
export function handleAuthRequest(request: Request): Promise<Response> {
  const program = Effect.flatMap(AuthService, (auth) => auth.handle(request)).pipe(
    Effect.tap((response) =>
      Effect.annotateCurrentSpan({
        "app.outcome":
          response.status >= 500 ? "failure" : response.status >= 400 ? "rejected" : "success",
        "http.response.status_code": response.status,
      }),
    ),
    Effect.tapError(annotateAuthenticationFailure),
  );

  return runBackend(request, "auth.handle", program).catch(mapAuthenticationFailure);
}

export function getSignInMethods(request: Request): Promise<SignInMethods> {
  const program = Effect.map(AuthService, (auth) => auth.signInMethods).pipe(
    Effect.tap((methods) =>
      Effect.annotateCurrentSpan({
        "auth.google_enabled": methods.google,
        "http.response.status_code": 200,
      }),
    ),
  );

  return runBackend(request, "auth.sign_in_methods", program);
}

export function getAuthSession(request: Request): Promise<AuthSessionValue> {
  const program = getCurrentAuthSession().pipe(
    Effect.tap((session) =>
      Effect.annotateCurrentSpan({
        "auth.state": session.status,
        "http.response.status_code": 200,
        ...(session.status === "authenticated" ? { "user.id": session.user.id } : {}),
      }),
    ),
    Effect.tapError(annotateAuthenticationFailure),
  );

  return runBackend(request, "auth.session", program).catch(mapAuthenticationFailure);
}

function annotateAuthenticationFailure(error: { readonly _tag: string }): Effect.Effect<void> {
  return Effect.annotateCurrentSpan({
    "app.outcome": "failure",
    "error.type": error._tag,
    "http.response.status_code": 503,
  });
}

const ConsentQuery = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1), Schema.isMaxLength(16_384)),
);

export const ConsentRequestInput = Schema.Struct({ query: ConsentQuery });

export const ConsentDecisionInput = Schema.Struct({ query: ConsentQuery, accept: Schema.Boolean });
