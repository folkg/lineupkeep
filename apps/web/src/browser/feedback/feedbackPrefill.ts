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
};

export function parseFeedbackSearch(input: Record<string, unknown>): FeedbackSearch {
  const surface = input["surface"];
  const team = input["team"];
  return {
    ...(typeof surface === "string" && isSurface(surface) ? { surface } : {}),
    ...(typeof team === "string" && isUuid(team) ? { team } : {}),
  };
}

export function feedbackContextFromSearch(search: FeedbackSearch): FeedbackContextView {
  return {
    ...(search.surface === undefined ? {} : { surface: search.surface }),
    ...(search.team === undefined ? {} : { team: search.team }),
  };
}

function isSurface(value: string): value is FeedbackSurface {
  return surfaces.some((surface) => surface === value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}
