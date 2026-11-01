import { DateTime, Effect, Schema } from "effect";

import type { FantasySport, TeamId } from "#contexts/connections/FantasyTeam.ts";
import {
  ProviderReadFailureSchema,
  ProviderResponseInvalid,
} from "#contexts/connections/Provider.ts";
import type {
  ProviderFantasyDay,
  ProviderReadFailure,
  ProviderRosterSchedule,
  ProviderSchedulePeriod,
  ProviderSchedulePlayer,
  ProviderSessionMaterial,
  ProviderShape,
} from "#contexts/connections/Provider.ts";
import type { QueryPersistenceFailed } from "#contexts/connections/QueryValues.ts";

import type {
  ObservedFactRepository,
  ProviderOpponentObservation,
  ProviderOpponentObservationWrite,
  TeamIdentity,
} from "./ObservedFactRepository.ts";
import type { FactWindow, ProviderOpponentValue } from "./ObservedFacts.ts";
import { factRefreshPolicies } from "./ObservedFacts.ts";

export type ProviderOpponentRead = {
  readonly schedule: ProviderRosterSchedule;
  readonly observedAt: DateTime.Utc;
};

export class ProviderOpponentFactStale extends Schema.TaggedError<
  ProviderOpponentFactStale,
  { readonly brand: unique symbol }
>()("provider_opponent.fact_stale", {
  dates: Schema.Array(Schema.NonEmptyString),
  previousObservedAt: Schema.optional(Schema.DateTimeUtc),
  cause: ProviderReadFailureSchema,
}) {}

export function readProviderOpponent(input: {
  readonly facts: ObservedFactRepository["Service"];
  readonly provider: ProviderShape;
  readonly material: ProviderSessionMaterial;
  readonly teamId: TeamId;
  readonly sport: FantasySport;
  readonly providerTeamKey: string;
  readonly period: ProviderSchedulePeriod;
  readonly notBefore?: DateTime.Utc;
}): Effect.Effect<
  ProviderOpponentRead,
  ProviderReadFailure | ProviderOpponentFactStale | QueryPersistenceFailed
> {
  const fantasyDay = input.provider.capabilities.fantasyDay;
  const read = Effect.fn("ProviderOpponentFacts.read")(function* () {
    if (input.period.type === "week") {
      const schedule = yield* input.provider.readRosterSchedule({
        ...input.material,
        providerTeamKey: input.providerTeamKey,
        period: input.period,
      });
      const observedAt = yield* DateTime.now;
      yield* input.facts.recordTeamIdentities(observedTeamIdentities(input, schedule, observedAt));
      return { schedule, observedAt };
    }

    const dates = datesBetween(input.period.start, input.period.end);
    const now = yield* DateTime.now;
    const stored = yield* input.facts.readProviderOpponents({
      subjectKey: input.teamId,
      from: input.period.start,
      to: input.period.end,
    });
    const latestByDate = latestObservationByDate(stored);
    const served = new Map<string, ProviderOpponentObservation>();
    const staleDates: Array<string> = [];
    for (const date of dates) {
      const observation = latestByDate.get(date);
      if (observation !== undefined && isFresh(observation, now, fantasyDay, input.notBefore)) {
        served.set(date, observation);
      } else {
        staleDates.push(date);
      }
    }

    const ranges = contiguousRanges(staleDates);
    yield* Effect.annotateCurrentSpan({
      "fact.kind": "provider_opponent",
      "fact.dates_fresh": served.size,
      "fact.dates_stale": staleDates.length,
      "fact.read_ranges": ranges.length,
    });

    const observed: Array<ProviderOpponentObservationWrite> = [];
    for (const range of ranges) {
      const read = yield* readRange({
        provider: input.provider,
        material: input.material,
        providerTeamKey: input.providerTeamKey,
        range,
        previousObservedAt: oldestObservedAt(range, latestByDate),
      });
      yield* input.facts.recordTeamIdentities(
        observedTeamIdentities(input, read.schedule, read.observedAt),
      );
      for (const observation of observationsFor(
        read.schedule,
        range,
        input.providerTeamKey,
        read.observedAt,
      )) {
        observed.push(observation);
      }
    }
    yield* input.facts.recordProviderOpponents({
      subjectKey: input.teamId,
      source: input.material.provider,
      confidence: "authoritative",
      observations: observed,
    });

    const all = new Map(served);
    for (const observation of observed) {
      all.set(observation.window.from, {
        ...observation,
        subjectKey: input.teamId,
        source: input.material.provider,
      });
    }
    return {
      schedule: rebuildSchedule({
        providerTeamKey: input.providerTeamKey,
        period: input.period,
        dates,
        observations: all,
      }),
      observedAt: oldestObservationInstant(dates, all),
    };
  });
  return read();
}

