import { AuthenticationRequestFailure } from "#browser/session/AuthenticationRequestFailure.ts";
import type { NoteMutationError, NoteRequestResult } from "#contracts/notes/noteContract.ts";

export function requireNoteSuccess<TData>(result: NoteRequestResult<TData>): TData {
  switch (result.type) {
    case "success":
      return result.data;
    case "error":
      if (result.error.type === "auth.required") {
        throw new AuthenticationRequestFailure(result.error);
      }
      throw new NoteWriteFailure(result.error);
  }
}

class NoteWriteFailure extends Error {
  constructor(readonly reason: NoteMutationError) {
    super(reason.type);
  }
}

export function describeNoteFailure(error: unknown): NoteFailure {
  if (error instanceof AuthenticationRequestFailure) {
    return {
      kind: "authentication",
      message: "Your session has ended. Sign in again to continue; your changes are still here.",
    };
  }
  if (error instanceof NoteWriteFailure) {
    switch (error.reason.type) {
      case "note.list_invalid":
      case "note.input_invalid":
        return {
          kind: "invalid_input",
          message: "The submitted values were rejected. Review them before submitting again.",
        };
      case "note.not_found":
        return {
          kind: "unavailable",
          message:
            "This note is no longer available. Your changes are still here. Copy them before closing the editor.",
        };
      case "note.lifecycle_conflict":
        return {
          kind: "conflict",
          message: "This note changed elsewhere. Check its latest state before trying again.",
        };
      case "note.lifecycle_rejected":
        return {
          kind: "rejected",
          message: "This action is not available in the note’s current state. Check latest.",
        };
      case "note.create_failed":
      case "note.persistence_failed":
        break;
    }
  }
  return {
    kind: "unconfirmed",
    message: "We could not confirm the change. Check latest before submitting again.",
  };
}

export type NoteFailure = {
  readonly kind:
    | "authentication"
    | "invalid_input"
    | "unavailable"
    | "rejected"
    | "conflict"
    | "unconfirmed";
  readonly message: string;
};
