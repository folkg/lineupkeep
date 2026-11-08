import { Schema } from "effect";

import { ConnectionId, ProviderKey } from "#contexts/connections/Connection.ts";
import { HostedLinkingFailureReason } from "#contexts/connections/HostedLinking.ts";
import { defineMachine, final } from "#utilities/machine.ts";

const HostedLinkingContent = {
  provider: ProviderKey,
  startedAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
};

const HostedLinkingReconnectContent = {
  ...HostedLinkingContent,
  connectionId: Schema.optional(ConnectionId),
};

export const HostedLinkingState = Schema.TaggedUnion({
  Active: HostedLinkingReconnectContent,
  Completing: HostedLinkingReconnectContent,
  Completed: {
    ...HostedLinkingContent,
    connectionId: ConnectionId,
    completedAt: Schema.DateTimeUtc,
  },
  Cancelled: {
    ...HostedLinkingContent,
    cancelledAt: Schema.DateTimeUtc,
  },
  Expired: {
    ...HostedLinkingContent,
    expiredAt: Schema.DateTimeUtc,
  },
  Failed: {
    ...HostedLinkingContent,
    failedAt: Schema.DateTimeUtc,
    reason: HostedLinkingFailureReason,
  },
});
export type HostedLinkingState = typeof HostedLinkingState.Type;

const HostedLinkingStates = {
  Active: HostedLinkingState.cases.Active,
  Completing: HostedLinkingState.cases.Completing,
  Completed: final(HostedLinkingState.cases.Completed),
  Cancelled: final(HostedLinkingState.cases.Cancelled),
  Expired: final(HostedLinkingState.cases.Expired),
  Failed: final(HostedLinkingState.cases.Failed),
};

export const HostedLinkingEvents = Schema.TaggedUnion({
  CompletionStarted: { at: Schema.DateTimeUtc },
  CompletionSucceeded: { at: Schema.DateTimeUtc, connectionId: ConnectionId },
  CompletionFailed: { at: Schema.DateTimeUtc, reason: HostedLinkingFailureReason },
  Cancelled: { at: Schema.DateTimeUtc },
  Expired: { at: Schema.DateTimeUtc },
});

export const HostedLinkingWorkflow = defineMachine<HostedLinkingState, HostedLinkingRequest>({
  root: HostedLinkingStates,
  events: HostedLinkingEvents,
  initial: { target: "Active", data: ({ input }) => input },
  states: {
    Active: {
      on: {
        CompletionStarted: {
          target: "Completing",
          data: ({ state, event }) => ({
            provider: state.provider,
            startedAt: state.startedAt,
            expiresAt: state.expiresAt,
            ...reconnectTarget(state.connectionId),
            updatedAt: event.at,
          }),
        },
        Cancelled: {
          target: "Cancelled",
          data: ({ state, event }) => ({
            provider: state.provider,
            startedAt: state.startedAt,
            expiresAt: state.expiresAt,
            cancelledAt: event.at,
            updatedAt: event.at,
          }),
        },
        Expired: {
          target: "Expired",
          data: ({ state, event }) => ({
            provider: state.provider,
            startedAt: state.startedAt,
            expiresAt: state.expiresAt,
            expiredAt: event.at,
            updatedAt: event.at,
          }),
        },
        CompletionFailed: {
          target: "Failed",
          data: ({ state, event }) => ({
            provider: state.provider,
            startedAt: state.startedAt,
            expiresAt: state.expiresAt,
            failedAt: event.at,
            reason: event.reason,
            updatedAt: event.at,
          }),
        },
      },
    },
    Completing: {
      on: {
        CompletionSucceeded: {
          target: "Completed",
          data: ({ state, event }) => ({
            connectionId: event.connectionId,
            provider: state.provider,
            startedAt: state.startedAt,
            expiresAt: state.expiresAt,
            completedAt: event.at,
            updatedAt: event.at,
          }),
        },
        CompletionFailed: {
          target: "Failed",
          data: ({ state, event }) => ({
            provider: state.provider,
            startedAt: state.startedAt,
            expiresAt: state.expiresAt,
            failedAt: event.at,
            reason: event.reason,
            updatedAt: event.at,
          }),
        },
        Expired: {
          target: "Expired",
          data: ({ state, event }) => ({
            provider: state.provider,
            startedAt: state.startedAt,
            expiresAt: state.expiresAt,
            expiredAt: event.at,
            updatedAt: event.at,
          }),
        },
      },
    },
    Completed: {},
    Cancelled: {},
    Expired: {},
    Failed: {},
  },
});

export type HostedLinkingRequest = typeof HostedLinkingEvents.Type;

function reconnectTarget(connectionId: ConnectionId | undefined): { connectionId?: ConnectionId } {
  return connectionId === undefined ? {} : { connectionId };
}
