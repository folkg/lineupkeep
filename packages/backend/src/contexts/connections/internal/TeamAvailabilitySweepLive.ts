import { DateTime, Effect, Layer } from "effect";

import type { ConnectionStatus } from "#contexts/connections/Connection.ts";
import type { TeamAvailability } from "#contexts/connections/FantasyTeam.ts";
import type { ProviderLeagueAccess } from "#contexts/connections/Provider.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";
import { TeamAvailabilitySweep } from "#contexts/connections/TeamAvailabilitySweep.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import { ConnectionRepository } from "./ConnectionRepository.ts";
import type {
  AvailabilityTarget,
  AvailabilityTargetTeam,
  TeamAvailabilityObservation,
  TeamAvailabilityUpdate,
} from "./ConnectionRepository.ts";

const availabilitySweepConnectionLimit = 200;

export const TeamAvailabilitySweepLive = Layer.effect(
  TeamAvailabilitySweep,
  Effect.gen(function* () {
    const repository = yield* ConnectionRepository;
    const registry = yield* ProviderRegistry;
    const encryption = yield* ConnectionCredentialEncryption;

    const run = Effect.fn("TeamAvailabilitySweep.run")(function* (limit: number) {
      const targets = yield* repository.loadAvailabilityTargets(
        Math.min(limit, availabilitySweepConnectionLimit),
      );
      const now = yield* DateTime.now;
      const summary = {
        connectionsChecked: 0,
        connectionsSkipped: 0,
        leaguesChecked: 0,
        teamsObserved: 0,
        teamsUnavailable: 0,
      };
      const updates: Array<TeamAvailabilityUpdate> = [];
      for (const target of targets) {
        if (target.teams.length === 0) {
          continue;
        }
        const observed = yield* observeConnection(target, now);
        if (observed === undefined) {
          summary.connectionsSkipped += 1;
          continue;
        }
        updates.push({ userId: target.userId, observations: observed.observations });
        summary.connectionsChecked += 1;
        summary.leaguesChecked += observed.leaguesChecked;
        summary.teamsObserved += observed.observations.length;
        summary.teamsUnavailable += observed.observations.filter(
          (observation) => observation.availability.status === "unavailable",
        ).length;
      }
      yield* repository.recordTeamAvailability(updates, now);
      yield* Effect.annotateCurrentSpan({
        "availability.connections_checked": summary.connectionsChecked,
        "availability.connections_skipped": summary.connectionsSkipped,
        "availability.leagues_checked": summary.leaguesChecked,
        "availability.teams_observed": summary.teamsObserved,
        "availability.teams_unavailable": summary.teamsUnavailable,
      });
      return summary;
    });

    const observeConnection = Effect.fnUntraced(function* (
      target: AvailabilityTarget,
      at: DateTime.Utc,
    ) {
      if (target.status !== "ready") {
        return connectionOutcome(
          0,
          target.teams.map((team) =>
            unavailableObservation(
              team,
              "connection_unavailable",
              connectionUnavailableDetail(target.status),
              at,
            ),
          ),
        );
      }
      if (target.credential === undefined) {
        return yield* Effect.die(
          new Error(`Ready connection ${target.connectionId} is missing its credential`),
        );
      }
      const provider = registry.get(target.credential.provider);
      if (provider === undefined) {
        return yield* Effect.die(
          new Error(
            `Connection ${target.connectionId} references an unregistered provider ${target.credential.provider}`,
          ),
        );
      }
      const decrypted = yield* Effect.result(
        encryption.decrypt({
          userId: target.userId,
          connectionId: target.connectionId,
          provider: target.credential.provider,
          envelope: target.credential.envelope,
        }),
      );
      if (decrypted._tag === "Failure") {
        yield* Effect.annotateCurrentSpan({
          "availability.connection_outcome": "credential_unreadable",
        });
        return undefined;
      }
      if (target.teams.length === 0) {
        return connectionOutcome(0, []);
      }
      const leagueKeys = [
        ...new Set(target.teams.map((team) => team.providerLeagueKey)),
      ].toSorted();
      const checked = yield* Effect.result(
        provider.checkLeagueAccess({
          provider: target.credential.provider,
          session: decrypted.success,
          providerLeagueKeys: leagueKeys,
        }),
      );
      if (checked._tag === "Failure") {
        if (checked.failure._tag === "provider.session_rejected") {
          const rejected = yield* Effect.result(
            repository.rejectSession(
              target.userId,
              target.connectionId,
              target.credential.generation,
              at,
            ),
          );
          if (
            rejected._tag === "Failure" &&
            rejected.failure._tag !== "connection.provider_rejected"
          ) {
            return yield* rejected.failure;
          }
          return connectionOutcome(
            0,
            target.teams.map((team) =>
              unavailableObservation(team, "connection_unavailable", rejectedSessionDetail, at),
            ),
          );
        }
        yield* Effect.annotateCurrentSpan({
          "availability.connection_outcome": "provider_read_failed",
          "error.type": checked.failure._tag,
          ...(checked.failure._tag === "provider.request_failed" &&
          checked.failure.status !== undefined
            ? { "http.response.status_code": checked.failure.status }
            : {}),
        });
        yield* Effect.logWarning(
          "The availability sweep could not read a connection and left its last observation in place",
        );
        return undefined;
      }
      const accessByLeague = new Map(
        checked.success.map((access) => [access.providerLeagueKey, access]),
      );
      return connectionOutcome(
        leagueKeys.length,
        target.teams.map((team) => availabilityObservation(team, accessByLeague, at)),
      );
    });

    return TeamAvailabilitySweep.of({ run: (limit) => run(limit) });
  }),
);

type ConnectionOutcome = {
  readonly leaguesChecked: number;
  readonly observations: ReadonlyArray<TeamAvailabilityObservation>;
};

function connectionOutcome(
  leaguesChecked: number,
  observations: ReadonlyArray<TeamAvailabilityObservation>,
): ConnectionOutcome {
  return { leaguesChecked, observations };
}

function availabilityObservation(
  team: AvailabilityTargetTeam,
  accessByLeague: ReadonlyMap<string, ProviderLeagueAccess>,
  at: DateTime.Utc,
): TeamAvailabilityObservation {
  const access = accessByLeague.get(team.providerLeagueKey);
  if (access === undefined) {
    throw new Error(`The sweep did not read league ${team.providerLeagueKey}`);
  }
  return access.status === "listed"
    ? { team: team.id, availability: { status: "available", observedAt: at } }
    : unavailableObservation(team, "provider_refused", access.detail, at);
}

function unavailableObservation(
  team: AvailabilityTargetTeam,
  reason: Extract<TeamAvailability, { readonly status: "unavailable" }>["reason"],
  detail: string,
  at: DateTime.Utc,
): TeamAvailabilityObservation {
  return {
    team: team.id,
    availability: {
      status: "unavailable",
      reason,
      detail,
      observedAt: at,
      consecutiveRefusals: reason === "provider_refused" ? team.consecutiveRefusals + 1 : 0,
    },
  };
}

function connectionUnavailableDetail(status: ConnectionStatus): string {
  switch (status) {
    case "linking":
      return "The connection sign-in is not finished, so Lineupkeep cannot read this team.";
    case "reconnect-required":
      return "The connection needs a new sign-in, so Lineupkeep cannot read this team.";
    case "disconnected":
      return "The connection is disconnected, so Lineupkeep cannot read this team.";
    case "ready":
      throw new Error("A ready connection is not connection-unavailable");
  }
}

const rejectedSessionDetail =
  "The provider rejected this connection's sign-in, so Lineupkeep cannot read this team.";