function observedTeamIdentities(
  input: {
    readonly material: ProviderSessionMaterial;
    readonly sport: FantasySport;
  },
  schedule: ProviderRosterSchedule,
  observedAt: DateTime.Utc,
): ReadonlyArray<TeamIdentity> {
  const pairs = new Map<string, { readonly abbreviation: string; readonly key: string }>();
  for (const player of schedule.players) {
    if (player.proTeamKey === undefined || player.proTeamAbbreviation === undefined) {
      continue;
    }
    pairs.set(player.proTeamKey, {
      abbreviation: player.proTeamAbbreviation,
      key: player.proTeamKey,
    });
  }
  return [...pairs.values()].map((pair) => ({
    sport: input.sport,
    source: input.material.provider,
    sourceTeamIdentifier: pair.abbreviation,
    provider: input.material.provider,
    providerTeamKey: pair.key,
    observedAt,
  }));
}

function isFresh(
  observation: ProviderOpponentObservation,
  now: DateTime.Utc,
  fantasyDay: ProviderFantasyDay,
  notBefore: DateTime.Utc | undefined,
): boolean {
  const policy = factRefreshPolicies.provider_opponent;
  return (
    (notBefore === undefined ||
      DateTime.toEpochMillis(observation.observedAt) >= DateTime.toEpochMillis(notBefore)) &&
    !policy.reReadWhen(observation.window, now, fantasyDay) &&
    DateTime.toEpochMillis(now) <
      DateTime.toEpochMillis(policy.maximumAgeEndsAt(observation.window, fantasyDay))
  );
}

function readRange(input: {
  readonly provider: ProviderShape;
  readonly material: ProviderSessionMaterial;
  readonly providerTeamKey: string;
  readonly range: FactWindow;
  readonly previousObservedAt: DateTime.Utc | undefined;
}): Effect.Effect<
  { readonly schedule: ProviderRosterSchedule; readonly observedAt: DateTime.Utc },
  ProviderReadFailure | ProviderOpponentFactStale
> {
  return Effect.gen(function* () {
    const schedule = yield* input.provider
      .readRosterSchedule({
        ...input.material,
        providerTeamKey: input.providerTeamKey,
        period: { type: "date", start: input.range.from, end: input.range.to },
      })
      .pipe(
        Effect.mapError((cause) =>
          input.previousObservedAt === undefined
            ? cause
            : ProviderOpponentFactStale.make({
                dates: datesBetween(input.range.from, input.range.to),
                previousObservedAt: input.previousObservedAt,
                cause,
              }),
        ),
      );
    yield* assertCoversRange(schedule, input.range);
    return { schedule, observedAt: yield* DateTime.now };
  });
}

function assertCoversRange(
  schedule: ProviderRosterSchedule,
  range: FactWindow,
): Effect.Effect<void, ProviderResponseInvalid> {
  const expected = new Set(datesBetween(range.from, range.to));
  for (const date of expected) {
    if (!schedule.dates.includes(date)) {
      return ProviderResponseInvalid.make({
        operation: "read_roster_schedule",
        field: "dates",
      });
    }
  }
  for (const player of schedule.players) {
    for (const game of player.games) {
      if (game.date === undefined || !expected.has(game.date)) {
        return ProviderResponseInvalid.make({
          operation: "read_roster_schedule",
          field: "players.games.date",
        });
      }
    }
  }
  return Effect.void;
}

function observationsFor(
  schedule: ProviderRosterSchedule,
  range: FactWindow,
  providerTeamKey: string,
  observedAt: DateTime.Utc,
): ReadonlyArray<ProviderOpponentObservationWrite> {
  return datesBetween(range.from, range.to).map((date) => ({
    window: { from: date, to: date },
    value: valueForDate(schedule, date),
    observedAt,
    sourceReference: `${providerTeamKey}@${date}`,
  }));
}

