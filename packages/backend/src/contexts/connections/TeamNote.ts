export const teamNoteLimit = 2_000;

type TeamNoteRejection = "too_long";

export type TeamNoteCheck =
  | { readonly valid: true; readonly note: string | null }
  | { readonly valid: false; readonly reason: TeamNoteRejection; readonly message: string };

export function checkTeamNote(raw: string): TeamNoteCheck {
  const note = normalizedTeamNote(raw);
  const length = Array.from(note ?? "").length;
  if (length > teamNoteLimit) {
    return {
      valid: false,
      reason: "too_long",
      message: `A team note can be up to ${String(teamNoteLimit)} characters. Shorten it and save again.`,
    };
  }
  return { valid: true, note };
}

function normalizedTeamNote(raw: string): string | null {
  const note = Array.from(raw.replace(/\r\n?/gu, "\n"))
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || (code >= 32 && (code < 127 || code > 159));
    })
    .join("")
    .trim();
  return note.length === 0 ? null : note;
}
