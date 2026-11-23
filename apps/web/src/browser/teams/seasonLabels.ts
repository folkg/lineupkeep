import { EffectString } from "@lineupkeep/collections";

export function formatLabel(format: string | undefined): string | undefined {
  switch (format) {
    case "head_to_head_categories":
      return "Head to head categories";
    case "head_to_head_points":
      return "Head to head points";
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

export function number(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function ordinal(rank: number): string {
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
