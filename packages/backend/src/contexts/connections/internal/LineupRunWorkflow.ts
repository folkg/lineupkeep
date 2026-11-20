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

export const LineupWriteIntentStatus = Schema.Literals([
  "intended",
  "accepted",
  "unknown",
  "rejected",
  "not_sent",
  "verified_changed",
  "verified_no_op",
  "verified_mismatch",
]);
export type LineupWriteIntentStatus = typeof LineupWriteIntentStatus.Type;

export const LineupWriteIntentRef = Schema.Struct({
  id: LineupId,
  attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  status: LineupWriteIntentStatus,
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

const ActiveWriteIntent = Schema.Struct({
  ...LineupWriteIntentRef.fields,
  status: Schema.Literals(["intended", "accepted", "unknown"]),
});
const RetryWriteIntent = Schema.Struct({
  ...LineupWriteIntentRef.fields,
  status: Schema.Literals(["not_sent", "unknown"]),
});
const CompletedWriteIntent = Schema.Struct({
  ...LineupWriteIntentRef.fields,
  status: Schema.Literals(["verified_changed", "verified_no_op"]),
});
const FailedWriteIntent = Schema.Struct({
  ...LineupWriteIntentRef.fields,
  status: Schema.Literals(["rejected", "verified_mismatch"]),
});
const PriorWriteIntent = Schema.Struct({
  ...LineupWriteIntentRef.fields,
  status: Schema.Literals(["intended", "accepted", "unknown", "not_sent"]),
});

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
    writeIntent: Schema.Struct({
      ...LineupWriteIntentRef.fields,
      status: Schema.Literal("intended"),
    }),
  },
  Verifying: {
    ...RunContent,
    ...LeaseContent,
    writeIntent: Schema.Struct({
      ...LineupWriteIntentRef.fields,
      status: LineupProviderResponse,
    }),
    providerResponse: LineupProviderResponse,
  },
  Completed: { ...TerminalContent, writeIntent: Schema.optional(CompletedWriteIntent) },
  Skipped: { ...TerminalContent, writeIntent: Schema.optional(PriorWriteIntent) },
  Blocked: { ...TerminalContent, writeIntent: Schema.optional(PriorWriteIntent) },
  RetryWait: {
    ...RunContent,
    attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    reason: Schema.NonEmptyString,
    detail: Schema.String,
    retryAt: Schema.DateTimeUtc,
    writeIntent: Schema.optional(RetryWriteIntent),
  },
  Failed: { ...TerminalContent, writeIntent: Schema.optional(FailedWriteIntent) },
  Uncertain: {
    ...TerminalContent,
    writeIntent: Schema.optional(ActiveWriteIntent),
  },
  Superseded: { ...TerminalContent, writeIntent: Schema.optional(PriorWriteIntent) },
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
    writeIntent: Schema.Struct({
      ...LineupWriteIntentRef.fields,
      status: Schema.Literal("intended"),
    }),
  },
  ApplyResponded: {
    at: Schema.DateTimeUtc,
    providerResponse: LineupProviderResponse,
  },
  VerificationResumed: { at: Schema.DateTimeUtc, ...LeaseContent },
  ReconciliationStarted: { at: Schema.DateTimeUtc, ...LeaseContent },
  Verified: {
    at: Schema.DateTimeUtc,
    outcome: LineupRunOutcome,
    writeIntent: CompletedWriteIntent,
  },
  Blocked: { at: Schema.DateTimeUtc, outcome: LineupRunOutcome },
  Skipped: { at: Schema.DateTimeUtc, outcome: LineupRunOutcome },
  Failed: {
    at: Schema.DateTimeUtc,
    outcome: LineupRunOutcome,
    writeIntent: Schema.optional(FailedWriteIntent),
  },
  Superseded: { at: Schema.DateTimeUtc, outcome: LineupRunOutcome },
  Uncertain: {
    at: Schema.DateTimeUtc,
    outcome: LineupRunOutcome,
    writeIntent: Schema.optional(ActiveWriteIntent),
  },
  RetryScheduled: {
    at: Schema.DateTimeUtc,
    attempt: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    reason: Schema.NonEmptyString,
    detail: Schema.String,
    retryAt: Schema.DateTimeUtc,
    writeIntent: Schema.optional(RetryWriteIntent),
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
        Failed: failed(),
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
        Failed: failed(),
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
        Failed: failed(),
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
            writeIntent: { ...state.writeIntent, status: event.providerResponse },
            providerResponse: event.providerResponse,
            updatedAt: event.at,
          }),
        },
        Verified: {
          target: "Completed",
          data: ({ state, event }) => ({
            ...content(state),
            outcome: event.outcome,
            writeIntent: event.writeIntent,
            updatedAt: event.at,
          }),
        },
        VerificationResumed: {
          target: "Verifying",
          data: ({ state, event }) => ({
            ...content(state),
            lease: event.lease,
            attempt: event.attempt,
            writeIntent: { ...state.writeIntent, status: "unknown" },
            providerResponse: "unknown",
            updatedAt: event.at,
          }),
        },
        RetryScheduled: retryWait,
        Failed: failed(),
      },
    },
    Verifying: {
      on: {
        Verified: {
          target: "Completed",
          data: ({ state, event }) => ({
            ...content(state),
            outcome: event.outcome,
            writeIntent: event.writeIntent,
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
        Failed: failed(),
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
            writeIntent: { ...retryWriteIntent(state), status: "unknown" },
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
            writeIntent: {
              ...uncertainWriteIntent(state),
              status: state.writeIntent?.status === "accepted" ? "accepted" : "unknown",
            },
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

function terminal<Target extends "Blocked" | "Skipped" | "Superseded">(
  target: Target,
): {
  readonly target: Target;
  readonly data: (input: {
    readonly state: LineupRunState;
    readonly event: TerminalEvent;
  }) => StateData<typeof LineupRunState.cases.Blocked.Type>;
} {
  return {
    target,
    data: ({ state, event }) => ({
      ...content(state),
      outcome: event.outcome,
      ...(priorWriteIntent(state) === undefined ? {} : { writeIntent: priorWriteIntent(state) }),
      updatedAt: event.at,
    }),
  };
}

function failed(): {
  readonly target: "Failed";
  readonly data: (input: {
    readonly state: LineupRunState;
    readonly event: TerminalEvent;
  }) => StateData<typeof LineupRunState.cases.Failed.Type>;
} {
  return {
    target: "Failed",
    data: ({ state, event }) => {
      const intent =
        event._tag === "Failed" && event.writeIntent !== undefined
          ? event.writeIntent
          : priorWriteIntent(state);
      return {
        ...content(state),
        outcome: event.outcome,
        ...(intent === undefined
          ? {}
          : {
              writeIntent: {
                ...intent,
                status:
                  event._tag === "Failed" && event.writeIntent !== undefined
                    ? event.writeIntent.status
                    : ("rejected" as const),
              },
            }),
        updatedAt: event.at,
      };
    },
  };
}

function priorWriteIntent(state: LineupRunState): typeof PriorWriteIntent.Type | undefined {
  return state._tag === "Applying" ||
    state._tag === "Verifying" ||
    state._tag === "RetryWait" ||
    state._tag === "Uncertain"
    ? state.writeIntent
    : undefined;
}

function retryWriteIntent(
  state: Extract<LineupRunState, { readonly _tag: "RetryWait" }>,
): typeof RetryWriteIntent.Type {
  if (state.writeIntent === undefined) {
    throw new Error("Verification cannot resume without a write intent");
  }
  return state.writeIntent;
}

function uncertainWriteIntent(
  state: Extract<LineupRunState, { readonly _tag: "Uncertain" }>,
): typeof ActiveWriteIntent.Type {
  if (state.writeIntent === undefined) {
    throw new Error("Uncertain reconciliation requires a write intent");
  }
  return state.writeIntent;
}

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
