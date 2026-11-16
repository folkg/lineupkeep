import { Effect } from "effect";
import { Digest } from "effect/crypto";
import { Hex } from "effect/encoding";

import type { AuthenticationUnavailable } from "#contexts/auth/Auth.ts";

export const signInCodeQuotaKeyFor = (
  digest: Digest.Digest["Service"],
  email: string,
): Effect.Effect<string, AuthenticationUnavailable> =>
  digest
    .digest(Digest.sha256, new TextEncoder().encode(email.trim().toLowerCase()))
    .pipe(Effect.map((bytes) => `email:${Hex.encode(bytes)}`));
