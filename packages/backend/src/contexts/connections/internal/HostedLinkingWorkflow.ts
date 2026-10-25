import { Machine } from "@typeonce/effect-machine";
import { Schema } from "effect";

import { ConnectionId, Provider } from "#contexts/connections/Connection.ts";
import { HostedLinkingFailureReason } from "#contexts/connections/HostedLinking.ts";

const HostedLinkingContent = {
  connectionId: ConnectionId,
  provider: Provider,
  startedAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
};

export const HostedLinkingState = Schema.TaggedUnion({
  Active: HostedLinkingContent,
  Completing: HostedLinkingContent,
  Completed: {
    ...HostedLinkingContent,
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

const HostedLinkingStates = Machine.state({
  states: {
    Active: HostedLinkingState.cases.Active,
    Completing: HostedLinkingState.cases.Completing,
    Completed: {
      type: "final",
      schema: HostedLinkingState.cases.Completed,
    },
    Cancelled: {
      type: "final",
      schema: HostedLinkingState.cases.Cancelled,
    },
    Expired: {
      type: "final",
      schema: HostedLinkingState.cases.Expired,
    },
    Failed: {
      type: "final",
      schema: HostedLinkingState.cases.Failed,
    },
  },
});

export const HostedLinkingEvents = Schema.TaggedUnion({
  CompletionStarted: { at: Schema.DateTimeUtc },
  CompletionSucceeded: { at: Schema.DateTimeUtc },
  CompletionFailed: { at: Schema.DateTimeUtc, reason: HostedLinkingFailureReason },
  Cancelled: { at: Schema.DateTimeUtc },
  Expired: { at: Schema.DateTimeUtc },
});

export const HostedLinkingWorkflow = Machine.make({
  root: HostedLinkingStates,
  input: HostedLinkingState.cases.Active,
  events: Machine.eventsFromSchemas(HostedLinkingEvents),
}).handle({
  initial: { target: "Active", data: ({ input }) => input },
  states: {
    Active: {
      on: {
        CompletionStarted: {
          target: "Completing",
          data: ({ state, event }) => ({
            connectionId: state.connectionId,
            provider: state.provider,
            startedAt: state.startedAt,
            expiresAt: state.expiresAt,
            updatedAt: event.at,
          }),
        },
        Cancelled: {
          target: "Cancelled",
          data: ({ state, event }) => ({
            connectionId: state.connectionId,
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
            connectionId: state.connectionId,
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
            connectionId: state.connectionId,
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
            connectionId: state.connectionId,
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
            connectionId: state.connectionId,
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
            connectionId: state.connectionId,
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

export type HostedLinkingRequest = Machine.Machine.InputEvent<typeof HostedLinkingWorkflow>;
