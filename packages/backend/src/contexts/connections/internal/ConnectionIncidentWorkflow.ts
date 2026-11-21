import { DateTime, Schema } from "effect";

import { defineMachine, final } from "#utilities/machine.ts";

export const ConnectionIncidentState = Schema.TaggedUnion({
  open: { openedAt: Schema.DateTimeUtc },
  resolved: {
    openedAt: Schema.DateTimeUtc,
    resolvedAt: Schema.DateTimeUtc,
    resolution: Schema.Literals(["reconnected", "disconnected"]),
  },
});
export type ConnectionIncidentState = typeof ConnectionIncidentState.Type;

export const ConnectionIncidentEvent = Schema.TaggedUnion({
  Resolved: {
    at: Schema.DateTimeUtc,
    resolution: Schema.Literals(["reconnected", "disconnected"]),
  },
});
export type ConnectionIncidentEvent = typeof ConnectionIncidentEvent.Type;

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
