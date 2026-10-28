import {
  addExact,
  averageExact,
  compareExact,
  divideByInteger,
  exactFromInteger,
  minExact,
  multiplyExact,
  parseExact,
  type Exact,
} from "./Exact.ts";
import { containsPeriod, periodKey } from "./Period.ts";
import { scorePeriod } from "./Scoring.ts";
import type { StatObservation } from "./types.ts";
import type {
  CommunityStartRatePopulation,
  Period,
  PlayerCommunityStartRate,
  PlayerRank,
  PolicyPlayer,
  RankType,
  ValueSource,
  ValueSourceKind,
} from "./types.ts";
import { selectionUnits } from "./Valuation.ts";

export const valueSourceLadder: ReadonlyArray<ValueSourceKind> = [
  "projected-points",
  "scoring-rules",
  "ownership-composite",
  "community-start-rate",
];

const ownershipDeltaBound = parseExact("4");
const rankRatioScale = 6;
const rankScoreScale = parseExact("5");
const compositeScale = 4;
const half = parseExact("0.5");

const rankWeights: Readonly<Record<"football" | "hockey", Partial<Record<RankType, number>>>> = {
  football: { L4W: 40, PW: 35, PN4W: 25 },
  hockey: { L30: 40, L14: 30, PS7: 10, PSR: 20 },
};

export const communityStartRateCut = "platinum";

const valueScale = 2;

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
    case "ownership-composite":
      return ownershipCompositeSource(input.source, input.period);
  }
}

export type ResolvedValueSource = {
  readonly label: string;
  readonly unitsOf: (player: PolicyPlayer) => number | undefined;
};

type ScoringRulesSource = Extract<ValueSource, { readonly kind: "scoring-rules" }>;
type CommunityStartRateSource = Extract<ValueSource, { readonly kind: "community-start-rate" }>;
type OwnershipCompositeSource = Extract<ValueSource, { readonly kind: "ownership-composite" }>;

function projectedPointsSource(
  source: Extract<ValueSource, { readonly kind: "projected-points" }>,
  period: Period,
): ResolvedValueSource {
  const projections = new Map(source.projections.map((entry) => [entry.id, entry.points] as const));
  return {
    label: `projected-points:${periodKey(period)}`,
    unitsOf: (player) => {
      const projection = projections.get(player.id);
      return projection === undefined ? undefined : selectionUnits(projection, valueScale);
    },
  };
}

function scoringRulesSource(source: ScoringRulesSource): ResolvedValueSource {
  const observations = observationsByKey(source.observations);
  return {
    label: `mean-points-per-period:${source.window.map(periodKey).join(",")}`,
    unitsOf: (player) => {
      const periodPoints: Array<Exact> = [];
      for (const windowPeriod of source.window) {
        if (containsPeriod(player.nonGamePeriods, windowPeriod)) {
          continue;
        }
        const stats = observations.get(observationKey(windowPeriod, player.id));
        if (stats === undefined) {
          continue;
        }
        const points = scorePeriod(source.scoring, stats);
        if (points !== undefined) {
          periodPoints.push(points);
        }
      }
      const average =
        periodPoints.length === 0 ? undefined : averageExact(periodPoints, source.scoring.scale);
      return average === undefined ? 0 : selectionUnits(average, source.scoring.scale);
    },
  };
}

function communityStartRateSource(
  source: CommunityStartRateSource,
  period: Period,
): ResolvedValueSource {
  const population = communityStartRatePopulation(source.started);
  const started = new Map(source.started.map((player) => [player.id, player]));
  return {
    label: `community-start-rate:${populationKey(population)}:${periodKey(period)}`,
    unitsOf: (player) => {
      const entry = started.get(player.id);
      const percent = entry === undefined ? undefined : percentOf(entry, population);
      return percent === undefined ? undefined : selectionUnits(percent, valueScale);
    },
  };
}

function ownershipCompositeSource(
  source: OwnershipCompositeSource,
  period: Period,
): ResolvedValueSource {
  const byId = new Map(source.players.map((player) => [player.id, player]));
  const playersInLeague = exactFromInteger(
    BigInt(source.teamCount) * BigInt(source.standardRosterSpots),
  );
  return {
    label: `ownership-composite:no-positional-scarcity:${source.sport}:${periodKey(period)}`,
    unitsOf: (player) => {
      const facts = byId.get(player.id);
      const percentOwned = facts?.percentOwned;
      if (facts === undefined || percentOwned === undefined) {
        return undefined;
      }
      const deltaAdjustment =
        facts.delta === undefined
          ? exactFromInteger(0n)
          : minExact(facts.delta, ownershipDeltaBound);
      const rankScore = rankScoreOf(facts.ranks, source.sport, playersInLeague);
      const composite = addExact(
        addExact(multiplyExact(percentOwned, half), multiplyExact(rankScore, half)),
        deltaAdjustment,
      );
      return selectionUnits(composite, compositeScale);
    },
  };
}

function communityStartRatePopulation(
  started: ReadonlyArray<PlayerCommunityStartRate>,
): CommunityStartRatePopulation {
  const cutValues = started.flatMap((player) =>
    player.percent === undefined ? [] : [cutPercent(player)],
  );
  if (cutValues.some((percent) => percent === undefined)) {
    return { kind: "overall", cut: communityStartRateCut, finding: "cut-incomplete" };
  }
  const populated = cutValues.some(
    (percent) => percent !== undefined && compareExact(percent, exactFromInteger(0n)) > 0,
  );
  return populated
    ? { kind: "cut", cut: communityStartRateCut }
    : { kind: "overall", cut: communityStartRateCut, finding: "cut-unpopulated" };
}

function cutPercent(player: PlayerCommunityStartRate): Exact | undefined {
  return player.cuts.find((entry) => entry.cut === communityStartRateCut)?.percent;
}

function rankScoreOf(
  ranks: ReadonlyArray<PlayerRank>,
  sport: "football" | "hockey",
  playersInLeague: Exact,
): Exact {
  const weights = rankWeights[sport];
  const capped = ranks.flatMap((rank) => {
    const weight = weights[rank.type];
    if (weight === undefined || rank.rank < 1) {
      return [];
    }
    const positionScore = divideByInteger(playersInLeague, BigInt(rank.rank), rankRatioScale);
    return [minExact(positionScore, parseExact(String(weight / 5)))];
  });
  return multiplyExact(capped.reduce(addExact, exactFromInteger(0n)), rankScoreScale);
}

function percentOf(
  started: PlayerCommunityStartRate,
  population: CommunityStartRatePopulation,
): Exact | undefined {
  switch (population.kind) {
    case "overall":
      return started.percent;
    case "cut":
      return cutPercent(started);
  }
}

function populationKey(population: CommunityStartRatePopulation): string {
  switch (population.kind) {
    case "cut":
      return `cut-${population.cut}`;
    case "overall":
      return `overall:${population.cut}-${population.finding}`;
  }
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
