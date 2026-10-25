import type { AuthorizationScope } from "#contexts/auth/AuthorizationScopes.ts";
import { offlineAccess } from "#contexts/auth/AuthorizationScopes.ts";
import { connectionScopes } from "#contexts/connections/ConnectionScopes.ts";
import { lineupScopes } from "#contexts/connections/LineupScopes.ts";
import { fantasyQueryScopes } from "#contexts/connections/QueryScopes.ts";
import { teamScopes } from "#contexts/connections/TeamScopes.ts";
import { feedbackScopes } from "#contexts/feedback/FeedbackScopes.ts";

export const resourceScopes: ReadonlyArray<AuthorizationScope> = [
  connectionScopes.read,
  fantasyQueryScopes.read,
  fantasyQueryScopes.reviewTransactions,
  lineupScopes.write,
  teamScopes.manage,
  feedbackScopes.manage,
];

export const advertisedScopes: ReadonlyArray<AuthorizationScope> = [
  ...resourceScopes,
  offlineAccess,
];
