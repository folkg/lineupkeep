import type { SessionView } from "#contracts/auth/authContract.ts";
import { getAuthSessionServerFn } from "#server-functions/auth/authServerFunctions.ts";

import { authClient, requireAuthSuccess } from "./authClient";

export const sessionRemote: SessionRemote = {
  load: () => getAuthSessionServerFn(),
  signOut: () => authClient.signOut().then(requireAuthSuccess),
};

export type SessionRemote = {
  readonly load: () => Promise<SessionView>;
  readonly signOut: () => Promise<void>;
};
