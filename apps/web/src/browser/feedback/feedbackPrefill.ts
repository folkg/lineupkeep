import type { FeedbackSurface } from "@lineupkeep/backend/feedback/Feedback";

import type { FeedbackContextView } from "#contracts/feedback/feedbackContract.ts";

const surfaces = [
  "app",
  "teams",
  "team",
  "run",
  "connections",
  "mcp",
] as const satisfies ReadonlyArray<FeedbackSurface>;

export type FeedbackSearch = {
  readonly surface?: FeedbackSurface;
  readonly team?: string;
  readonly teamName?: string;
};

const teamNameLimit = 100;

export function parseFeedbackSearch(input: Record<string, unknown>): FeedbackSearch {
  const surface = input["surface"];
  const team = input["team"];
  const teamName = teamNameFrom(input["teamName"]);
  return {
    ...(typeof surface === "string" && isSurface(surface) ? { surface } : {}),
    ...(typeof team === "string" && isUuid(team) ? { team } : {}),
    ...(teamName === undefined ? {} : { teamName }),
  };
}

export function feedbackTitleFromSearch(search: FeedbackSearch): string {
  return search.teamName === undefined ? "" : `Problem with ${search.teamName}`;
}

export function feedbackContextFromSearch(search: FeedbackSearch): FeedbackContextView {
  return {
    ...(search.surface === undefined ? {} : { surface: search.surface }),
    ...(search.team === undefined ? {} : { team: search.team }),
  };
}

function teamNameFrom(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const name = value.trim();
  return name.length === 0 || name.length > teamNameLimit ? undefined : name;
}

function isSurface(value: string): value is FeedbackSurface {
  return surfaces.some((surface) => surface === value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}
