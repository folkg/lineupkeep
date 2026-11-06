import { DateTime, Schema } from "effect";

import type {
  ProviderPlayerStatGroup,
  ProviderRosterPlayer,
  ProviderRosterPosition,
} from "./Provider.ts";

export const recentActivityDays = 14;

export const ReserveActivityWindow = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("date_range"),
    start: Schema.NonEmptyString,
    end: Schema.NonEmptyString,
    days: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  }),
  Schema.Struct({
    kind: Schema.Literal("week"),
    week: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  }),
]).pipe(
  Schema.annotate({
    description:
      "The provider statistics that show a player has played: either the exact inclusive dates the statistics cover, or the scoring week they cover. The values are the provider's own window and are never inferred from the player's current slot.",
  }),
);
export type ReserveActivityWindow = typeof ReserveActivityWindow.Type;

export const ReserveSlotSuspect = Schema.Struct({
  code: Schema.Literal("reserve_slot_suspect"),
  slot: Schema.NonEmptyString.pipe(
    Schema.annotate({
      description:
        "The league's own name for the reserve slot this player occupies. It is the declared position, never a hardcoded slot name.",
    }),
  ),
  activity: ReserveActivityWindow,
  detail: Schema.NonEmptyString.pipe(
    Schema.annotate({
      description:
        "One plain sentence naming the player, the evidence, the provider's missing injury report, and what may happen next. It is a suspicion from evidence, never a claim that the provider is wrong.",
    }),
  ),
}).pipe(
  Schema.annotate({
    description:
      "A player the league declares in a reserve slot while the provider reports no injury and its published statistics show recent play. This is information: the player is still placeable, and the suspicion may explain a transaction the provider refuses. It never changes a lineup plan.",
  }),
);
export type ReserveSlotSuspect = typeof ReserveSlotSuspect.Type;

export function reserveActivityOf(
  statistics: ProviderPlayerStatGroup | undefined,
): ReserveActivityWindow | undefined {
  if (statistics === undefined) {
    return undefined;
  }
  if (!publishedPositiveValue(statistics)) {
    return undefined;
  }
  switch (statistics.basis.type) {
    case "date_range":
      return {
        kind: "date_range",
        start: statistics.basis.start,
        end: statistics.basis.end,
        days: statistics.basis.days,
      };
    case "week":
      return { kind: "week", week: statistics.basis.week };
    case "season":
      return undefined;
  }
}

export function reserveSlotCandidates(input: {
  readonly positions: ReadonlyArray<ProviderRosterPosition>;
  readonly players: ReadonlyArray<ProviderRosterPlayer>;
}): ReadonlyArray<ProviderRosterPlayer> {
  return reserveSlotOccupants(input).map((occupant) => occupant.player);
}

export function reserveSlotSuspects(input: {
  readonly positions: ReadonlyArray<ProviderRosterPosition>;
  readonly players: ReadonlyArray<ProviderRosterPlayer>;
  readonly activity: ReadonlyMap<string, ReserveActivityWindow>;
  readonly currentWeek: number | undefined;
  readonly now: DateTime.Utc;
}): ReadonlyArray<ReserveSlotSuspectFinding> {
  const cutoff = DateTime.formatIsoDate(DateTime.subtract(input.now, { days: recentActivityDays }));
  return reserveSlotOccupants(input).flatMap(({ player, slot }) => {
    const activity = input.activity.get(player.providerPlayerKey);
    if (activity === undefined || !recent(activity, cutoff, input.currentWeek)) {
      return [];
    }
    return [
      {
        player,
        suspect: {
          code: "reserve_slot_suspect",
          slot,
          activity,
          detail: suspectDetail(player.name, activity),
        },
      },
    ];
  });
}

function reserveSlotOccupants(input: {
  readonly positions: ReadonlyArray<ProviderRosterPosition>;
  readonly players: ReadonlyArray<ProviderRosterPlayer>;
}): ReadonlyArray<{ readonly player: ProviderRosterPlayer; readonly slot: string }> {
  const reserveNames = reserveSlotNames(input.positions);
  return input.players.flatMap((player) =>
    player.slot.status === "verified" &&
    reserveNames.has(player.slot.slot) &&
    providerReportsNoInjury(player)
      ? [{ player, slot: player.slot.slot }]
      : [],
  );
}

function reserveSlotNames(positions: ReadonlyArray<ProviderRosterPosition>): ReadonlySet<string> {
  return new Set(
    positions
      .filter((position) => position.kind === "reserve")
      .map((position) => position.position),
  );
}

function providerReportsNoInjury(player: ProviderRosterPlayer): boolean {
  return (
    player.injuryCode === undefined &&
    player.injuryDetail === undefined &&
    (player.status === undefined || player.status === "healthy")
  );
}

function publishedPositiveValue(statistics: ProviderPlayerStatGroup): boolean {
  return statistics.stats.some((stat) => stat.value !== null && stat.value > 0);
}

function recent(
  activity: ReserveActivityWindow,
  cutoff: string,
  currentWeek: number | undefined,
): boolean {
  switch (activity.kind) {
    case "date_range":
      return (
        activity.days <= recentActivityDays && activity.start >= cutoff && activity.end >= cutoff
      );
    case "week":
      return currentWeek !== undefined && activity.week === currentWeek - 1;
  }
}

function suspectDetail(name: string, activity: ReserveActivityWindow): string {
  return `${name} is in a reserve slot but has played ${playedWindow(activity)}, and the provider reports no injury. The roster may be refused until they are moved or dropped.`;
}

function playedWindow(activity: ReserveActivityWindow): string {
  return activity.kind === "date_range"
    ? `in the last ${String(recentActivityDays)} days`
    : "in the most recently completed week";
}

export type ReserveSlotSuspectFinding = {
  readonly player: ProviderRosterPlayer;
  readonly suspect: ReserveSlotSuspect;
};
