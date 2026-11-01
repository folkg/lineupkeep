import type { SignInSessionListData } from "#contracts/auth/authContract.ts";
import {
  endOtherSignInSessionsServerFn,
  endSignInSessionServerFn,
  listSignInSessionsServerFn,
} from "#server-functions/auth/signInSessionServerFunctions.ts";

import { requireSignInSessionSuccess } from "./signInSessionsFailure";

export const signInSessionsRemote: SignInSessionsRemote = {
  list: (options) =>
    listSignInSessionsServerFn({ signal: options.signal }).then(requireSignInSessionSuccess),
  end: (session) =>
    endSignInSessionServerFn({ data: { session } }).then(requireSignInSessionSuccess),
  endOthers: () => endOtherSignInSessionsServerFn().then(requireSignInSessionSuccess),
};

export type SignInSessionsRemote = {
  readonly list: (options: SignInSessionListRequestOptions) => Promise<SignInSessionListData>;
  readonly end: (session: string) => Promise<SignInSessionListData>;
  readonly endOthers: () => Promise<SignInSessionListData>;
};

type SignInSessionListRequestOptions = {
  readonly signal: AbortSignal;
};
