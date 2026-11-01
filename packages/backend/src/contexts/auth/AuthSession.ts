import { Effect, Schema } from "effect";

import { RequestContext } from "#runtime/RequestContext.ts";

import { AuthenticationInvalidResponse, AuthService } from "./Auth.ts";
import { SignInSessionId } from "./SignInSessions.ts";
import { UserId } from "./User.ts";

export const getCurrentAuthSession = Effect.fn("getCurrentAuthSession")(function* () {
  const auth = yield* AuthService;
  const requestContext = yield* RequestContext;
  const session = yield* auth.getSession(requestContext.request.headers);

  if (session === undefined) {
    const anonymous: AuthSessionValue = { status: "anonymous" };
    return anonymous;
  }

  const userId = yield* Schema.decodeEffect(UserId)(session.user.id).pipe(
    Effect.mapError((cause) => AuthenticationInvalidResponse.make({ cause })),
  );
  const sessionId = yield* Schema.decodeEffect(SignInSessionId)(session.session.id).pipe(
    Effect.mapError((cause) => AuthenticationInvalidResponse.make({ cause })),
  );
  const authenticated: AuthSessionValue = {
    status: "authenticated",
    sessionId,
    user: {
      id: userId,
      email: session.user.email,
      name: session.user.name,
    },
  };
  return authenticated;
});

export type AuthSessionValue =
  | { readonly status: "anonymous" }
  | {
      readonly status: "authenticated";
      readonly sessionId: SignInSessionId;
      readonly user: AuthSessionUser;
    };

export type AuthSessionUser = {
  readonly id: UserId;
  readonly email: string;
  readonly name: string;
};
