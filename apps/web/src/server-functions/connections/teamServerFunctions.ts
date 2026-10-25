import { LineupRunId } from "@lineupkeep/backend/connections/LineupRun";
import { LineupRuns } from "@lineupkeep/backend/connections/LineupRuns";
import { TeamEnabledInput, TeamPauseInput } from "@lineupkeep/backend/connections/Teams";
import { Teams } from "@lineupkeep/backend/connections/Teams";
import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { Effect, Schema } from "effect";

import type { TeamChangeView } from "#contracts/connections/teamContract.ts";
import { runUseCase } from "#server/backendEntry.ts";
import {
  LineupRunInputInvalid,
  TeamInputInvalid,
  mapLineupError,
  mapTeamError,
  toLineupRunView,
  toTeamSummaryView,
} from "#server/connections/teamPresentation.ts";

export const listTeamsServerFn = createServerFn({ method: "GET" }).handler(() =>
  runUseCase(
    getRequest(),
    "teams.list",
    (userId) =>
      Teams.use((teams) => teams.list(userId)).pipe(
        Effect.map((rows) => rows.map(toTeamSummaryView)),
      ),
    mapTeamError,
  ),
);

export const setTeamEnabledServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof TeamEnabledInput.Encoded) => Schema.decodeResult(TeamEnabledInput)(raw))
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "teams.set_enabled",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => TeamInputInvalid.make({})),
          );
          const changed = yield* Teams.use((teams) => teams.setEnabled(userId, [input]));
          const all = yield* Teams.use((teams) => teams.list(userId));
          return {
            changed: changed.map(toTeamSummaryView),
            teams: all.map(toTeamSummaryView),
          } satisfies TeamChangeView;
        }),
      (error) =>
        error._tag === "TeamInputInvalid"
          ? { type: "team.input_invalid", outcome: "rejected" }
          : mapTeamError(error),
    );
  });

export const pauseTeamServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof TeamPauseInput.Encoded) => Schema.decodeResult(TeamPauseInput)(raw))
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "teams.pause",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => TeamInputInvalid.make({})),
          );
          const changed = yield* Teams.use((teams) => teams.pause(userId, [input]));
          const all = yield* Teams.use((teams) => teams.list(userId));
          return {
            changed: changed.map(toTeamSummaryView),
            teams: all.map(toTeamSummaryView),
          } satisfies TeamChangeView;
        }),
      (error) =>
        error._tag === "TeamInputInvalid"
          ? { type: "team.input_invalid", outcome: "rejected" }
          : mapTeamError(error),
    );
  });

export const readLineupRunServerFn = createServerFn({ method: "POST" })
  .validator((raw: { readonly run: string }) =>
    Schema.decodeResult(Schema.Struct({ run: LineupRunId }))(raw),
  )
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "lineups.read_run",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => LineupRunInputInvalid.make({})),
          );
          const runs = yield* LineupRuns;
          const result = yield* runs.get(userId, { runs: [input.run] });
          const run = result.runs[0];
          if (run === undefined) {
            return yield* LineupRunInputInvalid.make({});
          }
          return { run: toLineupRunView(run) };
        }),
      (error) =>
        error._tag === "LineupRunInputInvalid"
          ? { type: "lineup.input_invalid", outcome: "rejected" }
          : mapLineupError(error),
    );
  });
