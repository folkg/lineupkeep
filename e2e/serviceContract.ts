import type { AuthSessionUser } from "@lineupkeep/backend/auth/AuthSession";
import type { BackendServices } from "@lineupkeep/backend/runtime/BackendRuntime";
import type { Effect } from "effect";

export type ServiceProgram = (
  user: AuthSessionUser,
  arguments_: unknown,
) => Effect.Effect<unknown, { readonly _tag: string }, BackendServices>;
