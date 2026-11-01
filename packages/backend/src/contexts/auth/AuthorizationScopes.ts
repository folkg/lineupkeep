import { Context } from "effect";

export class AuthorizationScopes extends Context.Service<
  AuthorizationScopes,
  ReadonlyArray<AuthorizationScope>
>()("@lineupkeep/backend/contexts/auth/AuthorizationScopes") {}

export const offlineAccess = {
  name: "offline_access",
  description:
    "Stay connected with renewable access until this authorization expires or is revoked.",
} as const;

export const retiredScopeAliases: Readonly<Record<string, string>> = {
  "connections:read": "fantasy:read",
};

export const retiredScopeNames: ReadonlyArray<string> = Object.keys(retiredScopeAliases);

export function currentScopeName(name: string): string {
  return retiredScopeAliases[name] ?? name;
}

export type AuthorizationScope = {
  readonly name: string;
  readonly description: string;
};
