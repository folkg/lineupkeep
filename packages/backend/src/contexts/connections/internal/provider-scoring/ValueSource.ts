import { averageExact, compareExact, exactFromInteger, type Exact } from "./Exact.ts";
import { containsPeriod, periodKey } from "./Period.ts";
import { scorePeriod } from "./Scoring.ts";
import type { StatObservation } from "./types.ts";
import type {
  CommunityStartRatePopulation,
  Period,
  PlayerCommunityStartRate,
  PlayerRealisedPoints,
  PolicyPlayer,
  ValueAssessment,
  ValueSource,
  ValueSourceKind,
} from "./types.ts";
import { selectionUnits } from "./Valuation.ts";

export const valueSourceLadder: ReadonlyArray<ValueSourceKind> = [
  "projected-points",
  "scoring-rules",
  "community-start-rate",
];

const startCutPreference: ReadonlyArray<string> = ["diamond"];

const valueScale = 2;

function communityStartRatePopulation(
  started: ReadonlyArray<PlayerCommunityStartRate>,
): CommunityStartRatePopulation {
  for (const cut of startCutPreference) {
    const populated = started.some((player) =>
      player.cuts.some(
        (entry) => entry.cut === cut && compareExact(entry.percent, exactFromInteger(0n)) > 0,
      ),
    );
    if (populated) {
      return { kind: "cut", cut };
    }
  }
  return { kind: "overall" };
}

export function resolveValueSource(input: {
  readonly source: ValueSource;
  readonly period: Period;
}): ResolvedValueSource {
  switch (input.source.kind) {
    case "projected-points":
      return projectedPointsSource(input.source, input.period);
    case "scoring-rules":
      return scoringRulesSource(input.source);
    case "community-start-rate":
      return communityStartRateSource(input.source, input.period);
  }
}

export type ResolvedValueSource = {
  readonly label: string;
  readonly valueOf: (player: PolicyPlayer) => SourceValue;
};

type SourceValue = {
  readonly assessment: ValueAssessment;
  readonly units: number | undefined;
};

type ProjectedPointsSource = Extract<ValueSource, { readonly kind: "projected-points" }>;
type ScoringRulesSource = Extract<ValueSource, { readonly kind: "scoring-rules" }>;
type CommunityStartRateSource = Extract<ValueSource, { readonly kind: "community-start-rate" }>;

function projectedPointsSource(source: ProjectedPointsSource, period: Period): ResolvedValueSource {
  const label = `projected-points:${periodKey(period)}`;
  const projections = pointsById(source.projections);
  const realised = pointsById(source.realised);
  return {
    label,
    valueOf: (player) => {
      const projection = projections.get(player.id);
      return {
        assessment: {
          kind: "projected-points",
          projection,
          realised: realised.get(player.id),
        },
        units: projection === undefined ? undefined : selectionUnits(projection, valueScale),
      };
    },
  };
}

function scoringRulesSource(source: ScoringRulesSource): ResolvedValueSource {
  const label = `mean-points-per-period:${source.window.map(periodKey).join(",")}`;
  const observations = observationsByKey(source.observations);
  return {
    label,
    valueOf: (player) => {
      const countedPeriods: Array<Period> = [];
      const skippedPeriods: Array<Period> = [];
      const periodPoints: Array<Exact> = [];
      for (const windowPeriod of source.window) {
        if (containsPeriod(player.nonGamePeriods, windowPeriod)) {
          skippedPeriods.push(windowPeriod);
          continue;
        }
        const stats = observations.get(observationKey(windowPeriod, player.id));
        if (stats === undefined) {
          skippedPeriods.push(windowPeriod);
          continue;
        }
        const score = scorePeriod(source.scoring, stats);
        if (score.kind === "unknown") {
          skippedPeriods.push(windowPeriod);
          continue;
        }
        countedPeriods.push(windowPeriod);
        periodPoints.push(score.points);
      }
      const average =
        periodPoints.length === 0 ? undefined : averageExact(periodPoints, source.scoring.scale);
      return {
        assessment: {
          kind: "realised-points",
          countedPeriods,
          skippedPeriods,
          periodPoints,
          average,
        },
        units: average === undefined ? 0 : selectionUnits(average, source.scoring.scale),
      };
    },
  };
}

function communityStartRateSource(
  source: CommunityStartRateSource,
  period: Period,
): ResolvedValueSource {
  const population = communityStartRatePopulation(source.started);
  const label = `community-start-rate:${populationKey(population)}:${periodKey(period)}`;
  const started = new Map(source.started.map((player) => [player.id, player]));
  return {
    label,
    valueOf: (player) => {
      const entry = started.get(player.id);
      const percent = entry === undefined ? undefined : percentOf(entry, population);
      return {
        assessment: { kind: "community-start-rate", population, percent },
        units: percent === undefined ? undefined : selectionUnits(percent, valueScale),
      };
    },
  };
}

function percentOf(
  started: PlayerCommunityStartRate,
  population: CommunityStartRatePopulation,
): Exact | undefined {
  switch (population.kind) {
    case "overall":
      return started.percent;
    case "cut":
      return started.cuts.find((entry) => entry.cut === population.cut)?.percent;
  }
}

function populationKey(population: CommunityStartRatePopulation): string {
  switch (population.kind) {
    case "overall":
      return "overall";
    case "cut":
      return `cut-${population.cut}`;
  }
}

function pointsById(entries: ReadonlyArray<PlayerRealisedPoints>): ReadonlyMap<string, Exact> {
  return new Map(entries.map((entry) => [entry.id, entry.points]));
}

function observationsByKey(
  observations: ScoringRulesSource["observations"],
): ReadonlyMap<string, ReadonlyArray<StatObservation>> {
  const index = new Map<string, ReadonlyArray<StatObservation>>();
  for (const entry of observations) {
    for (const player of entry.players) {
      index.set(observationKey(entry.period, player.id), player.stats);
    }
  }
  return index;
}

function observationKey(period: Period, playerId: string): string {
  return `${periodKey(period)}|${playerId}`;
}
