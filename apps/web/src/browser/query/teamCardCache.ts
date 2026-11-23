import { EffectArray, jsonString, jsonValue } from "@lineupkeep/collections";

import type { TeamCardView } from "#contracts/connections/teamContract.ts";

const storageKey = "lineupkeep.team-card-facts.v1";

export function readCachedTeamCards(viewerId: string): ReadonlyArray<TeamCardView> {
  if (typeof localStorage === "undefined") {
    return [];
  }
  try {
    const parsed = jsonValue(localStorage.getItem(storageKey) ?? "null");
    if (
      !isRecord(parsed) ||
      parsed["viewerId"] !== viewerId ||
      !EffectArray.isArray(parsed["cards"])
    ) {
      return [];
    }
    return EffectArray.flatMap(parsed["cards"], (card) => (isTeamCard(card) ? [card] : []));
  } catch {
    return [];
  }
}

export function storeCachedTeamCards(viewerId: string, cards: ReadonlyArray<TeamCardView>): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(storageKey, jsonString({ viewerId, cards }));
  } catch {
    return;
  }
}

export function clearCachedTeamCards(): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.removeItem(storageKey);
  } catch {
    return;
  }
}

function isTeamCard(value: unknown): value is TeamCardView {
  if (!isRecord(value) || !isRecord(value["summary"]) || !isRecord(value["summary"]["team"])) {
    return false;
  }
  return typeof value["summary"]["team"]["id"] === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
