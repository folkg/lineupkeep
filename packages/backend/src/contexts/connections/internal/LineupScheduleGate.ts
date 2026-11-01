import { DateTime, Effect } from "effect";
import type { Redacted } from "effect";

import {
  currentFantasyDayStart,
  fantasyDayLabel,
  nextFantasyDayBoundary,
} from "#contexts/connections/FantasyDay.ts";
import type { FantasyTeam } from "#contexts/connections/FantasyTeam.ts";
import type { ProfessionalCalendar } from "#contexts/connections/ProfessionalCalendar.ts";
import type { ProviderSessionMaterial, ProviderShape } from "#contexts/connections/Provider.ts";
import type {
  ScheduleGateDecision,
  ScheduleGateRunReason,
} from "#contexts/connections/ScheduleGate.ts";

import type { ObservedFactRepository } from "./ObservedFactRepository.ts";
import { readProviderOpponent } from "./ProviderOpponentFacts.ts";
import { decideScheduleGate, nextLineupTick } from "./ScheduleGateDecision.ts";

export function evaluateScheduleGate(input: {
  readonly facts: ObservedFactRepository["Service"];
  readonly calendar: ProfessionalCalendar["Service"];
  readonly team: FantasyTeam;
  readonly provider: ProviderShape;
  readonly session: Redacted.Redacted<string>;
  readonly now: DateTime.Utc;
  readonly hasGameSource: boolean;
}): Effect.Effect<ScheduleGateDecision, never> {
  return evaluate(input).pipe(
    Effect.catch((reason) => Effect.succeed(run(reason))),
    Effect.catchDefect(() => Effect.succeed(run("unexpected_error"))),
  );
}

function evaluate(input: {
  readonly facts: ObservedFactRepository["Service"];
  readonly calendar: ProfessionalCalendar["Service"];
  readonly team: FantasyTeam;
  readonly provider: ProviderShape;
  readonly session: Redacted.Redacted<string>;
  readonly now: DateTime.Utc;
  readonly hasGameSource: boolean;
}): Effect.Effect<ScheduleGateDecision, ScheduleGateRunReason> {
  return Effect.gen(function* () {
    if (!input.hasGameSource) {
      return yield* Effect.fail("no_game_source" as const);
    }
    const fantasyDay = input.provider.capabilities.fantasyDay;
    const dayStartedAt = currentFantasyDayStart(input.now, fantasyDay);
    const dayEndsAt = nextFantasyDayBoundary(input.now, fantasyDay);
    const today = fantasyDayLabel(input.now, fantasyDay);
    const nextTickAt = nextLineupTick(input.now);

    const providerRead = yield* Effect.result(
      readProviderOpponent({
        facts: input.facts,
        provider: input.provider,
        material: providerMaterial(input),
        teamId: input.team.id,
        sport: input.team.sport,
        providerTeamKey: input.team.providerTeamKey,
        period: { type: "date", start: today, end: today },
        notBefore: dayStartedAt,
      }),
    );
    if (providerRead._tag === "Failure") {
      return yield* Effect.fail("provider_schedule_unavailable" as const);
    }
    if (
      DateTime.toEpochMillis(providerRead.success.observedAt) < DateTime.toEpochMillis(dayStartedAt)
    ) {
      return yield* Effect.fail("provider_schedule_stale" as const);
    }
    const players = providerRead.success.schedule.players;
    if (players.length === 0) {
      return yield* Effect.fail("roster_team_unmapped" as const);
    }
    const teamKeys = new Set<string>();
    const providerGameKeys = new Set<string>();
    for (const player of players) {
      const key = player.proTeamKey;
      if (key === undefined) {
        return yield* Effect.fail("roster_team_unmapped" as const);
      }
      teamKeys.add(key);
      if (player.games.length > 0) {
        providerGameKeys.add(key);
      }
    }

    const weekEnd = addDays(today, 6);
    const calendarRead = yield* Effect.result(
      input.calendar.readGames({
        league: input.team.league,
        from: today,
        to: weekEnd,
        freshness: "calendar",
        notBefore: dayStartedAt,
      }),
    );
    if (calendarRead._tag === "Failure") {
      return yield* Effect.fail(gameSourceFailureReason(calendarRead.failure));
    }
    if (
      DateTime.toEpochMillis(calendarRead.success.observedAt) < DateTime.toEpochMillis(dayStartedAt)
    ) {
      return yield* Effect.fail("game_observation_stale" as const);
    }

    return decideScheduleGate({
      now: input.now,
      dayStartedAt,
      dayEndsAt,
      today,
      nextTickAt,
      nextTickDate: DateTime.formatIsoDate(DateTime.toUtc(nextTickAt)),
      games: calendarRead.success.games.map((fact) => fact.game),
      providerGameKeys,
      teamKeys,
    });
  });
}

function run(reason: ScheduleGateRunReason): ScheduleGateDecision {
  return { kind: "run", reason };
}

function providerMaterial(input: {
  readonly team: FantasyTeam;
  readonly session: Redacted.Redacted<string>;
}): ProviderSessionMaterial {
  return { provider: input.team.provider, session: input.session };
}

function gameSourceFailureReason(failure: {
  readonly _tag: string;
  readonly reason?: string;
}): ScheduleGateRunReason {
  if (failure._tag === "professional_calendar.unavailable") {
    return failure.reason === "no_source" ? "no_game_source" : "invalid_window";
  }
  return "game_source_unavailable";
}

function addDays(date: string, days: number): string {
  const parsed = DateTime.makeUnsafe(`${date}T00:00:00.000Z`);
  return DateTime.formatIsoDate(DateTime.add(parsed, { days }));
}
