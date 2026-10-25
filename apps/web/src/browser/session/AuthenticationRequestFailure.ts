import type { AuthenticationFailure } from "#contracts/auth/authContract.ts";

export class AuthenticationRequestFailure extends Error {
  constructor(readonly reason: AuthenticationFailure) {
    super(reason.type);
  }
}
