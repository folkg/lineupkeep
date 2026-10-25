import type { AuthSessionUser } from "@sourdough/backend/auth/AuthSession";
import type { BackendServices } from "@sourdough/backend/runtime/BackendRuntime";
import type { Effect } from "effect";

export type ServiceProgram = (
  user: AuthSessionUser,
  arguments_: unknown,
) => Effect.Effect<unknown, { readonly _tag: string }, BackendServices>;
