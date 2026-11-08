import { Schema, SchemaTransformation } from "effect";

import { TeamId } from "#contexts/connections/FantasyTeam.ts";
import {
  LineupImplementation,
  LineupLeftInPlacePlayer,
  LineupPlanProvenance,
  LineupPlanRefusalProvenance,
  LineupRunOutcome,
  LineupRunStatus,
  LineupTargetPeriod,
  LineupTrigger,
  LineupId,
} from "#contexts/connections/LineupRun.ts";
import { ProviderStartingLineup } from "#contexts/connections/Provider.ts";
import { RosterSlot } from "#contexts/connections/QueryValues.ts";
import { defineMachine, final } from "#utilities/machine.ts";

export const LineupLeaseRef = Schema.Struct({
  token: LineupId,
  generation: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
export type LineupLeaseRef = typeof LineupLeaseRef.Type;

const LineupObservedSlot = Schema.Union([RosterSlot, Schema.NonEmptyString]).pipe(
  Schema.decodeTo(
    RosterSlot,
    SchemaTransformation.transform({
      decode: (value) => (typeof value === "string" ? { status: "verified", slot: value } : value),
      encode: (value) => value,
    }),
  ),
);

export const LineupObservedPlayer = Schema.Struct({
  key: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  slot: LineupObservedSlot,
  editable: Schema.Boolean,
  scheduled: Schema.Boolean,
  startingLineup: ProviderStartingLineup,
});
export type LineupObservedPlayer = typeof LineupObservedPlayer.Type;

export const LineupObservation = Schema.Struct({
  target: LineupTargetPeriod,
  players: Schema.Array(LineupObservedPlayer),
  lockedPlayers: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  editablePlayers: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type LineupObservation = typeof LineupObservation.Type;

const LineupPlannedAssignment = Schema.Struct({
  playerKey: Schema.NonEmptyString,
  slot: Schema.NonEmptyString,
});
type LineupPlannedAssignment = typeof LineupPlannedAssignment.Type;

export const LineupPlan = Schema.TaggedUnion({
  native_action: {
    target: LineupTargetPeriod,
    connectionGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    lockedPlayers: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    editablePlayers: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    provenance: Schema.optional(LineupPlanRefusalProvenance),
  },
  explicit_assignments: {
    target: LineupTargetPeriod,
    connectionGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
    lockedPlayers: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    editablePlayers: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    provenance: LineupPlanProvenance,
    assignments: Schema.Array(LineupPlannedAssignment),
    leftInPlace: Schema.optional(Schema.Array(LineupLeftInPlacePlayer)),
    sourceChanged: Schema.Boolean,
  },
});
export type LineupPlan = typeof LineupPlan.Type;

export const LineupWriteIntentRef = Schema.Struct({
  id: LineupId,
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
export type LineupWriteIntentRef = typeof LineupWriteIntentRef.Type;

const LineupProviderResponse = Schema.Literals(["accepted", "unknown"]);
type LineupProviderResponse = typeof LineupProviderResponse.Type;

const RunContent = {
  team: TeamId,
  target: LineupTargetPeriod,
  trigger: LineupTrigger,
  implementation: LineupImplementation,
  implementationVersion: Schema.NonEmptyString,
  updatedAt: Schema.DateTimeUtc,
};

const LeaseContent = {
  lease: LineupLeaseRef,
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
};

const TerminalContent = {
  ...RunContent,
  outcome: LineupRunOutcome,
};

export const LineupRunState = Schema.TaggedUnion({
  Queued: {
    ...RunContent,
    queuedAt: Schema.DateTimeUtc,
  },
  Reading: {
    ...RunContent,
    ...LeaseContent,
    startedAt: Schema.DateTimeUtc,
  },
  Planning: {
    ...RunContent,
    ...LeaseContent,
    observation: LineupObservation,
  },
  Validating: {
    ...RunContent,
    ...LeaseContent,
    observation: LineupObservation,
    plan: LineupPlan,
  },
  Applying: {
    ...RunContent,
    ...LeaseContent,
    writeIntent: LineupWriteIntentRef,
  },
  Verifying: {
    ...RunContent,
    ...LeaseContent,
    writeIntent: LineupWriteIntentRef,
    providerResponse: LineupProviderResponse,
  },
  Completed: TerminalContent,
  Skipped: TerminalContent,
  Blocked: TerminalContent,
  RetryWait: {
    ...RunContent,
    attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    reason: Schema.NonEmptyString,
    detail: Schema.String,
    retryAt: Schema.DateTimeUtc,
    writeIntent: Schema.optional(LineupWriteIntentRef),
  },
  Failed: TerminalContent,
  Uncertain: {
    ...TerminalContent,
    writeIntent: Schema.optional(LineupWriteIntentRef),
  },
  Superseded: TerminalContent,
});
export type LineupRunState = typeof LineupRunState.Type;

const LineupRunStates = {
  Queued: LineupRunState.cases.Queued,
  Reading: LineupRunState.cases.Reading,
  Planning: LineupRunState.cases.Planning,
  Validating: LineupRunState.cases.Validating,
  Applying: LineupRunState.cases.Applying,
  Verifying: LineupRunState.cases.Verifying,
  Completed: final(LineupRunState.cases.Completed),
  Skipped: final(LineupRunState.cases.Skipped),
  Blocked: final(LineupRunState.cases.Blocked),
  RetryWait: LineupRunState.cases.RetryWait,
  Failed: final(LineupRunState.cases.Failed),
  Uncertain: LineupRunState.cases.Uncertain,
  Superseded: final(LineupRunState.cases.Superseded),
};

const LineupRunEvents = Schema.TaggedUnion({
  Claimed: { at: Schema.DateTimeUtc, ...LeaseContent },
  Reclaimed: { at: Schema.DateTimeUtc, ...LeaseContent },
  RetryClaimed: { at: Schema.DateTimeUtc, ...LeaseContent },
  VerificationClaimed: { at: Schema.DateTimeUtc, ...LeaseContent },
  ObservationRecorded: { at: Schema.DateTimeUtc, observation: LineupObservation },
  PlanPrepared: { at: Schema.DateTimeUtc, plan: LineupPlan },
  ApplyStarted: {
    at: Schema.DateTimeUtc,
    writeIntent: LineupWriteIntentRef,
  },
  ApplyResponded: {
    at: Schema.DateTimeUtc,
    providerResponse: LineupProviderResponse,
  },
  VerificationResumed: { at: Schema.DateTimeUtc, ...LeaseContent },
  ReconciliationStarted: { at: Schema.DateTimeUtc, ...LeaseContent },
  Verified: { at: Schema.DateTimeUtc, outcome: LineupRunOutcome },
  Blocked: { at: Schema.DateTimeUtc, outcome: LineupRunOutcome },
  Skipped: { at: Schema.DateTimeUtc, outcome: LineupRunOutcome },
  Failed: { at: Schema.DateTimeUtc, outcome: LineupRunOutcome },
  Superseded: { at: Schema.DateTimeUtc, outcome: LineupRunOutcome },
  Uncertain: {
    at: Schema.DateTimeUtc,
    outcome: LineupRunOutcome,
    writeIntent: Schema.optional(LineupWriteIntentRef),
  },
  RetryScheduled: {
    at: Schema.DateTimeUtc,
    attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    reason: Schema.NonEmptyString,
    detail: Schema.String,
    retryAt: Schema.DateTimeUtc,
    writeIntent: Schema.optional(LineupWriteIntentRef),
  },
});
export type LineupRunEvent = typeof LineupRunEvents.Type;

const retryWait = {
  target: "RetryWait" as const,
  data: ({
    state,
    event,
  }: {
    readonly state: RunState;
    readonly event: Extract<LineupRunEvent, { readonly _tag: "RetryScheduled" }>;
  }): StateData<typeof LineupRunState.cases.RetryWait.Type> => ({
    ...content(state),
    attempt: event.attempt,
    reason: event.reason,
    detail: event.detail,
    retryAt: event.retryAt,
    ...(event.writeIntent === undefined ? {} : { writeIntent: event.writeIntent }),
    updatedAt: event.at,
  }),
};

export const LineupRunWorkflow = defineMachine<LineupRunState, LineupRunEvent>({
  root: LineupRunStates,
  events: LineupRunEvents,
  initial: { target: "Queued", data: ({ input }) => input },
  states: {
    Queued: {
      on: {
        Claimed: {
          target: "Reading",
          data: ({ state, event }) => ({
            ...content(state),
            lease: event.lease,
            attempt: event.attempt,
            startedAt: event.at,
            updatedAt: event.at,
          }),
        },
        Skipped: terminal("Skipped"),
        Superseded: terminal("Superseded"),
      },
    },
    Reading: {
      on: {
        ObservationRecorded: {
          target: "Planning",
          data: ({ state, event }) => ({
            ...content(state),
            lease: state.lease,
            attempt: state.attempt,
            observation: event.observation,
            updatedAt: event.at,
          }),
        },
        Reclaimed: {
          target: "Reading",
          data: ({ state, event }) => ({
            ...content(state),
            lease: event.lease,
            attempt: event.attempt,
            startedAt: event.at,
            updatedAt: event.at,
          }),
        },
        RetryScheduled: retryWait,
        Skipped: terminal("Skipped"),
        Blocked: terminal("Blocked"),
        Failed: terminal("Failed"),
      },
    },
    Planning: {
      on: {
        PlanPrepared: {
          target: "Validating",
          data: ({ state, event }) => ({
            ...content(state),
            lease: state.lease,
            attempt: state.attempt,
            observation: state.observation,
            plan: event.plan,
            updatedAt: event.at,
          }),
        },
        Reclaimed: {
          target: "Reading",
          data: ({ state, event }) => ({
            ...content(state),
            lease: event.lease,
            attempt: event.attempt,
            startedAt: event.at,
            updatedAt: event.at,
          }),
        },
        RetryScheduled: retryWait,
        Blocked: terminal("Blocked"),
        Failed: terminal("Failed"),
      },
    },
    Validating: {
      on: {
        ApplyStarted: {
          target: "Applying",
          data: ({ state, event }) => ({
            ...content(state),
            lease: state.lease,
            attempt: state.attempt,
            writeIntent: event.writeIntent,
            updatedAt: event.at,
          }),
        },
        Reclaimed: {
          target: "Reading",
          data: ({ state, event }) => ({
            ...content(state),
            lease: event.lease,
            attempt: event.attempt,
            startedAt: event.at,
            updatedAt: event.at,
          }),
        },
        RetryScheduled: retryWait,
        Blocked: terminal("Blocked"),
        Failed: terminal("Failed"),
      },
    },
    Applying: {
      on: {
        ApplyResponded: {
          target: "Verifying",
          data: ({ state, event }) => ({
            ...content(state),
            lease: state.lease,
            attempt: state.attempt,
            writeIntent: state.writeIntent,
            providerResponse: event.providerResponse,
            updatedAt: event.at,
          }),
        },
        Verified: {
          target: "Completed",
          data: ({ state, event }) => ({
            ...content(state),
            outcome: event.outcome,
            updatedAt: event.at,
          }),
        },
        VerificationResumed: {
          target: "Verifying",
          data: ({ state, event }) => ({
            ...content(state),
            lease: event.lease,
            attempt: event.attempt,
            writeIntent: state.writeIntent,
            providerResponse: "unknown",
            updatedAt: event.at,
          }),
        },
        RetryScheduled: retryWait,
        Failed: terminal("Failed"),
      },
    },
    Verifying: {
      on: {
        Verified: {
          target: "Completed",
          data: ({ state, event }) => ({
            ...content(state),
            outcome: event.outcome,
            updatedAt: event.at,
          }),
        },
        Uncertain: {
          target: "Uncertain",
          data: ({ state, event }) => ({
            ...content(state),
            outcome: event.outcome,
            writeIntent: state.writeIntent,
            updatedAt: event.at,
          }),
        },
        VerificationResumed: {
          target: "Verifying",
          data: ({ state, event }) => ({
            ...content(state),
            lease: event.lease,
            attempt: event.attempt,
            writeIntent: state.writeIntent,
            providerResponse: state.providerResponse,
            updatedAt: event.at,
          }),
        },
        RetryScheduled: retryWait,
        Failed: terminal("Failed"),
      },
    },
    RetryWait: {
      on: {
        RetryClaimed: {
          target: "Reading",
          data: ({ state, event }) => ({
            ...content(state),
            lease: event.lease,
            attempt: event.attempt,
            startedAt: event.at,
            updatedAt: event.at,
          }),
        },
        VerificationClaimed: {
          guard: ({ state }) => state.writeIntent !== undefined,
          target: "Verifying",
          data: ({ state, event }) => ({
            ...content(state),
            lease: event.lease,
            attempt: event.attempt,
            writeIntent: retryWriteIntent(state),
            providerResponse: "unknown",
            updatedAt: event.at,
          }),
        },
        Skipped: terminal("Skipped"),
        Superseded: terminal("Superseded"),
        Blocked: terminal("Blocked"),
      },
    },
    Uncertain: {
      on: {
        ReconciliationStarted: {
          guard: ({ state }) => state.writeIntent !== undefined,
          target: "Verifying",
          data: ({ state, event }) => ({
            ...content(state),
            lease: event.lease,
            attempt: event.attempt,
            writeIntent: uncertainWriteIntent(state),
            providerResponse: "unknown",
            updatedAt: event.at,
          }),
        },
        Superseded: terminal("Superseded"),
      },
    },
    Completed: {},
    Skipped: {},
    Blocked: {},
    Failed: {},
    Superseded: {},
  },
});

export function lineupRunStatus(state: LineupRunState): LineupRunStatus {
  switch (state._tag) {
    case "Queued":
      return "queued";
    case "Reading":
      return "reading";
    case "Planning":
      return "planning";
    case "Validating":
      return "validating";
    case "Applying":
      return "applying";
    case "Verifying":
      return "verifying";
    case "Completed":
      return "completed";
    case "Skipped":
      return "skipped";
    case "Blocked":
      return "blocked";
    case "RetryWait":
      return "retry-wait";
    case "Failed":
      return "failed";
    case "Uncertain":
      return "uncertain";
    case "Superseded":
      return "superseded";
  }
}

function content(state: {
  readonly team: TeamId;
  readonly target: LineupTargetPeriod;
  readonly trigger: LineupTrigger;
  readonly implementation: LineupImplementation;
  readonly implementationVersion: string;
}): {
  readonly team: TeamId;
  readonly target: LineupTargetPeriod;
  readonly trigger: LineupTrigger;
  readonly implementation: LineupImplementation;
  readonly implementationVersion: string;
} {
  return {
    team: state.team,
    target: state.target,
    trigger: state.trigger,
    implementation: state.implementation,
    implementationVersion: state.implementationVersion,
  };
}

function terminal<Target extends TerminalTarget>(
  target: Target,
): {
  readonly target: Target;
  readonly data: (input: {
    readonly state: RunState;
    readonly event: TerminalEvent;
  }) => StateData<typeof LineupRunState.cases.Completed.Type>;
} {
  return {
    target,
    data: ({ state, event }) => ({
      ...content(state),
      outcome: event.outcome,
      updatedAt: event.at,
    }),
  };
}

function retryWriteIntent(
  state: Extract<LineupRunState, { readonly _tag: "RetryWait" }>,
): LineupWriteIntentRef {
  if (state.writeIntent === undefined) {
    throw new Error("Verification cannot resume without a write intent");
  }
  return state.writeIntent;
}

function uncertainWriteIntent(
  state: Extract<LineupRunState, { readonly _tag: "Uncertain" }>,
): LineupWriteIntentRef {
  if (state.writeIntent === undefined) {
    throw new Error("Uncertain reconciliation requires a write intent");
  }
  return state.writeIntent;
}

type TerminalTarget = "Completed" | "Skipped" | "Blocked" | "Failed" | "Superseded";
type StateData<State> = Omit<State, "_tag">;

type RunState = {
  readonly team: TeamId;
  readonly target: LineupTargetPeriod;
  readonly trigger: LineupTrigger;
  readonly implementation: LineupImplementation;
  readonly implementationVersion: string;
};
type TerminalEvent = Extract<
  LineupRunEvent,
  {
    readonly _tag: "Blocked" | "Skipped" | "Failed" | "Superseded";
  }
>;
