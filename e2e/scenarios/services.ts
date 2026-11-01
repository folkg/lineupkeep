import type { ProviderConnection } from "@lineupkeep/backend/connections/Connection";
import { Connections } from "@lineupkeep/backend/connections/Connections";
import type { FantasyTeam } from "@lineupkeep/backend/connections/FantasyTeam";
import { decodeProviderKey } from "@lineupkeep/backend/connections/ProviderKey";
import { Array, DateTime, Effect, Redacted, Schema } from "effect";

import type { ServiceProgram } from "#e2e/serviceContract.ts";

export const connectYahooAndDiscoverTeams: ServiceProgram = (user, arguments_) =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(Schema.Struct({}))(arguments_);
    const connections = yield* Connections;
    const linked = Array.getUnsafe(
      yield* connections.link(user.id, [
        {
          provider: decodeProviderKey("yahoo"),
          session: Redacted.make("A1=e2e-provider-session"),
        },
      ]),
      0,
    );
    const teams = yield* connections.discoverTeams(user.id, [{ id: linked.id }]);
    return teams.map(observeTeam);
  });

export const readConnections: ServiceProgram = (user, arguments_) =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(Schema.Struct({}))(arguments_);
    const connections = yield* Connections;
    return (yield* connections.list(user.id)).map(observeConnection);
  });

export const rejectOperation: ServiceProgram = (_user, arguments_) =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(Schema.Struct({}))(arguments_);
    return yield* Effect.fail({ _tag: "ExpectedRejection", message: "Synthetic rejection" });
  });

export const nonJsonResult: ServiceProgram = (_user, arguments_) =>
  Effect.gen(function* () {
    yield* Schema.decodeUnknownEffect(Schema.Struct({}))(arguments_);
    return 1n;
  });

function observeTeam(team: FantasyTeam): ObservedTeam {
  return {
    id: team.id,
    name: team.name,
    availability: team.availability,
    automation: {
      status: team.automation.status,
      ...(team.automation.resumesAt === undefined
        ? {}
        : { resumesAt: DateTime.formatIso(team.automation.resumesAt) }),
    },
  };
}

function observeConnection(connection: ProviderConnection): ObservedConnection {
  return {
    id: connection.id,
    status: connection.status,
    ...(connection.linkingExpiresAt === undefined
      ? {}
      : { linkingExpiresAt: DateTime.formatIso(connection.linkingExpiresAt) }),
    ...(connection.credentialGeneration === undefined
      ? {}
      : { credentialGeneration: connection.credentialGeneration }),
    ...(connection.reconnectRequiredAt === undefined
      ? {}
      : { reconnectRequiredAt: DateTime.formatIso(connection.reconnectRequiredAt) }),
    ...(connection.disconnectedAt === undefined
      ? {}
      : { disconnectedAt: DateTime.formatIso(connection.disconnectedAt) }),
  };
}

type ObservedTeam = {
  readonly id: string;
  readonly name: string;
  readonly availability: FantasyTeam["availability"];
  readonly automation: {
    readonly status: FantasyTeam["automation"]["status"];
    readonly resumesAt?: string;
  };
};

type ObservedConnection = {
  readonly id: string;
  readonly status: ProviderConnection["status"];
  readonly linkingExpiresAt?: string;
  readonly credentialGeneration?: number;
  readonly reconnectRequiredAt?: string;
  readonly disconnectedAt?: string;
};
