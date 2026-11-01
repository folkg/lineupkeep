import type {
  SignInSessionPersistenceFailed,
  SignInSessionSummary,
} from "@lineupkeep/backend/auth/SignInSessions";
import { DateTime, Schema } from "effect";

import type { SignInSessionErrorType, SignInSessionView } from "#contracts/auth/authContract.ts";
import type { ExpectedFailure } from "#server/backendEntry.ts";

export function toSignInSessionView(
  session: SignInSessionSummary,
  currentSessionId: string,
): SignInSessionView {
  return {
    id: session.id,
    device: session.device,
    startedAt: DateTime.formatIso(session.startedAt),
    lastUsedAt: DateTime.formatIso(session.lastUsedAt),
    current: session.id === currentSessionId,
  };
}

export function mapSignInSessionError(
  error: SignInSessionPersistenceFailed | SignInSessionInputInvalid,
): ExpectedFailure<SignInSessionErrorType> {
  return error._tag === "SignInSessionInputInvalid"
    ? { type: "session.input_invalid", outcome: "rejected" }
    : { type: "session.persistence_failed", outcome: "failure" };
}

export class SignInSessionInputInvalid extends Schema.TaggedError<
  SignInSessionInputInvalid,
  { readonly brand: unique symbol }
>()("SignInSessionInputInvalid", {}) {}
