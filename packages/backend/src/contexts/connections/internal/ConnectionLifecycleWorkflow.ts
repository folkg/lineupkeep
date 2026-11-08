import { Schema } from "effect";

import { ConnectionCredentialGeneration, ProviderKey } from "#contexts/connections/Connection.ts";
import { defineMachine, final } from "#utilities/machine.ts";

const ConnectionContent = {
  provider: ProviderKey,
  updatedAt: Schema.DateTimeUtc,
};

export const ConnectionLifecycleState = Schema.TaggedUnion({
  Linking: {
    ...ConnectionContent,
    expiresAt: Schema.DateTimeUtc,
  },
  Ready: {
    ...ConnectionContent,
    approvedAt: Schema.DateTimeUtc,
    credentialGeneration: ConnectionCredentialGeneration,
  },
  ReconnectRequired: {
    ...ConnectionContent,
    reconnectRequiredAt: Schema.DateTimeUtc,
    credentialGeneration: ConnectionCredentialGeneration,
  },
  Disconnected: {
    ...ConnectionContent,
    disconnectedAt: Schema.DateTimeUtc,
  },
});
export type ConnectionLifecycleState = typeof ConnectionLifecycleState.Type;

const ConnectionLifecycleStates = {
  Linking: ConnectionLifecycleState.cases.Linking,
  Ready: ConnectionLifecycleState.cases.Ready,
  ReconnectRequired: ConnectionLifecycleState.cases.ReconnectRequired,
  Disconnected: final(ConnectionLifecycleState.cases.Disconnected),
};

export const ConnectionLifecycleEvents = Schema.TaggedUnion({
  LinkCompleted: { at: Schema.DateTimeUtc, credentialGeneration: ConnectionCredentialGeneration },
  ReconnectRequired: { at: Schema.DateTimeUtc },
  Reconnected: { at: Schema.DateTimeUtc, credentialGeneration: ConnectionCredentialGeneration },
  Disconnected: { at: Schema.DateTimeUtc },
});

export const ConnectionLifecycleWorkflow = defineMachine<
  ConnectionLifecycleState,
  ConnectionLifecycleRequest
>({
  root: ConnectionLifecycleStates,
  events: ConnectionLifecycleEvents,
  initial: { target: "Linking", data: ({ input }) => input },
  states: {
    Linking: {
      on: {
        LinkCompleted: {
          target: "Ready",
          data: ({ state, event }) => ({
            provider: state.provider,
            approvedAt: event.at,
            credentialGeneration: event.credentialGeneration,
            updatedAt: event.at,
          }),
        },
        Disconnected: {
          target: "Disconnected",
          data: ({ state, event }) => ({
            provider: state.provider,
            disconnectedAt: event.at,
            updatedAt: event.at,
          }),
        },
      },
    },
    Ready: {
      on: {
        ReconnectRequired: {
          target: "ReconnectRequired",
          data: ({ state, event }) => ({
            provider: state.provider,
            reconnectRequiredAt: event.at,
            credentialGeneration: state.credentialGeneration,
            updatedAt: event.at,
          }),
        },
        Reconnected: {
          target: "Ready",
          data: ({ state, event }) => ({
            provider: state.provider,
            approvedAt: event.at,
            credentialGeneration: event.credentialGeneration,
            updatedAt: event.at,
          }),
        },
        Disconnected: {
          target: "Disconnected",
          data: ({ state, event }) => ({
            provider: state.provider,
            disconnectedAt: event.at,
            updatedAt: event.at,
          }),
        },
      },
    },
    ReconnectRequired: {
      on: {
        Reconnected: {
          target: "Ready",
          data: ({ state, event }) => ({
            provider: state.provider,
            approvedAt: event.at,
            credentialGeneration: event.credentialGeneration,
            updatedAt: event.at,
          }),
        },
        Disconnected: {
          target: "Disconnected",
          data: ({ state, event }) => ({
            provider: state.provider,
            disconnectedAt: event.at,
            updatedAt: event.at,
          }),
        },
      },
    },
    Disconnected: {},
  },
});

export type ConnectionLifecycleRequest = typeof ConnectionLifecycleEvents.Type;
