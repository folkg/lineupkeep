import { authClient, requireAuthSuccess } from "#browser/session/authClient.ts";
import type { AccountErasureSummaryView } from "#contracts/account/accountContract.ts";
import { eraseAccountServerFn } from "#server-functions/account/accountServerFunctions.ts";

import { requireAccountErasureSuccess } from "./accountFailure";

export const accountRemote: AccountDataRemote = {
  erase: (confirmation) =>
    eraseAccountServerFn({ data: { confirmation } }).then(requireAccountErasureSuccess),
  signOut: () => authClient.signOut().then(requireAuthSuccess),
};

export type AccountDataRemote = {
  readonly erase: (confirmation: string) => Promise<AccountErasureSummaryView>;
  readonly signOut: () => Promise<void>;
};
