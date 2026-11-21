import { EffectString } from "@lineupkeep/collections";
import { Array as EffectArray } from "effect";

export function normalizeNoteText(raw: string): string | null {
  const note = EffectString.trim(
    EffectArray.join(
      EffectArray.filter(Array.from(EffectString.replace(raw, /\r\n?/gu, "\n")), (character) => {
        const code = EffectString.codePointAt(character, 0) ?? 0;
        return code === 9 || code === 10 || (code >= 32 && (code < 127 || code > 159));
      }),
      "",
    ),
  );
  return note.length === 0 ? null : note;
}

export function noteTextLength(note: string): number {
  return Array.from(note).length;
}
