import type { UserId } from "@lineupkeep/backend/auth/User";
import { Context } from "effect";
import type { Effect } from "effect";

import type {
  CompleteLinkingInput,
  ConnectionError,
  ConnectionIdInput,
  ProviderConnection,
  ReconnectInput,
  StartLinkingInput,
} from "./Connection.ts";
import type { FantasyTeam } from "./FantasyTeam.ts";

export class Connections extends Context.Service<Connections, ConnectionsShape>()(
  "@lineupkeep/backend/contexts/connections/Connections",
) {}

export type ConnectionsShape = {
  readonly list: (
    userId: UserId,
  ) => Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError>;

  readonly startLinking: (
    userId: UserId,
    inputs: ReadonlyArray<StartLinkingInput>,
  ) => Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError>;

  readonly cancelLinking: (
    userId: UserId,
    inputs: ReadonlyArray<ConnectionIdInput>,
  ) => Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError>;

  readonly completeLinking: (
    userId: UserId,
    inputs: ReadonlyArray<CompleteLinkingInput>,
  ) => Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError>;

  readonly reconnect: (
    userId: UserId,
    inputs: ReadonlyArray<ReconnectInput>,
  ) => Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError>;

  readonly disconnect: (
    userId: UserId,
    inputs: ReadonlyArray<ConnectionIdInput>,
  ) => Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError>;

  readonly discoverTeams: (
    userId: UserId,
    inputs: ReadonlyArray<ConnectionIdInput>,
  ) => Effect.Effect<ReadonlyArray<FantasyTeam>, ConnectionError>;

  readonly listTeams: (
    userId: UserId,
  ) => Effect.Effect<ReadonlyArray<FantasyTeam>, ConnectionError>;
};
