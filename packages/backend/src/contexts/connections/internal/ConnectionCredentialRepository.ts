import { and, eq } from "drizzle-orm";
import { Context, DateTime, Effect, Layer } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { ConnectionId } from "#contexts/connections/Connection.ts";
import { ConnectionPersistenceFailed } from "#contexts/connections/Connection.ts";

import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import { providerCredentials } from "./ConnectionTables.ts";

type RewrapCredentialCommand = {
  readonly userId: UserId;
  readonly connectionId: ConnectionId;
  readonly previousEnvelope: string;
  readonly rewrappedEnvelope: string;
};

export class ConnectionCredentialRepository extends Context.Service<ConnectionCredentialRepository>()(
  "@lineupkeep/backend/contexts/connections/internal/ConnectionCredentialRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;

      const listAllEnvelopes = Effect.fn("ConnectionCredentialRepository.listAllEnvelopes")(
        function* () {
          const rows = yield* database
            .select({ envelope: providerCredentials.envelope })
            .from(providerCredentials)
            .pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
          return rows.map((row) => row.envelope);
        },
      );

      const rewrap = Effect.fn("ConnectionCredentialRepository.rewrap")(function* (
        command: RewrapCredentialCommand,
      ) {
        const now = yield* DateTime.now;
        const replaced = yield* database
          .update(providerCredentials)
          .set({
            envelope: command.rewrappedEnvelope,
            updatedAt: DateTime.toDateUtc(now),
          })
          .where(
            and(
              eq(providerCredentials.connectionId, command.connectionId),
              eq(providerCredentials.userId, command.userId),
              eq(providerCredentials.envelope, command.previousEnvelope),
            ),
          )
          .returning({ connectionId: providerCredentials.connectionId })
          .pipe(Effect.mapError((cause) => ConnectionPersistenceFailed.make({ cause })));
        return replaced.length > 0;
      });

      return { listAllEnvelopes, rewrap };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}
