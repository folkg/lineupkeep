import {
  addExact,
  clampExact,
  compareExact,
  divideByInteger,
  exactFromInteger,
  minExact,
  multiplyExact,
  parseExact,
  type Exact,
} from "./Exact.ts";
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
  "projection",
  "community-start-rate",
  "ownership-composite",
];

const ownershipDeltaBound = parseExact("4");
const negativeOwnershipDeltaBound = parseExact("-4");
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
    case "projection":
      return projectionSource(input.source);
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

type ProjectionSource = Extract<ValueSource, { readonly kind: "projection" }>;
type CommunityStartRateSource = Extract<ValueSource, { readonly kind: "community-start-rate" }>;
type OwnershipCompositeSource = Extract<ValueSource, { readonly kind: "ownership-composite" }>;

function projectionSource(source: ProjectionSource): ResolvedValueSource {
  const ranks = new Map(source.players.map((player) => [player.id, player.rank]));
  const worstRank = source.players.reduce((worst, player) => Math.max(worst, player.rank), 0);
  return {
    label: `projected rank for ${periodLabel(source.period)}`,
    unitsOf: (player) => {
      const rank = ranks.get(player.id);
      return rank === undefined ? undefined : worstRank + 1 - rank;
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
    label: `percent started for ${periodLabel(period)}${populationFinding(population)}`,
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
    label: `ownership composite for ${source.sport} ${periodLabel(period)} (no positional scarcity)`,
    unitsOf: (player) => {
      const facts = byId.get(player.id);
      const percentOwned = facts?.percentOwned;
      if (facts === undefined || percentOwned === undefined) {
        return undefined;
      }
      const deltaAdjustment =
        facts.delta === undefined
          ? exactFromInteger(0n)
          : clampExact(facts.delta, negativeOwnershipDeltaBound, ownershipDeltaBound);
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

function populationFinding(population: CommunityStartRatePopulation): string {
  switch (population.kind) {
    case "cut":
      return ` (${population.cut} cut)`;
    case "overall":
      return population.finding === "cut-incomplete"
        ? ` (the ${population.cut} cut was incomplete)`
        : ` (the ${population.cut} cut was unpopulated)`;
  }
}

function periodLabel(period: Period): string {
  return period.kind === "week" ? `week ${String(period.week)}` : period.date;
}
