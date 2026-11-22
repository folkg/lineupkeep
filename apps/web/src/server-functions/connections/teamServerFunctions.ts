import { Connections } from "@lineupkeep/backend/connections/Connections";
import { FantasyQueries } from "@lineupkeep/backend/connections/FantasyQueries";
import { TeamId } from "@lineupkeep/backend/connections/FantasyTeam";
import { LineupRunId } from "@lineupkeep/backend/connections/LineupRun";
import { LineupRuns } from "@lineupkeep/backend/connections/LineupRuns";
import {
  TeamControlInput,
  TeamControlRejected,
  TeamNotFound,
  TeamNoteInput,
  Teams,
} from "@lineupkeep/backend/connections/Teams";
import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { Array, Effect, Schema } from "effect";
import { Array as EffectArray } from "effect";

import type {
  TeamChangeView,
  TeamNoteSaveResult,
  TeamRefreshView,
} from "#contracts/connections/teamContract.ts";
import { runUseCase } from "#server/backendEntry.ts";
import { toTeamOverviewView } from "#server/connections/teamOverviewPresentation.ts";
import {
  LineupRunInputInvalid,
  TeamInputInvalid,
  mapLineupError,
  mapTeamError,
  mapTeamNoteError,
  mapTeamRefreshError,
  toLineupRunView,
  toTeamNoteSaveResult,
  toTeamSummaryView,
  toTeamCardViews,
} from "#server/connections/teamPresentation.ts";

export const listTeamsServerFn = createServerFn({ method: "GET" }).handler(() =>
  runUseCase(
    getRequest(),
    "teams.list",
    (userId) =>
      Teams.use((teams) => teams.list(userId)).pipe(
        Effect.map((rows) => EffectArray.map(rows, toTeamSummaryView)),
      ),
    mapTeamError,
  ),
);

export const listTeamCardsServerFn = createServerFn({ method: "GET" }).handler(() =>
  runUseCase(
    getRequest(),
    "teams.card_facts",
    (userId) =>
      Effect.gen(function* () {
        const teams = yield* Teams.use((service) => service.list(userId));
        const read = yield* Connections.use((service) => service.readTeamCards(userId));
        return toTeamCardViews(read)(teams);
      }),
    mapTeamRefreshError,
  ),
);

export const readTeamOverviewServerFn = createServerFn({ method: "POST" })
  .validator((raw: { readonly team: string }) =>
    Schema.decodeResult(Schema.Struct({ team: TeamId }))(raw),
  )
  .handler(({ data }) =>
    runUseCase(
      getRequest(),
      "teams.overview",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => TeamInputInvalid.make({})),
          );
          const summary = yield* FantasyQueries.use((queries) =>
            queries.getTeamSummary(userId, {
              team: input.team,
              groups: ["league", "standings", "categories", "matchup"],
            }),
          );
          return toTeamOverviewView(summary);
        }),
      () => ({ type: "team.refresh_failed" as const, outcome: "failure" as const }),
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
        const yielded1 = yield* connections.list(userId);
        const ready = EffectArray.filter(yielded1, (connection) => connection.status === "ready");
        if (ready.length > 0) {
          yield* connections.discoverTeams(
            userId,
            EffectArray.map(ready, (connection) => ({ id: connection.id })),
          );
        }
        const all = yield* Teams.use((teams) => teams.list(userId));
        return { teams: EffectArray.map(all, toTeamSummaryView) } satisfies TeamRefreshView;
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
          const yielded2 = yield* Teams.use((teams) => teams.control(userId, [input]));
          const result = Array.getUnsafe(yielded2, 0);
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
                ? EffectArray.map(
                    EffectArray.filter(all, (team) => team.team.id === input.team),
                    toTeamSummaryView,
                  )
                : [],
            teams: EffectArray.map(all, toTeamSummaryView),
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

export const saveTeamNoteServerFn = createServerFn({ method: "POST" })
  .validator((raw: typeof TeamNoteInput.Encoded) => Schema.decodeResult(TeamNoteInput)(raw))
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "teams.save_note",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => TeamInputInvalid.make({})),
          );
          const saved = yield* Teams.use((teams) => teams.saveNote(userId, input)).pipe(
            Effect.map((note) => ({ _tag: "Saved" as const, note })),
            Effect.catchTag("team.note_rejected", (rejection) =>
              Effect.succeed({ _tag: "Rejected" as const, rejection }),
            ),
          );
          return (
            saved._tag === "Saved"
              ? toTeamNoteSaveResult(saved.note)
              : {
                  outcome: "rejected",
                  reason: saved.rejection.reason,
                  message: saved.rejection.message,
                }
          ) satisfies TeamNoteSaveResult;
        }),
      (error) =>
        error._tag === "TeamInputInvalid"
          ? { type: "team.input_invalid", outcome: "rejected" }
          : mapTeamNoteError(error),
    );
  });
