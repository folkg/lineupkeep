import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/solid";

export const authClient = makeAuthClient();

export function requireAuthSuccess(result: AuthClientResult): void {
  if (result.error !== null) {
    throw new AuthEndpointFailure(result.error);
  }
}

export class AuthEndpointFailure extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(error: AuthClientError) {
    super(error.message ?? error.statusText);
    this.status = error.status;
    this.code = error.code;
  }
}

export function makeAuthClient(customFetchImpl?: typeof globalThis.fetch): ApplicationAuthClient {
  return createAuthClient({
    plugins: [emailOTPClient(), oauthProviderClient()],
    fetchOptions: { customFetchImpl },
  });
}

type ApplicationAuthClient = ReturnType<
  typeof createAuthClient<{
    plugins: [ReturnType<typeof emailOTPClient>, ReturnType<typeof oauthProviderClient>];
  }>
>;

type AuthClientResult = { readonly error: AuthClientError | null };
type AuthClientError = {
  readonly status: number;
  readonly statusText: string;
  readonly code?: string | undefined;
  readonly message?: string | undefined;
};
