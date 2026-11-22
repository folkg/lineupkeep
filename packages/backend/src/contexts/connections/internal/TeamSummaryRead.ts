import { Array as EffectArray } from "effect";

import type { ProviderLeagueSettings } from "#contexts/connections/Provider.ts";
import type { StandingRow, TeamSummaryData } from "#contexts/connections/QueryResults.ts";

const unlabelledDetail =
  "The league scoring categories could not be read, so standings categories cannot be labelled.";
const rotisseriePointsMissing = "Your league published no rotisserie points for this category.";

export function standingSummary(input: {
  readonly included: boolean;
  readonly current: StandingRow | undefined;
  readonly detail: string;
}): TeamSummaryData["standing"] {
  if (!input.included) {
    return undefined;
  }
  if (input.current === undefined) {
    return { status: "unsupported", detail: input.detail };
  }
  const current = input.current;
  return {
    status: "available",
    rank: current.rank,
    ...(current.playoffSeed === undefined ? {} : { playoffSeed: current.playoffSeed }),
    points: current.points,
    gamesBack: current.gamesBack,
    pointsBack: current.pointsBack,
    pointsFor: current.pointsFor,
    pointsAgainst: current.pointsAgainst,
    ...(current.streak === undefined ? {} : { streak: current.streak }),
  };
}

export function recordSummary(input: {
  readonly included: boolean;
  readonly current: StandingRow | undefined;
  readonly detail: string;
}): TeamSummaryData["record"] {
  if (!input.included) {
    return undefined;
  }
  if (input.current?.record === undefined) {
    return {
      status: "unsupported",
      detail:
        input.current === undefined
          ? input.detail
          : "This league format publishes a rank and season points but no win–loss record.",
    };
  }
  return { status: "available", ...input.current.record };
}

export function categoryTotalsSummary(input: {
  readonly included: boolean;
  readonly current: StandingRow | undefined;
  readonly league: Pick<ProviderLeagueSettings, "format"> | undefined;
  readonly detail: string;
  readonly omittedCount: number;
}): TeamSummaryData["categoryTotals"] {
  if (!input.included) {
    return undefined;
  }
  if (input.current === undefined || !hasPublishedCategoryValue(input.current.categories ?? [])) {
    return {
      status: "unsupported",
      detail:
        input.current === undefined
          ? input.detail
          : input.league === undefined
            ? unlabelledDetail
            : "Your league published no season category totals for this league format.",
    };
  }
  return {
    status: "available",
    values: [...(input.current.categories ?? [])],
    omittedCategories: omittedCategories(input.omittedCount),
  };
}

export function categoryPointsSummary(input: {
  readonly included: boolean;
  readonly current: StandingRow | undefined;
  readonly league: Pick<ProviderLeagueSettings, "format"> | undefined;
  readonly detail: string;
  readonly omittedCount: number;
}): TeamSummaryData["categoryPoints"] {
  if (!input.included) {
    return undefined;
  }
  if (
    input.current === undefined ||
    !hasPublishedCategoryValue(input.current.categoryPoints ?? [])
  ) {
    return {
      status: "unsupported",
      detail:
        input.current === undefined
          ? input.detail
          : input.league === undefined
            ? unlabelledDetail
            : input.league.format === "rotisserie"
              ? rotisseriePointsMissing
              : "Your league publishes rotisserie category points only for rotisserie leagues.",
    };
  }
  return {
    status: "available",
    values: [...(input.current.categoryPoints ?? [])],
    omittedCategories: omittedCategories(input.omittedCount),
  };
}

export function standingsSummary(input: {
  readonly included: boolean;
  readonly outcome: "ok" | "unsupported" | "failed" | undefined;
  readonly rows: ReadonlyArray<StandingRow>;
  readonly league: Pick<ProviderLeagueSettings, "format"> | undefined;
  readonly detail: string;
}): TeamSummaryData["standings"] {
  if (!input.included) {
    return undefined;
  }
  if (input.outcome !== "ok") {
    return { status: "unsupported", detail: input.detail };
  }
  return {
    status: "available",
    format: input.league === undefined ? "unknown" : input.league.format,
    teams: EffectArray.map(input.rows, (row) => ({
      team: row.team,
      name: row.name,
      current: row.current,
      rank: row.rank,
      ...(row.record === undefined
        ? {}
        : {
            wins: row.record.wins,
            losses: row.record.losses,
            ties: row.record.ties,
            percentage: row.record.percentage,
          }),
      points: row.points,
      ...(row.gamesBack === null ? {} : { gamesBack: row.gamesBack }),
      ...(row.pointsBack === null ? {} : { pointsBack: row.pointsBack }),
    })),
  };
}

function hasPublishedCategoryValue(
  values: ReadonlyArray<{ readonly value: number | null }>,
): boolean {
  return EffectArray.some(values, (entry) => entry.value !== null);
}

function omittedCategories(count: number): { readonly count: number; readonly detail: string } {
  return {
    count,
    detail:
      count === 0
        ? "Every category your league published has a league scoring definition."
        : `${String(count)} stat ids in the standings have no league scoring definition and are omitted because they cannot be named.`,
  };
}
