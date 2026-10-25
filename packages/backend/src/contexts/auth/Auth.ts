import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { AuthorizationScope } from "./AuthorizationScopes.ts";
import type { UserId } from "./User.ts";

export class AuthService extends Context.Service<AuthService, AuthServiceShape>()(
  "@lineupkeep/backend/contexts/auth/Auth/AuthService",
) {}

export class AuthenticationUnavailable extends Schema.TaggedError<
  AuthenticationUnavailable,
  { readonly brand: unique symbol }
>()("AuthenticationUnavailable", {
  cause: Schema.Defect(),
}) {}

export class AuthenticationInvalidResponse extends Schema.TaggedError<
  AuthenticationInvalidResponse,
  { readonly brand: unique symbol }
>()("AuthenticationInvalidResponse", {
  cause: Schema.Defect(),
}) {}

type AuthenticationError = AuthenticationUnavailable | AuthenticationInvalidResponse;

export type AccessTokenResolution =
  | { readonly status: "invalid" }
  | { readonly status: "insufficient_scope" }
  | { readonly status: "authenticated"; readonly userId: UserId };

export type AuthenticationSession = {
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly name: string;
  };
};

export type ConsentRequest =
  | { readonly status: "invalid" }
  | {
      readonly status: "valid";
      readonly client: {
        readonly id: string;
        readonly name: string | null;
        readonly host: string;
      };
      readonly scopes: ReadonlyArray<AuthorizationScope>;
    };

export type SignInMethods = {
  readonly google: boolean;
};

export type AuthServiceShape = {
  readonly signInMethods: SignInMethods;

  readonly oauthResource: string;

  readonly resolveAccessToken: (
    token: string,
    requiredScopes: ReadonlyArray<string>,
  ) => Effect.Effect<AccessTokenResolution, AuthenticationError>;

  readonly getConsentRequest: (
    headers: Headers,
    query: string,
  ) => Effect.Effect<ConsentRequest, AuthenticationError>;

  readonly consent: (
    headers: Headers,
    query: string,
    accept: boolean,
  ) => Effect.Effect<string, AuthenticationUnavailable>;

  readonly handle: (request: Request) => Effect.Effect<Response, AuthenticationUnavailable>;

  readonly getSession: (
    headers: Headers,
  ) => Effect.Effect<AuthenticationSession | undefined, AuthenticationError>;
};
