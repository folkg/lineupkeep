import { Schema } from "effect";

import { TeamId } from "./FantasyTeam.ts";
import { normalizeNoteText, noteTextLength } from "./NoteText.ts";

export const agentNoteLimit = 2_000;
export const recentAgentNoteLimit = 20;

type AgentNoteRejection = "empty" | "too_long";

export type AgentNoteCheck =
  | { readonly valid: true; readonly body: string }
  | { readonly valid: false; readonly reason: AgentNoteRejection; readonly message: string };

export function checkAgentNote(raw: string): AgentNoteCheck {
  const body = normalizeNoteText(raw);
  if (body === null) {
    return {
      valid: false,
      reason: "empty",
      message: "An agent note needs some text. Write what you learned and add it again.",
    };
  }
  if (noteTextLength(body) > agentNoteLimit) {
    return {
      valid: false,
      reason: "too_long",
      message: `An agent note can be up to ${String(agentNoteLimit)} characters. Shorten it and add it again.`,
    };
  }
  return { valid: true, body };
}

export const TeamAgentNoteAuthor = Schema.Struct({
  clientId: Schema.NonEmptyString,
  name: Schema.NullOr(Schema.NonEmptyString),
}).pipe(
  Schema.annotate({
    description:
      "The OAuth client that wrote the note: its registration and self-declared name, never supplied by the caller.",
  }),
);
export type TeamAgentNoteAuthor = typeof TeamAgentNoteAuthor.Type;

export const TeamAgentNote = Schema.Struct({
  author: TeamAgentNoteAuthor,
  body: Schema.NonEmptyString,
  writtenAt: Schema.DateTimeUtc,
}).pipe(
  Schema.annotate({
    description:
      "A durable agent note about a team: client memory, append-only, and never the owner's instruction.",
  }),
);
export type TeamAgentNote = typeof TeamAgentNote.Type;

export const TeamAgentNoteSaved = Schema.Struct({
  team: TeamId,
  author: TeamAgentNoteAuthor,
  body: Schema.NonEmptyString,
  writtenAt: Schema.DateTimeUtc,
}).pipe(
  Schema.annotate({
    description: "The note that was appended, with its author and time.",
  }),
);
export type TeamAgentNoteSaved = typeof TeamAgentNoteSaved.Type;
