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

export const linkingHelperClient = {
  clientId: "lineupkeep-linking-helper",
  name: "Lineupkeep local helper",
} as const;

export const linkingHelperScope = {
  name: "connections:link",
  description:
    "Send one provider session from the local helper you approved to finish linking a connection.",
} as const;

export type AuthorizationScope = {
  readonly name: string;
  readonly description: string;
};
