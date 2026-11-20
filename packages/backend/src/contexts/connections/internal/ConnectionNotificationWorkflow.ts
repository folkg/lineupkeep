import { DateTime, Schema } from "effect";

import { defineMachine, final } from "#utilities/machine.ts";

const NotificationContent = {
  attempts: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  nextAttemptAt: Schema.DateTimeUtc,
  lastError: Schema.NullOr(Schema.String),
  sentAt: Schema.Null,
  updatedAt: Schema.DateTimeUtc,
};

export const ConnectionNotificationState = Schema.TaggedUnion({
  pending: NotificationContent,
  sending: NotificationContent,
  sent: { ...NotificationContent, lastError: Schema.Null, sentAt: Schema.DateTimeUtc },
  cancelled: NotificationContent,
  failed: NotificationContent,
});
export type ConnectionNotificationState = typeof ConnectionNotificationState.Type;

export const ConnectionNotificationEvent = Schema.TaggedUnion({
  Reclaimed: { at: Schema.DateTimeUtc },
  Claimed: { at: Schema.DateTimeUtc },
  Sent: { at: Schema.DateTimeUtc },
  Cancelled: { at: Schema.DateTimeUtc },
  Undeliverable: { at: Schema.DateTimeUtc, error: Schema.String },
  Rejected: { at: Schema.DateTimeUtc, error: Schema.String },
  Retried: { at: Schema.DateTimeUtc, nextAttemptAt: Schema.DateTimeUtc, error: Schema.String },
});
export type ConnectionNotificationEvent = typeof ConnectionNotificationEvent.Type;

export const ConnectionNotificationWorkflow = defineMachine<
  ConnectionNotificationState,
  ConnectionNotificationEvent
>({
  root: {
    pending: ConnectionNotificationState.cases.pending,
    sending: ConnectionNotificationState.cases.sending,
    sent: final(ConnectionNotificationState.cases.sent),
    cancelled: final(ConnectionNotificationState.cases.cancelled),
    failed: final(ConnectionNotificationState.cases.failed),
  },
  events: ConnectionNotificationEvent,
  initial: { target: "pending", data: ({ input }) => input },
  states: {
    pending: {
      on: {
        Claimed: {
          target: "sending",
          data: ({ state, event }) => ({ ...notificationFields(state), updatedAt: event.at }),
        },
        Cancelled: {
          target: "cancelled",
          data: ({ state, event }) => ({ ...notificationFields(state), updatedAt: event.at }),
        },
      },
    },
    sending: {
      on: {
        Reclaimed: {
          target: "pending",
          data: ({ state, event }) => ({
            ...notificationFields(state),
            nextAttemptAt: event.at,
            updatedAt: event.at,
          }),
        },
        Sent: {
          target: "sent",
          data: ({ state, event }) => ({
            ...notificationFields(state),
            attempts: state.attempts + 1,
            lastError: null,
            sentAt: event.at,
            updatedAt: event.at,
          }),
        },
        Cancelled: {
          target: "cancelled",
          data: ({ state, event }) => ({ ...notificationFields(state), updatedAt: event.at }),
        },
        Undeliverable: {
          target: "failed",
          data: ({ state, event }) => ({
            ...notificationFields(state),
            lastError: event.error,
            updatedAt: event.at,
          }),
        },
        Rejected: {
          target: "failed",
          data: ({ state, event }) => ({
            ...notificationFields(state),
            attempts: state.attempts + 1,
            lastError: event.error,
            updatedAt: event.at,
          }),
        },
        Retried: {
          target: "pending",
          data: ({ state, event }) => ({
            ...notificationFields(state),
            attempts: state.attempts + 1,
            nextAttemptAt: event.nextAttemptAt,
            lastError: event.error,
            updatedAt: event.at,
          }),
        },
      },
    },
    sent: {},
    cancelled: {},
    failed: {},
  },
});

export function initialConnectionNotificationState(at: DateTime.Utc): ConnectionNotificationState {
  return {
    _tag: "pending",
    attempts: 0,
    nextAttemptAt: at,
    lastError: null,
    sentAt: null,
    updatedAt: at,
  };
}

export function connectionNotificationProjection(
  state: ConnectionNotificationState,
): ConnectionNotificationProjection {
  return {
    status: state._tag,
    attempts: state.attempts,
    nextAttemptAt: state.nextAttemptAt,
    lastError: state.lastError,
    sentAt: state.sentAt,
    updatedAt: state.updatedAt,
  };
}

type ConnectionNotificationProjection = {
  readonly status: ConnectionNotificationState["_tag"];
  readonly attempts: number;
  readonly nextAttemptAt: DateTime.Utc;
  readonly lastError: string | null;
  readonly sentAt: DateTime.Utc | null;
  readonly updatedAt: DateTime.Utc;
};

function notificationFields(
  state: Extract<ConnectionNotificationState, { readonly _tag: "pending" | "sending" }>,
): Omit<Extract<ConnectionNotificationState, { readonly _tag: "sending" }>, "_tag"> {
  return {
    attempts: state.attempts,
    nextAttemptAt: state.nextAttemptAt,
    lastError: state.lastError,
    sentAt: state.sentAt,
    updatedAt: state.updatedAt,
  };
}
