import { Context } from "effect";

export class AuthorizationScopes extends Context.Service<
  AuthorizationScopes,
  ReadonlyArray<AuthorizationScope>
>()("@sourdough/backend/contexts/auth/AuthorizationScopes") {}

export const offlineAccess = {
  name: "offline_access",
  description:
    "Stay connected with renewable access until this authorization expires or is revoked.",
} as const;

export type AuthorizationScope = {
  readonly name: string;
  readonly description: string;
};
