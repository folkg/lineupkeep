import type {
  ProviderRosterConstraints,
  ProviderRosterPosition,
} from "#contexts/connections/Provider.ts";

export function declaredRosterConstraints(
  positions: ReadonlyArray<ProviderRosterPosition>,
): ProviderRosterConstraints {
  return {
    rosterMaximum: positions
      .filter((position) => position.kind !== "reserve")
      .reduce((total, position) => total + position.count, 0),
    benchCapacity: "generic",
    startingSlotsMayStandEmpty: true,
    reserveEligibility: { kind: "published_positions" },
  };
}
