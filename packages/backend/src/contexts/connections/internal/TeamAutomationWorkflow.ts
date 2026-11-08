import { DateTime, Schema } from "effect";

import { defineMachine } from "#utilities/machine.ts";

export const TeamAutomationState = Schema.TaggedUnion({
  Disabled: {
    changedAt: Schema.DateTimeUtc,
  },
  Enabled: {
    changedAt: Schema.DateTimeUtc,
  },
  PausedUntilFantasyDayEnd: {
    changedAt: Schema.DateTimeUtc,
    pausedAt: Schema.DateTimeUtc,
    resumesAt: Schema.DateTimeUtc,
    timeZone: Schema.NonEmptyString,
    fantasyDay: Schema.NonEmptyString,
    fantasyDayVersion: Schema.NonEmptyString,
  },
});
export type TeamAutomationState = typeof TeamAutomationState.Type;
export type TeamAutomationEvent = typeof TeamAutomationEvent.Type;

export const TeamAutomationEvent = Schema.TaggedUnion({
  Enabled: { at: Schema.DateTimeUtc },
  Disabled: { at: Schema.DateTimeUtc },
  Paused: {
    at: Schema.DateTimeUtc,
    resumesAt: Schema.DateTimeUtc,
    timeZone: Schema.NonEmptyString,
    fantasyDay: Schema.NonEmptyString,
    fantasyDayVersion: Schema.NonEmptyString,
  },
  Resumed: { at: Schema.DateTimeUtc },
  PauseExpired: { at: Schema.DateTimeUtc },
});

export const TeamAutomationWorkflow = defineMachine<TeamAutomationState, TeamAutomationEvent>({
  root: {
    Disabled: TeamAutomationState.cases.Disabled,
    Enabled: TeamAutomationState.cases.Enabled,
    PausedUntilFantasyDayEnd: TeamAutomationState.cases.PausedUntilFantasyDayEnd,
  },
  events: TeamAutomationEvent,
  initial: { target: "Disabled", data: ({ input }) => input },
  states: {
    Disabled: {
      on: {
        Enabled: {
          target: "Enabled",
          data: ({ event }) => ({ changedAt: event.at }),
        },
      },
    },
    Enabled: {
      on: {
        Disabled: {
          target: "Disabled",
          data: ({ event }) => ({ changedAt: event.at }),
        },
        Paused: {
          target: "PausedUntilFantasyDayEnd",
          data: ({ event }) => ({
            changedAt: event.at,
            pausedAt: event.at,
            resumesAt: event.resumesAt,
            timeZone: event.timeZone,
            fantasyDay: event.fantasyDay,
            fantasyDayVersion: event.fantasyDayVersion,
          }),
        },
      },
    },
    PausedUntilFantasyDayEnd: {
      on: {
        Disabled: {
          target: "Disabled",
          data: ({ event }) => ({ changedAt: event.at }),
        },
        Resumed: {
          target: "Enabled",
          data: ({ event }) => ({ changedAt: event.at }),
        },
        PauseExpired: {
          guard: ({ state, event }) =>
            DateTime.toEpochMillis(event.at) >= DateTime.toEpochMillis(state.resumesAt),
          target: "Enabled",
          data: ({ event }) => ({ changedAt: event.at }),
        },
      },
    },
  },
});
