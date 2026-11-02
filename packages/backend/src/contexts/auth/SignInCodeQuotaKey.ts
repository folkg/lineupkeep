import { Crypto, Effect } from "effect";
import { Hex } from "effect/encoding";

import { AuthenticationUnavailable } from "#contexts/auth/Auth.ts";

export const signInCodeQuotaKeyFor = (
  crypto: Crypto.Crypto,
  email: string,
): Effect.Effect<string, AuthenticationUnavailable> =>
  crypto.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase())).pipe(
    Effect.mapError((cause) => AuthenticationUnavailable.make({ cause })),
    Effect.map((digest) => `email:${Hex.encode(digest)}`),
  );
