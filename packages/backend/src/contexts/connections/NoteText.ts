export function normalizeNoteText(raw: string): string | null {
  const note = Array.from(raw.replace(/\r\n?/gu, "\n"))
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || (code >= 32 && (code < 127 || code > 159));
    })
    .join("")
    .trim();
  return note.length === 0 ? null : note;
}

export function noteTextLength(note: string): number {
  return Array.from(note).length;
}
