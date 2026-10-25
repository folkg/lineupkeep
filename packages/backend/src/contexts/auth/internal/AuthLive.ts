import { Layer } from "effect";

import { AuthService } from "#contexts/auth/Auth.ts";

import { BetterAuthAdapter } from "./BetterAuthAdapter.ts";

export const AuthLive = Layer.effect(AuthService, BetterAuthAdapter);
