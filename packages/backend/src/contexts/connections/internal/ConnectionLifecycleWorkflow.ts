import { Machine } from "@typeonce/effect-machine";
import { Schema } from "effect";

import { Provider } from "#contexts/connections/Connection.ts";

const ConnectionContent = {
  provider: Provider,
  updatedAt: Schema.DateTimeUtc,
};

export const ConnectionLifecycleState = Schema.TaggedUnion({
  Linking: {
    ...ConnectionContent,
    expiresAt: Schema.DateTimeUtc,
  },
  Disconnected: {
    ...ConnectionContent,
    disconnectedAt: Schema.DateTimeUtc,
  },
});

export const ConnectionLifecycleStates = Machine.state({
  states: {
    Linking: ConnectionLifecycleState.cases.Linking,
    Disconnected: {
      type: "final",
      schema: ConnectionLifecycleState.cases.Disconnected,
    },
  },
});

export const ConnectionLifecycleEvents = Schema.TaggedUnion({
  LinkCancelled: { at: Schema.DateTimeUtc },
});

export const ConnectionLifecycleWorkflow = Machine.make({
  root: ConnectionLifecycleStates,
  input: ConnectionLifecycleState.cases.Linking,
  events: Machine.eventsFromSchemas(ConnectionLifecycleEvents),
}).handle({
  initial: { target: "Linking", data: ({ input }) => input },
  states: {
    Linking: {
      on: {
        LinkCancelled: {
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

export type ConnectionLifecycleRequest = Machine.Machine.InputEvent<
  typeof ConnectionLifecycleWorkflow
>;
