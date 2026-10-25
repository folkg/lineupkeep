import type { ConsentRequest } from "@sourdough/backend/auth/Auth";

import {
  decideConsentServerFn,
  consentRequestServerFn,
  currentConsentQuery,
} from "#server-functions/auth/consentServerFunctions.ts";

export const consentRemote: ConsentRemote = {
  currentQuery: () => currentConsentQuery(),
  loadRequest: (query) => consentRequestServerFn({ data: { query } }),
  decide: (input) => decideConsentServerFn({ data: input }),
};

export type ConsentRemote = {
  readonly currentQuery: () => string;
  readonly loadRequest: (query: string) => Promise<ConsentRequest>;
  readonly decide: (input: { readonly query: string; readonly accept: boolean }) => Promise<string>;
};
