import assert from "node:assert/strict";

import { it } from "@effect/vitest";

import { normalizeNoteText, noteTextLength } from "./NoteText.ts";

it("counts a character outside the basic plane once", () => {
  assert.strictEqual(noteTextLength("🏒".repeat(2_000)), 2_000);
});

it("normalizes line endings and drops control characters", () => {
  assert.strictEqual(
    normalizeNoteText("Keeper\r\nReason:\u0007 joins next week\rThird line"),
    "Keeper\nReason: joins next week\nThird line",
  );
});
