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

it("counts a character outside the basic plane once", () => {
  const note = "🏒".repeat(teamNoteLimit);

  const checked = checkTeamNote(note);

  assert.strictEqual(checked.valid, true);
});

it("refuses a token-shaped value and does not echo it", () => {
  const token =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

  const rejected = rejection(checkTeamNote(`Reconnect with ${token}`));

  assert.strictEqual(rejected.reason, "credential_like");
  assert.ok(!rejected.message.includes(token));
  assert.ok(rejected.message.includes("does not store"));
});

it("refuses a password assignment and a provider session cookie", () => {
  const assignment = rejection(checkTeamNote("password: hunter2000"));
  const cookie = rejection(checkTeamNote("Y=A1b2C3d4E5f6G7h8I9j0K1l2M3n4"));

  assert.strictEqual(assignment.reason, "credential_like");
  assert.strictEqual(cookie.reason, "credential_like");
});

it("leaves ordinary league context alone", () => {
  const checked = checkTeamNote(
    "Dynasty league. Keep both goalies through the expansion draft. Salary cap 200, cost 12 next season. Round 2 pick owed to Team North.",
  );

  assert.strictEqual(checked.valid, true);
});

it("normalizes line endings and drops control characters", () => {
  const checked = checkTeamNote("Keeper\r\nReason:\u0007 joins next week\rThird line");

  assert.strictEqual(checked.valid, true);
  assert.strictEqual(checked.note, "Keeper\nReason: joins next week\nThird line");
});
