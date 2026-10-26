import {
  averageExact,
  compareExact,
  exactFromInteger,
  scorePeriod,
} from "@lineupkeep/lineup-scoring";
import type { Exact, StatObservation } from "@lineupkeep/lineup-scoring";
import { makeSelectionBasis } from "@lineupkeep/lineup-solver";
import type { PlayerId, SelectionBasis } from "@lineupkeep/lineup-solver";

import { containsPeriod, periodKey } from "./period.ts";
import type {
  Period,
  PlayerPercentStarted,
  PlayerRealisedPoints,
  PolicyPlayer,
  PercentStartedPopulation,
  ValueAssessment,
  ValueSource,
  ValueSourceKind,
} from "./types.ts";
import { selectionUnits } from "./valuation.ts";

export const valueSourceLadder: ReadonlyArray<ValueSourceKind> = [
  "projected-points",
  "scoring-rules",
  "percent-started",
];

export const startCutPreference: ReadonlyArray<string> = ["diamond"];

const valueScale = 2;

export function preferredValueSource(
  available: ReadonlyArray<ValueSourceKind>,
): ValueSourceKind | undefined {
  return valueSourceLadder.find((kind) => available.includes(kind));
}

export function percentStartedPopulation(
  started: ReadonlyArray<PlayerPercentStarted>,
): PercentStartedPopulation {
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
    case "percent-started":
      return percentStartedSource(input.source, input.period);
  }
}

type ResolvedValueSource = {
  readonly basis: SelectionBasis;
  readonly valueOf: (player: PolicyPlayer) => SourceValue;
};

type SourceValue = {
  readonly assessment: ValueAssessment;
  readonly units: number | undefined;
};

type ProjectedPointsSource = Extract<ValueSource, { readonly kind: "projected-points" }>;
type ScoringRulesSource = Extract<ValueSource, { readonly kind: "scoring-rules" }>;
type PercentStartedSource = Extract<ValueSource, { readonly kind: "percent-started" }>;

function projectedPointsSource(source: ProjectedPointsSource, period: Period): ResolvedValueSource {
  const basis = makeSelectionBasis(`projected-points:${periodKey(period)}`);
  const projections = pointsById(source.projections);
  const realised = pointsById(source.realised);
  return {
    basis,
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
  const basis = makeSelectionBasis(
    `mean-points-per-period:${source.window.map(periodKey).join(",")}`,
  );
  const observations = observationsByKey(source.observations);
  return {
    basis,
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

function percentStartedSource(source: PercentStartedSource, period: Period): ResolvedValueSource {
  const population = percentStartedPopulation(source.started);
  const basis = makeSelectionBasis(
    `percent-started:${populationKey(population)}:${periodKey(period)}`,
  );
  const started = new Map(source.started.map((player) => [player.id, player]));
  return {
    basis,
    valueOf: (player) => {
      const entry = started.get(player.id);
      const percent = entry === undefined ? undefined : percentOf(entry, population);
      return {
        assessment: { kind: "percent-started", population, percent },
        units: percent === undefined ? undefined : selectionUnits(percent, valueScale),
      };
    },
  };
}

function percentOf(
  started: PlayerPercentStarted,
  population: PercentStartedPopulation,
): Exact | undefined {
  switch (population.kind) {
    case "overall":
      return started.percent;
    case "cut":
      return started.cuts.find((entry) => entry.cut === population.cut)?.percent;
  }
}

function populationKey(population: PercentStartedPopulation): string {
  switch (population.kind) {
    case "overall":
      return "overall";
    case "cut":
      return `cut-${population.cut}`;
  }
}

function pointsById(entries: ReadonlyArray<PlayerRealisedPoints>): ReadonlyMap<PlayerId, Exact> {
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

function observationKey(period: Period, playerId: PlayerId): string {
  return `${periodKey(period)}|${playerId}`;
}
