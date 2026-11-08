import assert from "node:assert/strict";

import { it } from "@effect/vitest";

import type { TeamNoteCheck } from "./TeamNote.ts";
import { checkTeamNote, teamNoteLimit } from "./TeamNote.ts";

function rejection(check: TeamNoteCheck): Extract<TeamNoteCheck, { valid: false }> {
  if (check.valid) {
    throw new Error("Expected the note to be refused");
  }
  return check;
}

it("accepts a keeper note and trims its edges", () => {
  const checked = checkTeamNote("  Keep for two more seasons; costs a round-3 pick.  ");

  assert.deepStrictEqual(checked, {
    valid: true,
    note: "Keep for two more seasons; costs a round-3 pick.",
  });
});

it("clears a note that holds only whitespace", () => {
  const checked = checkTeamNote(" \n\t ");

  assert.deepStrictEqual(checked, { valid: true, note: null });
});

it("accepts a note at the character limit and refuses one past it", () => {
  const atLimit = checkTeamNote("a".repeat(teamNoteLimit));
  const pastLimit = checkTeamNote("a".repeat(teamNoteLimit + 1));

  assert.deepStrictEqual(atLimit, { valid: true, note: "a".repeat(teamNoteLimit) });
  const rejected = rejection(pastLimit);
  assert.strictEqual(rejected.reason, "too_long");
  assert.ok(rejected.message.includes(String(teamNoteLimit)));
});

it("accepts a note that contains a token-shaped value", () => {
  const token =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

  const checked = checkTeamNote(`Reconnect with ${token}`);

  assert.deepStrictEqual(checked, { valid: true, note: `Reconnect with ${token}` });
});

it("accepts a password assignment and a provider session cookie", () => {
  assert.strictEqual(checkTeamNote("password: hunter2000").valid, true);
  assert.strictEqual(checkTeamNote("Y=A1b2C3d4E5f6G7h8I9j0K1l2M3n4").valid, true);
});

it("leaves ordinary league context alone", () => {
  const checked = checkTeamNote(
    "Dynasty league. Keep both goalies through the expansion draft. Salary cap 200, cost 12 next season. Round 2 pick owed to Team North.",
  );

  assert.strictEqual(checked.valid, true);
});
