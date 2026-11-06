import { normalizeNoteText, noteTextLength } from "./NoteText.ts";

export const teamNoteLimit = 2_000;

type TeamNoteRejection = "too_long";

export type TeamNoteCheck =
  | { readonly valid: true; readonly note: string | null }
  | { readonly valid: false; readonly reason: TeamNoteRejection; readonly message: string };

export function checkTeamNote(raw: string): TeamNoteCheck {
  const note = normalizeNoteText(raw);
  const length = note === null ? 0 : noteTextLength(note);
  if (length > teamNoteLimit) {
    return {
      valid: false,
      reason: "too_long",
      message: `A team note can be up to ${String(teamNoteLimit)} characters. Shorten it and save again.`,
    };
  }
  return { valid: true, note };
}
