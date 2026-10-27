import { describe, expect, it } from "vitest";

import { lineupRefusalKind } from "./plan.ts";
import type { LineupRefusalKind, RefusalCode } from "./plan.ts";

const expectedKinds: Record<RefusalCode, LineupRefusalKind> = {
  "policy:no-value-source": "structural",
  "policy:no-observed-periods": "transient",
  "solver:unusable-selection-value": "transient",
  "solver:lock-references-unknown-slot": "transient",
  "solver:locked-player-ineligible-for-slot": "transient",
  "solver:lock-capacity-exceeded": "transient",
  "solver:roster-exceeds-slot-capacity": "transient",
  "solver:player-has-no-legal-slot": "transient",
  "solver:required-starting-position-unfillable": "transient",
  "solver:no-legal-assignment": "transient",
  "assignment:plan-membership": "transient",
  "assignment:locked-player": "transient",
  "assignment:reserve-slot": "transient",
};

const expectedStructural = ["policy:no-value-source"];

describe("lineup refusal kinds", () => {
  it("classifies every refusal code the policy can emit", () => {
    for (const code of codesOf(expectedKinds)) {
      expect([code, lineupRefusalKind(code)]).toEqual([code, expectedKinds[code]]);
    }
  });

  it("treats only a league with no usable measurement as structural", () => {
    const structural = Object.entries(expectedKinds)
      .filter(([, kind]) => kind === "structural")
      .map(([code]) => code);

    expect(structural).toEqual(expectedStructural);
  });
});

function codesOf(kinds: Record<RefusalCode, LineupRefusalKind>): ReadonlyArray<RefusalCode> {
  return Object.keys(kinds).filter((code): code is RefusalCode => code in kinds);
}
