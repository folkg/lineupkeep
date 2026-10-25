import { Effect, Layer } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { FantasyTeam, TeamId } from "#contexts/connections/FantasyTeam.ts";
import type { LineupRun } from "#contexts/connections/LineupRun.ts";
import {
  TeamNotFound,
  TeamPersistenceFailed,
  Teams,
} from "#contexts/connections/Teams.ts";
import type { TeamError, TeamSummary, TeamsShape } from "#contexts/connections/Teams.ts";

import { LineupRunRepository } from "./LineupRunRepository.ts";
import { toLineupRun } from "./LineupRunView.ts";
import { TeamRepository } from "./TeamRepository.ts";
import type { TeamRecord } from "./TeamRepository.ts";

const recentRunsPerTeam = 5;

export const TeamsLive = Layer.effect(
  Teams,
  Effect.gen(function* () {
    const teams = yield* TeamRepository;
    const runs = yield* LineupRunRepository;

    const summaries = (
      userId: UserId,
      records: ReadonlyArray<TeamRecord>,
    ): Effect.Effect<ReadonlyArray<TeamSummary>, TeamError> =>
      Effect.gen(function* () {
        if (records.length === 0) {
          return [];
        }
        const activity = yield* runs
          .loadTeamActivity(
            userId,
            records.map((record) => record.team.id),
            recentRunsPerTeam,
          )
          .pipe(Effect.mapError((cause) => TeamPersistenceFailed.make({ cause })));
        return records.map((record) => {
          const recentRuns: ReadonlyArray<LineupRun> = (activity.get(record.team.id) ?? []).map(
            toLineupRun,
          );
          const lastRun = recentRuns[0];
          return {
            team: record.team,
            connectionStatus: record.connection.status,
            recentRuns,
            ...(lastRun === undefined ? {} : { lastRun }),
          };
        });
      });

    const changedSummaries = (
      userId: UserId,
      changed: Effect.Effect<ReadonlyArray<FantasyTeam>, TeamError>,
      requested: ReadonlyArray<TeamId>,
    ): Effect.Effect<ReadonlyArray<TeamSummary>, TeamError> =>
      Effect.gen(function* () {
        yield* changed;
        const records = yield* teams.load(userId, requested);
        return yield* summaries(userId, records);
      });

    const list: TeamsShape["list"] = (userId) =>
      Effect.gen(function* () {
        const records = yield* teams.list(userId);
        return yield* summaries(userId, records);
      });

    const get: TeamsShape["get"] = (userId, team) =>
      Effect.gen(function* () {
        const records = yield* teams.load(userId, [team]);
        const summary = (yield* summaries(userId, records))[0];
        if (summary === undefined) {
          return yield* TeamNotFound.make({ team });
        }
        return summary;
      });

    const setEnabled: TeamsShape["setEnabled"] = (userId, inputs) =>
      changedSummaries(
        userId,
        teams.setEnabled(userId, inputs),
        inputs.map((input) => input.team),
      );

    const pause: TeamsShape["pause"] = (userId, inputs) =>
      changedSummaries(
        userId,
        teams.pause(
          userId,
          inputs.map((input) => input.team),
        ),
        inputs.map((input) => input.team),
      );

    return Teams.of({ list, get, setEnabled, pause });
  }),
);
