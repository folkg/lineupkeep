import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";

import type { AuthService } from "#contexts/auth/Auth.ts";
import { AuthorizationScopes } from "#contexts/auth/AuthorizationScopes.ts";
import { AuthDatabase } from "#contexts/auth/internal/AuthDatabase.ts";
import { AuthLive } from "#contexts/auth/internal/AuthLive.ts";
import { BetterAuthAdapter } from "#contexts/auth/internal/BetterAuthAdapter.ts";
import { SignInCodeQuotaRepository } from "#contexts/auth/internal/SignInCodeQuotaRepository.ts";
import { NoteRepository } from "#contexts/notes/internal/NoteRepository.ts";
import { NotesDatabase } from "#contexts/notes/internal/NotesDatabase.ts";
import { NotesLive } from "#contexts/notes/internal/NotesLive.ts";
import type { Notes } from "#contexts/notes/Notes.ts";
import { noteScopes } from "#contexts/notes/NoteScopes.ts";
import { PostgresLive } from "#database/internal/PostgresLive.ts";
import { EmailDelivery } from "#email/EmailDelivery.ts";

const AuthLayer = AuthLive.pipe(
  Layer.provide(BetterAuthAdapter.layer),
  Layer.provide(Layer.succeed(AuthorizationScopes)(Object.values(noteScopes))),
  Layer.provide(SignInCodeQuotaRepository.layer),
  Layer.provide(AuthDatabase.layer),
  Layer.provide(EmailDelivery.fromConfig),
  Layer.provide(FetchHttpClient.layer),
);
const NotesLayer = NotesLive.pipe(
  Layer.provide(NoteRepository.layer),
  Layer.provide(NotesDatabase.layer),
);
export const ApplicationLayer = Layer.mergeAll(NotesLayer, AuthLayer).pipe(
  Layer.provide(PostgresLive),
  Layer.provide(NodeCrypto.layer),
);

export type BackendServices = AuthService | Notes;
