import assert from "node:assert/strict";

import { it } from "@effect/vitest";

import type { AgentNoteCheck } from "./AgentNote.ts";
import { agentNoteLimit, checkAgentNote } from "./AgentNote.ts";

function rejection(check: AgentNoteCheck): Extract<AgentNoteCheck, { valid: false }> {
  if (check.valid) {
    throw new Error("Expected the note to be refused");
  }
  return check;
}

it("accepts an agent note and trims its edges", () => {
  const checked = checkAgentNote("  Goalie bubble is thinner than the roster shows.  ");

  assert.deepStrictEqual(checked, {
    valid: true,
    body: "Goalie bubble is thinner than the roster shows.",
  });
});

it("refuses an empty or whitespace-only body with a plain reason", () => {
  for (const raw of ["", " \n\t "]) {
    const rejected = rejection(checkAgentNote(raw));

    assert.strictEqual(rejected.reason, "empty");
    assert.ok(rejected.message.includes("needs some text"));
  }
});

it("accepts a body at the limit and refuses one past it", () => {
  const atLimit = checkAgentNote("a".repeat(agentNoteLimit));
  const pastLimit = checkAgentNote("a".repeat(agentNoteLimit + 1));

  assert.deepStrictEqual(atLimit, { valid: true, body: "a".repeat(agentNoteLimit) });
  const rejected = rejection(pastLimit);
  assert.strictEqual(rejected.reason, "too_long");
  assert.ok(rejected.message.includes(String(agentNoteLimit)));
});

it("counts a character outside the basic plane once", () => {
  const checked = checkAgentNote("🏒".repeat(agentNoteLimit));

  assert.strictEqual(checked.valid, true);
});

it("normalizes line endings and drops control characters", () => {
  const checked = checkAgentNote("Keeper\r\nReason:\u0007 joins next week\rThird line");

  assert.deepStrictEqual(checked, {
    valid: true,
    body: "Keeper\nReason: joins next week\nThird line",
  });
});
