import { Connections } from "@lineupkeep/backend/connections/Connections";
import { LineupRunId } from "@lineupkeep/backend/connections/LineupRun";
import { LineupRuns } from "@lineupkeep/backend/connections/LineupRuns";
import {
  TeamControlInput,
  TeamControlRejected,
  TeamNotFound,
  Teams,
} from "@lineupkeep/backend/connections/Teams";
import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { Array, Effect, Schema } from "effect";

import type { TeamChangeView, TeamRefreshView } from "#contracts/connections/teamContract.ts";
import { runUseCase } from "#server/backendEntry.ts";
import {
  LineupRunInputInvalid,
  TeamInputInvalid,
  mapLineupError,
  mapTeamError,
  mapTeamRefreshError,
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

export const refreshTeamsServerFn = createServerFn({ method: "POST" }).handler(() => {
  const request = getRequest();
  return runUseCase(
    request,
    "teams.refresh",
    (userId) =>
      Effect.gen(function* () {
        const connections = yield* Connections;
        const ready = (yield* connections.list(userId)).filter(
          (connection) => connection.status === "ready",
        );
        if (ready.length > 0) {
          yield* connections.discoverTeams(
            userId,
            ready.map((connection) => ({ id: connection.id })),
          );
        }
        const all = yield* Teams.use((teams) => teams.list(userId));
        return { teams: all.map(toTeamSummaryView) } satisfies TeamRefreshView;
      }),
    mapTeamRefreshError,
  );
});

export const controlTeamServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof TeamControlInput.Encoded) => Schema.decodeResult(TeamControlInput)(raw))
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "teams.control",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => TeamInputInvalid.make({})),
          );
          yield* Effect.annotateCurrentSpan({ "automation.action": input.action });
          const result = Array.getUnsafe(
            yield* Teams.use((teams) => teams.control(userId, [input])),
            0,
          );
          switch (result.outcome) {
            case "not_found":
              return yield* TeamNotFound.make({ team: input.team });
            case "rejected":
              return yield* TeamControlRejected.make({
                team: input.team,
                status: result.automation.status,
              });
            case "changed":
            case "unchanged":
              break;
          }
          const all = yield* Teams.use((teams) => teams.list(userId));
          return {
            changed:
              result.outcome === "changed"
                ? all.filter((team) => team.team.id === input.team).map(toTeamSummaryView)
                : [],
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
