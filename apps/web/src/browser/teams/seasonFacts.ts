import type { TeamScoringFormat } from "@lineupkeep/backend/connections/FantasyTeam";
import { EffectArray } from "@lineupkeep/collections";

import type { TeamOverviewView } from "#contracts/connections/teamContract.ts";

import { matchupNumber, number, periodParts, placeLabel, recordLabel } from "./seasonLabels";
import type { PeriodParts } from "./seasonLabels";

export function seasonFacts(data: SeasonFactsData): SeasonFactsView {
  return {
    place: placeLabel(data.standing?.rank, data.teamCount),
    record: recordLabel(data.record),
    period: periodParts(
      data.currentPeriod,
      data.lastPeriod,
      data.seasonOver,
      data.usesPlayoffs,
      data.playoffStartWeek,
    ),
    pointsLine: pointsLine(data),
  };
}

export function matchupFacts(data: SeasonFactsData): MatchupFactsView | undefined {
  const matchup = data.matchup;
  if (matchup === undefined) {
    return undefined;
  }
  return {
    lead: matchupLead(data, matchup),
    projected:
      !showsPoints(data.format) ||
      (matchup.projectedPoints === null && matchup.opponentProjectedPoints === null)
        ? undefined
        : { points: matchup.projectedPoints, opponentPoints: matchup.opponentProjectedPoints },
    opponent: `Week ${String(matchup.week)} vs ${matchup.opponent}`,
    remaining:
      matchup.remainingGames === undefined
        ? undefined
        : `${number(matchup.remainingGames)} games left${
            matchup.opponentRemainingGames === undefined
              ? ""
              : ` · ${number(matchup.opponentRemainingGames)} for them`
          }`,
  };
}

export function matchupLine(facts: MatchupFactsView): string {
  return facts.remaining === undefined ? facts.opponent : `${facts.opponent} · ${facts.remaining}`;
}

export function totalCategoryPoints(rows: ReadonlyArray<CategoryRow>): number | undefined {
  const scored = EffectArray.filter(
    rows,
    (row) => row.scoring !== "informational" && row.value !== null,
  );
  return scored.length === 0
    ? undefined
    : EffectArray.reduce(scored, 0, (total, row) => total + (row.value ?? 0));
}

export function scoreText(value: number | null): string {
  return value === null ? "–" : matchupNumber(value);
}

function pointsLine(data: SeasonFactsData): string | undefined {
  const standing = data.standing;
  if (!showsPoints(data.format)) {
    return undefined;
  }
  const rotisserie = data.format === "rotisserie";
  const total = rotisserie ? (standing?.points ?? undefined) : (standing?.pointsFor ?? undefined);
  const parts = [
    ...(total === undefined ? [] : [`${number(total)} ${rotisserie ? "points" : "points for"}`]),
    ...(showsAgainst(data.format) && standing?.pointsAgainst !== null
      ? [`${number(standing?.pointsAgainst ?? 0)} against`]
      : []),
    ...(showsAgainst(data.format) && standing?.pointsBack !== null
      ? [`${number(standing?.pointsBack ?? 0)} behind`]
      : []),
  ];
  return parts.length === 0 ? undefined : EffectArray.join(parts, " · ");
}

function matchupLead(
  data: SeasonFactsData,
  matchup: NonNullable<SeasonFactsData["matchup"]>,
): MatchupLead | undefined {
  if (data.format === "head_to_head_categories") {
    return { kind: "categories", record: categoryRecord(matchup) };
  }
  if (matchup.points === null && matchup.opponentPoints === null) {
    return undefined;
  }
  return {
    kind: "points",
    score: { points: matchup.points, opponentPoints: matchup.opponentPoints },
  };
}

function categoryRecord(matchup: NonNullable<SeasonFactsData["matchup"]>): string {
  const categories = matchup.categories;
  const wins = EffectArray.filter(categories, (category) => category.result === "win").length;
  const losses = EffectArray.filter(categories, (category) => category.result === "loss").length;
  const ties = EffectArray.filter(categories, (category) => category.result === "tie").length;
  return `${String(wins)}-${String(losses)}-${String(ties)}`;
}

function showsPoints(format: TeamScoringFormat | undefined): boolean {
  return format !== "head_to_head_categories";
}

function showsAgainst(format: TeamScoringFormat | undefined): boolean {
  return format === "head_to_head_points" || format === "points";
}

export type SeasonFactsData = {
  readonly format?: TeamScoringFormat;
  readonly teamCount?: number;
  readonly seasonOver?: boolean;
  readonly currentPeriod?: number;
  readonly lastPeriod?: number;
  readonly usesPlayoffs?: boolean;
  readonly playoffStartWeek?: number;
  readonly standing?: {
    readonly rank: number | null;
    readonly points: number | null;
    readonly pointsFor: number | null;
    readonly pointsAgainst: number | null;
    readonly pointsBack: number | null;
  };
  readonly record?: {
    readonly wins: number;
    readonly losses: number;
    readonly ties: number;
    readonly percentage: number | null;
  };
  readonly matchup?: TeamOverviewView["matchup"];
  readonly caps?: {
    readonly gamesPlayed?: number;
    readonly inningsPitched?: number;
  };
};

export type CategoryRow = NonNullable<TeamOverviewView["categoryPoints"]>[number];

export type SeasonFactsView = {
  readonly place: string | undefined;
  readonly record: string | undefined;
  readonly period: PeriodParts | undefined;
  readonly pointsLine: string | undefined;
};

export type MatchupFactsView = {
  readonly lead: MatchupLead | undefined;
  readonly projected: ScoreView | undefined;
  readonly opponent: string;
  readonly remaining: string | undefined;
};

export type MatchupLead =
  | { readonly kind: "categories"; readonly record: string }
  | { readonly kind: "points"; readonly score: ScoreView };

type ScoreView = {
  readonly points: number | null;
  readonly opponentPoints: number | null;
};
