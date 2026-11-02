import { authClient, requireAuthSuccess } from "#browser/session/authClient.ts";
import type {
  AccountErasureSummaryView,
  AccountExportStatusView,
} from "#contracts/account/accountContract.ts";
import {
  eraseAccountServerFn,
  getAccountExportStatusServerFn,
} from "#server-functions/account/accountServerFunctions.ts";

import { requireAccountErasureSuccess, requireAccountExportStatusSuccess } from "./accountFailure";

export const accountRemote: AccountDataRemote = {
  status: (options) =>
    getAccountExportStatusServerFn({ signal: options.signal }).then(
      requireAccountExportStatusSuccess,
    ),
  erase: (confirmation) =>
    eraseAccountServerFn({ data: { confirmation } }).then(requireAccountErasureSuccess),
  signOut: () => authClient.signOut().then(requireAuthSuccess),
};

export type AccountDataRemote = {
  readonly status: (options: AccountExportStatusRequestOptions) => Promise<AccountExportStatusView>;
  readonly erase: (confirmation: string) => Promise<AccountErasureSummaryView>;
  readonly signOut: () => Promise<void>;
};

type AccountExportStatusRequestOptions = {
  readonly signal: AbortSignal;
};
