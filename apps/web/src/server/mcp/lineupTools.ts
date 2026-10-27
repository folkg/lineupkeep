import type { UserId } from "@lineupkeep/backend/auth/User";
import {
  GetLineupRunsInput,
  LineupRunsData,
  LineupRunStatus,
  SetLineupInput,
  type LineupError,
  type LineupSubmitData,
} from "@lineupkeep/backend/connections/LineupRun";
import { LineupRuns } from "@lineupkeep/backend/connections/LineupRuns";
import { lineupScopes } from "@lineupkeep/backend/connections/LineupScopes";
import { Effect, Schema } from "effect";
import type { Layer } from "effect";
import { Tool, Toolkit } from "effect/ai";

import { RequiredScope } from "./toolAuthorization";

const ToolFailure = Schema.Struct({ code: Schema.String, message: Schema.String });

const SetLineupResult = Schema.Struct({
  request: Schema.String,
  delivery: Schema.Literals(["queued", "pending"]),
  runs: LineupRunsData.fields.runs,
  wait: Schema.Struct({
    timeoutMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    settled: Schema.Boolean,
  }),
});
type SetLineupResult = typeof SetLineupResult.Type;

export const lineupTools = Toolkit.make(
  Tool.make("set_lineup", {
    description:
      "Create durable lineup runs for one or more owned teams and validated target periods. Lineupkeep plans the lineup from the provider's final per-player scores, and a team whose league the provider cannot value at all falls back to the provider's native start-active action. Returns a per-team durable reference, current status, implementation, and safe pending/verified explanation. Queue acceptance or an HTTP response is never reported as lineup success; use get_lineup_runs to retrieve later status. This never submits transactions, buys premium actions, or changes another person's team.",
    parameters: SetLineupInput,
    success: Schema.toCodecJson(SetLineupResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, lineupScopes.write)
    .annotate(Tool.Title, "Set lineup")
    .annotate(Tool.Readonly, false)
    .annotate(Tool.Destructive, true)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, true),
  Tool.make("get_lineup_runs", {
    description:
      "Read durable lineup run status for your own teams, including safe verified change/no-op results, pending reasons, and unresolved uncertain outcomes. Runs can be selected by private run references, a request identity, or a team.",
    parameters: GetLineupRunsInput,
    success: Schema.toCodecJson(LineupRunsData),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, lineupScopes.write)
    .annotate(Tool.Title, "Get lineup runs")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
);

export function lineupToolHandlers(
  userId: UserId,
): Layer.Layer<Tool.HandlersFor<Toolkit.Tools<typeof lineupTools>>, never, LineupRuns> {
  return lineupTools.toLayer(
    Effect.gen(function* () {
      const runs = yield* LineupRuns;
      return lineupTools.of({
        set_lineup: (input) =>
          Effect.gen(function* () {
            const submitted = yield* runs
              .submit(userId, { requestId: input.requestId, teams: input.teams })
              .pipe(mapOutcome);
            const timeoutMs = input.waitMs ?? 0;
            const settledBeforeWait = submitted.runs.every((run) => isSettled(run.status));
            const waited =
              timeoutMs === 0 || settledBeforeWait
                ? submitted
                : yield* waitBounded(userId, runs, submitted, timeoutMs);
            return {
              request: waited.request,
              delivery: waited.delivery,
              runs: waited.runs,
              wait: {
                timeoutMs,
                settled: waited.runs.every((run) => isSettled(run.status)),
              },
            } satisfies SetLineupResult;
          }),
        get_lineup_runs: (input) => runs.get(userId, input).pipe(mapOutcome),
      });
    }),
  );
}

function waitBounded(
  userId: UserId,
  runs: LineupRuns["Service"],
  submitted: LineupSubmitData,
  timeoutMs: number,
): Effect.Effect<LineupSubmitData, { code: string; message: string }, never> {
  return runs
    .wait(
      userId,
      submitted.runs.map((run) => run.run),
      timeoutMs,
    )
    .pipe(
      Effect.map((data) => ({ ...submitted, runs: data.runs })),
      mapOutcome,
    );
}

function isSettled(status: LineupRunStatus): boolean {
  switch (status) {
    case "completed":
    case "skipped":
    case "blocked":
    case "failed":
    case "uncertain":
    case "superseded":
      return true;
    case "queued":
    case "reading":
    case "planning":
    case "validating":
    case "applying":
    case "verifying":
    case "retry-wait":
      return false;
  }
}

function mapOutcome<A>(
  program: Effect.Effect<A, LineupError>,
): Effect.Effect<A, { code: string; message: string }, never> {
  return program.pipe(
    Effect.catch((error) => {
      switch (error._tag) {
        case "lineup.request_conflict":
          return reject(
            "request_conflict",
            "This request identity was already used with different lineup instructions. Use a new request identity for a different request.",
          );
        case "lineup.team_not_found":
          return reject(
            "team_not_found",
            "The selected team is not available to this account. List your teams again.",
          );
        case "lineup.connection_not_ready":
          return reject(
            "connection_not_ready",
            "The selected team's connection is not ready. Reconnect it and try again.",
          );
        case "lineup.selection_invalid":
          return reject("selection_invalid", error.detail);
        case "lineup.run_not_found":
          return reject(
            "run_not_found",
            "A selected lineup run is not available to this account. List your runs again.",
          );
        case "lineup.persistence_failed":
          return Effect.annotateCurrentSpan({
            "app.outcome": "failure",
            "error.type": error._tag,
          }).pipe(
            Effect.andThen(
              Effect.die(new Error("The lineup request could not be completed. Try again.")),
            ),
          );
      }
    }),
  );
}

function reject(
  code: string,
  message: string,
): Effect.Effect<never, { code: string; message: string }, never> {
  return Effect.annotateCurrentSpan({ "app.outcome": "rejected", "error.type": code }).pipe(
    Effect.andThen(Effect.fail({ code, message })),
  );
}
