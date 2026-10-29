import type { UserId } from "@lineupkeep/backend/auth/User";
import { Context } from "effect";
import type { Effect } from "effect";

import type {
  CompleteReconnectInput,
  ConnectionError,
  ConnectionIdInput,
  LinkInput,
  ProviderConnection,
} from "./Connection.ts";
import type { FantasyTeam } from "./FantasyTeam.ts";

export class Connections extends Context.Service<Connections, ConnectionsShape>()(
  "@lineupkeep/backend/contexts/connections/Connections",
) {}

export type ConnectionsShape = {
  readonly list: (
    userId: UserId,
  ) => Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError>;

  readonly link: (
    userId: UserId,
    inputs: ReadonlyArray<LinkInput>,
  ) => Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError>;

  readonly completeReconnect: (
    userId: UserId,
    inputs: ReadonlyArray<CompleteReconnectInput>,
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