function valueForDate(schedule: ProviderRosterSchedule, date: string): ProviderOpponentValue {
  return {
    players: schedule.players.map((player) => ({
      providerPlayerKey: player.providerPlayerKey,
      name: player.name,
      proTeamKey: player.proTeamKey ?? null,
      proTeamAbbreviation: player.proTeamAbbreviation ?? null,
      games: player.games
        .filter((game) => game.date === date)
        .map((game) => ({ opponent: game.opponent, home: game.home })),
    })),
  };
}

function rebuildSchedule(input: {
  readonly providerTeamKey: string;
  readonly period: ProviderSchedulePeriod;
  readonly dates: ReadonlyArray<string>;
  readonly observations: ReadonlyMap<string, ProviderOpponentObservation>;
}): ProviderRosterSchedule {
  const players = new Map<string, ProviderSchedulePlayer>();
  for (const date of input.dates) {
    const observation = input.observations.get(date);
    if (observation === undefined) {
      throw new Error("Every served schedule date must have an observation");
    }
    for (const player of observation.value.players) {
      const games = player.games.map((game) => ({
        date,
        opponent: game.opponent,
        home: game.home,
      }));
      const existing = players.get(player.providerPlayerKey);
      players.set(
        player.providerPlayerKey,
        existing === undefined
          ? {
              providerPlayerKey: player.providerPlayerKey,
              name: player.name,
              proTeamKey: player.proTeamKey ?? undefined,
              proTeamAbbreviation: player.proTeamAbbreviation ?? undefined,
              games,
            }
          : { ...existing, games: [...existing.games, ...games] },
      );
    }
  }
  return {
    providerTeamKey: input.providerTeamKey,
    period: input.period,
    dates: input.dates,
    players: [...players.values()],
  };
}

function latestObservationByDate(
  observations: ReadonlyArray<ProviderOpponentObservation>,
): ReadonlyMap<string, ProviderOpponentObservation> {
  const latest = new Map<string, ProviderOpponentObservation>();
  for (const observation of observations) {
    if (!latest.has(observation.window.from)) {
      latest.set(observation.window.from, observation);
    }
  }
  return latest;
}

function oldestObservedAt(
  range: FactWindow,
  observations: ReadonlyMap<string, ProviderOpponentObservation>,
): DateTime.Utc | undefined {
  let oldest: DateTime.Utc | undefined;
  for (const date of datesBetween(range.from, range.to)) {
    const observation = observations.get(date);
    if (
      observation !== undefined &&
      (oldest === undefined ||
        DateTime.toEpochMillis(observation.observedAt) < DateTime.toEpochMillis(oldest))
    ) {
      oldest = observation.observedAt;
    }
  }
  return oldest;
}

function oldestObservationInstant(
  dates: ReadonlyArray<string>,
  observations: ReadonlyMap<string, ProviderOpponentObservation>,
): DateTime.Utc {
  let oldest: DateTime.Utc | undefined;
  for (const date of dates) {
    const observation = observations.get(date);
    if (observation === undefined) {
      throw new Error("Every served schedule date must have an observation");
    }
    if (
      oldest === undefined ||
      DateTime.toEpochMillis(observation.observedAt) < DateTime.toEpochMillis(oldest)
    ) {
      oldest = observation.observedAt;
    }
  }
  if (oldest === undefined) {
    throw new Error("A schedule answer must cover at least one date");
  }
  return oldest;
}

function contiguousRanges(dates: ReadonlyArray<string>): ReadonlyArray<FactWindow> {
  const ranges: Array<FactWindow> = [];
  for (const date of dates) {
    const current = ranges.at(-1);
    if (current !== undefined && nextDate(current.to) === date) {
      ranges[ranges.length - 1] = { from: current.from, to: date };
    } else {
      ranges.push({ from: date, to: date });
    }
  }
  return ranges;
}

function nextDate(date: string): string {
  const parsed = DateTime.makeUnsafe(`${date}T00:00:00.000Z`);
  return DateTime.formatIsoDate(DateTime.add(parsed, { days: 1 }));
}

function datesBetween(start: string, end: string): ReadonlyArray<string> {
  const first = DateTime.makeUnsafe(`${start}T00:00:00.000Z`);
  const last = DateTime.makeUnsafe(`${end}T00:00:00.000Z`);
  const span = Math.floor(
    (DateTime.toEpochMillis(last) - DateTime.toEpochMillis(first)) / 86_400_000,
  );
  return globalThis.Array.from({ length: span + 1 }, (_, index) =>
    DateTime.formatIsoDate(DateTime.add(first, { days: index })),
  );
}
