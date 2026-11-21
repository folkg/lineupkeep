//@ backend dafny
import { DateTime, Schema } from "effect";

import { defineMachine, final } from "#utilities/machine.ts";

//@ declare-type Utc { epochMilliseconds: number }
//@ skip
export const ConnectionIncidentState = Schema.TaggedUnion({
  open: { openedAt: Schema.DateTimeUtc },
  resolved: {
    openedAt: Schema.DateTimeUtc,
    resolvedAt: Schema.DateTimeUtc,
    resolution: Schema.Literals(["reconnected", "disconnected"]),
  },
});
export type ConnectionIncidentState = typeof ConnectionIncidentState.Type;

//@ skip
export const ConnectionIncidentEvent = Schema.TaggedUnion({
  Resolved: {
    at: Schema.DateTimeUtc,
    resolution: Schema.Literals(["reconnected", "disconnected"]),
  },
});
export type ConnectionIncidentEvent = typeof ConnectionIncidentEvent.Type;

//@ skip
export const ConnectionIncidentWorkflow = defineMachine<
  ConnectionIncidentState,
  ConnectionIncidentEvent
>({
  root: {
    open: ConnectionIncidentState.cases.open,
    resolved: final(ConnectionIncidentState.cases.resolved),
  },
  events: ConnectionIncidentEvent,
  initial: { target: "open", data: ({ input }) => input },
  states: {
    open: {
      on: {
        Resolved: {
          target: "resolved",
          data: ({ state, event }) => ({
            openedAt: state.openedAt,
            resolvedAt: event.at,
            resolution: event.resolution,
          }),
        },
      },
    },
    resolved: {},
  },
});

export function initialConnectionIncidentState(openedAt: DateTime.Utc): ConnectionIncidentState {
  return { _tag: "open", openedAt };
}

export function connectionIncidentStatus(
  state: ConnectionIncidentState,
): ConnectionIncidentProjection["status"] {
  //@ verify
  //@ contract The persisted incident status equals its workflow state tag.
  //@ ensures \result === state._tag
  return state._tag;
}

export function connectionIncidentState(
  projection: ConnectionIncidentProjection,
): ConnectionIncidentState {
  const { openedAt, resolvedAt, resolution } = projection;
  switch (projection.status) {
    case "open":
      if (resolvedAt !== null || resolution !== null) {
        throw new Error("An open incident cannot have a resolution");
      }
      return { _tag: "open", openedAt };
    case "resolved":
      if (resolvedAt === null || resolution === null) {
        throw new Error("A resolved incident requires a timestamp and resolution");
      }
      return { _tag: "resolved", openedAt, resolvedAt, resolution };
  }
}

export function connectionIncidentProjection(
  state: ConnectionIncidentState,
): ConnectionIncidentProjection {
  //@ verify
  //@ contract The persisted incident row retains its state status, and open incidents never carry resolution data while resolved incidents carry both resolution fields.
  //@ ensures \result.status === state._tag
  //@ ensures \result.openedAt === state.openedAt
  //@ ensures (state._tag === "open" ==> \result.resolvedAt === null && \result.resolution === null)
  //@ ensures (state._tag === "resolved" ==> \result.resolvedAt !== null && \result.resolution !== null)
  return state._tag === "open"
    ? {
        status: connectionIncidentStatus(state),
        openedAt: state.openedAt,
        resolvedAt: null,
        resolution: null,
      }
    : {
        status: connectionIncidentStatus(state),
        openedAt: state.openedAt,
        resolvedAt: state.resolvedAt,
        resolution: state.resolution,
      };
}

type ConnectionIncidentProjection = {
  readonly status: ConnectionIncidentState["_tag"];
  readonly openedAt: DateTime.Utc;
  readonly resolvedAt: DateTime.Utc | null;
  readonly resolution: "reconnected" | "disconnected" | null;
};
