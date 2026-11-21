import { Array as EffectArray } from "effect";
export function normalizeNoteText(raw: string): string | null {
  const note = EffectArray.join(
    EffectArray.filter(Array.from(raw.replace(/\r\n?/gu, "\n")), (character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 9 || code === 10 || (code >= 32 && (code < 127 || code > 159));
    }),
    "",
  ).trim();
  return note.length === 0 ? null : note;
}

export function noteTextLength(note: string): number {
  return Array.from(note).length;
}
