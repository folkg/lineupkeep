import { DateTime, Schema } from "effect";

import { defineMachine, final } from "#utilities/machine.ts";

const DeliveryContent = {
  attempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  lastError: Schema.NullOr(Schema.String),
  updatedAt: Schema.DateTimeUtc,
};

export const LineupDeliveryState = Schema.TaggedUnion({
  pending: { ...DeliveryContent, dispatchedAt: Schema.Null },
  dispatching: { ...DeliveryContent, dispatchedAt: Schema.Null },
  dispatched: {
    attempts: DeliveryContent.attempts,
    lastError: Schema.Null,
    dispatchedAt: Schema.DateTimeUtc,
    updatedAt: Schema.DateTimeUtc,
  },
});
export type LineupDeliveryState = typeof LineupDeliveryState.Type;

export const LineupDeliveryEvent = Schema.TaggedUnion({
  Claimed: { at: Schema.DateTimeUtc },
  Dispatched: { at: Schema.DateTimeUtc },
  Released: { at: Schema.DateTimeUtc, error: Schema.optional(Schema.String) },
});
export type LineupDeliveryEvent = typeof LineupDeliveryEvent.Type;

export const LineupDeliveryWorkflow = defineMachine<LineupDeliveryState, LineupDeliveryEvent>({
  root: {
    pending: LineupDeliveryState.cases.pending,
    dispatching: LineupDeliveryState.cases.dispatching,
    dispatched: final(LineupDeliveryState.cases.dispatched),
  },
  events: LineupDeliveryEvent,
  initial: { target: "pending", data: ({ input }) => input },
  states: {
    pending: {
      on: {
        Claimed: {
          target: "dispatching",
          data: ({ state, event }) => ({
            attempts: state.attempts + 1,
            lastError: state.lastError,
            dispatchedAt: null,
            updatedAt: event.at,
          }),
        },
      },
    },
    dispatching: {
      on: {
        Claimed: {
          target: "dispatching",
          data: ({ state, event }) => ({
            attempts: state.attempts + 1,
            lastError: state.lastError,
            dispatchedAt: null,
            updatedAt: event.at,
          }),
        },
        Dispatched: {
          target: "dispatched",
          data: ({ state, event }) => ({
            attempts: state.attempts,
            lastError: null,
            dispatchedAt: event.at,
            updatedAt: event.at,
          }),
        },
        Released: {
          target: "pending",
          data: ({ state, event }) => ({
            attempts: state.attempts,
            lastError: event.error ?? null,
            dispatchedAt: null,
            updatedAt: event.at,
          }),
        },
      },
    },
    dispatched: {},
  },
});

export function initialLineupDeliveryState(at: DateTime.Utc): LineupDeliveryState {
  return { _tag: "pending", attempts: 0, lastError: null, dispatchedAt: null, updatedAt: at };
}

export function lineupDeliveryStatus(
  state: LineupDeliveryState,
): LineupDeliveryProjection["status"] {
  return state._tag;
}

export function lineupDeliveryState(record: LineupDeliveryProjection): LineupDeliveryState {
  const { attempts, lastError, dispatchedAt, updatedAt } = record;
  switch (record.status) {
    case "pending":
    case "dispatching":
      if (dispatchedAt !== null) {
        throw new Error("An undelivered lineup delivery cannot have a dispatch timestamp");
      }
      return { _tag: record.status, attempts, lastError, dispatchedAt, updatedAt };
    case "dispatched":
      if (dispatchedAt === null || lastError !== null) {
        throw new Error("A dispatched lineup delivery requires a timestamp and no error");
      }
      return { _tag: "dispatched", attempts, lastError, dispatchedAt, updatedAt };
  }
}

type LineupDeliveryProjection = {
  readonly status: LineupDeliveryState["_tag"];
  readonly attempts: number;
  readonly lastError: string | null;
  readonly dispatchedAt: DateTime.Utc | null;
  readonly updatedAt: DateTime.Utc;
};
