import { EffectArray, EffectString } from "@lineupkeep/collections";

export function cardFormatLabel(format: string | undefined): string | undefined {
  switch (format) {
    case "head_to_head_categories":
      return "Categories";
    case "head_to_head_points":
      return "Points";
    case "rotisserie":
      return "Rotisserie";
    case "points":
      return "Points";
    case "unknown":
    case undefined:
      return undefined;
    default:
      return undefined;
  }
}

export function scoringLabel(label: string | undefined): string | undefined {
  if (label === undefined) {
    return undefined;
  }
  switch (EffectString.toLowerCase(EffectString.trim(label))) {
    case "h2h":
    case "head to head":
      return "Head to head";
    case "h2h cat":
    case "h2h cats":
    case "h2h categories":
    case "head to head, categories":
      return "Head to head categories";
    case "h2h points":
    case "h2h pts":
    case "head to head, points":
      return "Head to head points";
    case "roto":
      return "Rotisserie";
    default:
      return label;
  }
}

export function placeLabel(
  rank: number | null | undefined,
  teamCount: number | undefined,
): string | undefined {
  if (rank === null || rank === undefined || teamCount === undefined) {
    return undefined;
  }
  return `${ordinal(rank)} of ${String(teamCount)}`;
}

export function recordLabel(
  record:
    | {
        readonly wins: number;
        readonly losses: number;
        readonly ties: number;
        readonly percentage: number | null;
      }
    | undefined,
): string | undefined {
  if (record === undefined) {
    return undefined;
  }
  const totals = `${String(record.wins)}-${String(record.losses)}-${String(record.ties)}`;
  return record.percentage === null
    ? totals
    : `${totals} (${EffectString.replace(record.percentage.toFixed(3), /^0/u, "")})`;
}

const categoryDecimals = new Map<string, number>([
  ["save percentage", 3],
  ["save pct", 3],
  ["save %", 3],
  ["goals against average", 2],
  ["goals against avg", 2],
  ["gaa", 2],
]);

export function categoryStat(name: string, value: number): string {
  const digits = categoryDecimals.get(normalizeCategoryName(name));
  return digits === undefined ? number(value) : fixedNumber(value, digits);
}

export function matchupNumber(value: number): string {
  return fixedNumber(value, 2);
}

export function periodLabel(
  currentPeriod: number | undefined,
  lastPeriod: number | undefined,
  seasonOver: boolean | undefined,
  usesPlayoffs: boolean | undefined,
  playoffStartWeek: number | undefined,
): string | undefined {
  const parts = periodParts(currentPeriod, lastPeriod, seasonOver, usesPlayoffs, playoffStartWeek);
  if (parts === undefined) {
    return undefined;
  }
  return EffectArray.join([parts.headline, ...parts.details], " · ");
}

export function periodParts(
  currentPeriod: number | undefined,
  lastPeriod: number | undefined,
  seasonOver: boolean | undefined,
  usesPlayoffs: boolean | undefined,
  playoffStartWeek: number | undefined,
): PeriodParts | undefined {
  if (currentPeriod === undefined || seasonOver === true) {
    return undefined;
  }
  if (lastPeriod === undefined) {
    return { headline: `Week ${String(currentPeriod)}`, details: [] };
  }
  if (currentPeriod > lastPeriod) {
    return undefined;
  }
  if (
    usesPlayoffs !== true ||
    playoffStartWeek === undefined ||
    playoffStartWeek <= 1 ||
    playoffStartWeek > lastPeriod
  ) {
    return { headline: `Week ${String(currentPeriod)} of ${String(lastPeriod)}`, details: [] };
  }
  const regularLastPeriod = playoffStartWeek - 1;
  const playoffWeeks = lastPeriod - regularLastPeriod;
  if (currentPeriod > regularLastPeriod) {
    return {
      headline: `Playoffs · Week ${String(currentPeriod - regularLastPeriod)} of ${String(playoffWeeks)}`,
      details: [],
    };
  }
  const regularWeeksLeft = regularLastPeriod - currentPeriod;
  return {
    headline: `Week ${String(currentPeriod)} of ${String(regularLastPeriod)} regular`,
    details: [
      ...(regularWeeksLeft === 0
        ? []
        : [
            `${String(regularWeeksLeft)} regular ${regularWeeksLeft === 1 ? "week" : "weeks"} left`,
          ]),
      `${String(playoffWeeks)} ${playoffWeeks === 1 ? "playoff week" : "playoff weeks"}`,
    ],
  };
}

export function number(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function fixedNumber(value: number, fractionDigits: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function normalizeCategoryName(name: string): string {
  return EffectString.replace(
    EffectString.toLowerCase(EffectString.trim(name)),
    /[^a-z0-9%]+/gu,
    " ",
  );
}

export function ordinal(rank: number): string {
  const suffix =
    rank % 100 >= 11 && rank % 100 <= 13
      ? "th"
      : rank % 10 === 1
        ? "st"
        : rank % 10 === 2
          ? "nd"
          : rank % 10 === 3
            ? "rd"
            : "th";
  return `${String(rank)}${suffix}`;
}

export type PeriodParts = {
  readonly headline: string;
  readonly details: ReadonlyArray<string>;
};
