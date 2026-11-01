import type { AuthorizationScope } from "#contexts/auth/AuthorizationScopes.ts";
import { offlineAccess } from "#contexts/auth/AuthorizationScopes.ts";
import { lineupScopes } from "#contexts/connections/LineupScopes.ts";
import { fantasyQueryScopes } from "#contexts/connections/QueryScopes.ts";
import { teamScopes } from "#contexts/connections/TeamScopes.ts";

export const resourceScopes: ReadonlyArray<AuthorizationScope> = [
  fantasyQueryScopes.read,
  fantasyQueryScopes.reviewTransactions,
  lineupScopes.write,
  teamScopes.manage,
];

export const advertisedScopes: ReadonlyArray<AuthorizationScope> = [
  ...resourceScopes,
  offlineAccess,
];

export const onboardingScopes: ReadonlyArray<AuthorizationScope> = [
  fantasyQueryScopes.read,
  offlineAccess,
];
