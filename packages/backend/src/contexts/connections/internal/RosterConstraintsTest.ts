import { Array as EffectArray } from "effect";

import type {
  ProviderRosterConstraints,
  ProviderRosterPosition,
} from "#contexts/connections/Provider.ts";

export function declaredRosterConstraints(
  positions: ReadonlyArray<ProviderRosterPosition>,
): ProviderRosterConstraints {
  return {
    rosterMaximum: EffectArray.reduce(
      EffectArray.filter(positions, (position) => position.kind !== "reserve"),
      0,
      (total, position) => total + position.count,
    ),
    benchCapacity: "generic",
    startingSlotsMayStandEmpty: true,
    reserveEligibility: { kind: "published_positions" },
  };
}
