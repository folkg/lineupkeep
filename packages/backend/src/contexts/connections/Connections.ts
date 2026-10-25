import type { UserId } from "@lineupkeep/backend/auth/User";
import { Context } from "effect";
import type { Effect } from "effect";

import type {
  ConnectionError,
  ConnectionIdInput,
  ProviderConnection,
  StartLinkingInput,
} from "./Connection.ts";

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

  readonly approveLinking: (
    userId: UserId,
    inputs: ReadonlyArray<ConnectionIdInput>,
  ) => Effect.Effect<ReadonlyArray<ProviderConnection>, ConnectionError>;
};
