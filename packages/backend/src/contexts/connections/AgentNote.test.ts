import assert from "node:assert/strict";

import { it } from "@effect/vitest";
import { EffectString } from "@lineupkeep/collections";

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
    assert.ok(EffectString.includes(rejected.message, "needs some text"));
  }
});

it("accepts a body at the limit and refuses one past it", () => {
  const atLimit = checkAgentNote(EffectString.repeat("a", agentNoteLimit));
  const pastLimit = checkAgentNote(EffectString.repeat("a", agentNoteLimit + 1));

  assert.deepStrictEqual(atLimit, { valid: true, body: EffectString.repeat("a", agentNoteLimit) });
  const rejected = rejection(pastLimit);
  assert.strictEqual(rejected.reason, "too_long");
  assert.ok(EffectString.includes(rejected.message, String(agentNoteLimit)));
});
