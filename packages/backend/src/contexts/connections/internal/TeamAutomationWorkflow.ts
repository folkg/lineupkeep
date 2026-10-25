import { Machine } from "@typeonce/effect-machine";
import { DateTime, Schema } from "effect";

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
    policyVersion: Schema.NonEmptyString,
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
    policyVersion: Schema.NonEmptyString,
  },
  PauseExpired: { at: Schema.DateTimeUtc },
});

export const TeamAutomationWorkflow = Machine.make({
  root: Machine.state({
    states: {
      Disabled: TeamAutomationState.cases.Disabled,
      Enabled: TeamAutomationState.cases.Enabled,
      PausedUntilFantasyDayEnd: TeamAutomationState.cases.PausedUntilFantasyDayEnd,
    },
  }),
  input: TeamAutomationState.cases.Disabled,
  events: Machine.eventsFromSchemas(TeamAutomationEvent),
}).handle({
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
            policyVersion: event.policyVersion,
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
