import { EffectArray, jsonString, jsonValue } from "@lineupkeep/collections";

import type { TeamCardView } from "#contracts/connections/teamContract.ts";

const storageKey = "lineupkeep.team-card-snapshot.v1";

export function readTeamCardSnapshot(): ReadonlyArray<TeamCardView> {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw === null) {
      return [];
    }
    const parsed = jsonValue<{ readonly cards?: ReadonlyArray<TeamCardView> }>(raw);
    return EffectArray.isArray(parsed.cards) ? parsed.cards : [];
  } catch {
    clearTeamCardSnapshot();
    return [];
  }
}

export function writeTeamCardSnapshot(cards: ReadonlyArray<TeamCardView>): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(storageKey, jsonString({ cards }));
  } catch {
    clearTeamCardSnapshot();
  }
}

export function clearTeamCardSnapshot(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.removeItem(storageKey);
}
