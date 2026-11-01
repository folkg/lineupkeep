import { DateTime, Duration, Effect, Layer, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type {
  GetLineupRunsInput,
  LineupError,
  LineupRequestInput,
  LineupRun,
  LineupRunsData,
  LineupSubmitData,
} from "#contexts/connections/LineupRun.ts";
import {
  LineupConnectionNotReady,
  LineupPersistenceFailed,
  LineupRequestConflict,
  LineupRunNotFound,
  LineupSelectionInvalid,
  LineupTeamNotFound,
} from "#contexts/connections/LineupRun.ts";
import { LineupRuns } from "#contexts/connections/LineupRuns.ts";
import type { LineupRunsShape } from "#contexts/connections/LineupRuns.ts";
import { LineupDispatcher } from "#contexts/connections/LineupWork.ts";

import type { NewLineupRun, RunQuery } from "./LineupRunRepository.ts";
import { LineupRunRepository } from "./LineupRunRepository.ts";
import { isSettled, toLineupRun } from "./LineupRunViewRepository.ts";
import { QueryRepository } from "./QueryRepository.ts";
import type { OwnedTeam } from "./QueryRepository.ts";

const defaultRunLimit = 20;
const waitPollMillis = 200;

export const LineupRunsLive = Layer.effect(
  LineupRuns,
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const queries = yield* QueryRepository;
    const dispatcher = yield* LineupDispatcher;

    const submit: LineupRunsShape["submit"] = Effect.fn("LineupRuns.submit")(function* (
      userId: UserId,
      input: LineupRequestInput,
    ) {
      const teams = yield* validateTeams(queries, userId, input);
      const intent = canonicalIntent(input);
      const created = yield* repository
        .createRequest({
          userId,
          requestId: input.requestId,
          intent,
          runs: teams.map(({ owned, request }): NewLineupRun => ({
            team: owned.team.id,
            connectionId: owned.team.connectionId,
            target: request.period,
            trigger: "manual",
          })),
        })
        .pipe(mapRepositoryError);

      const delivery = yield* dispatcher
        .dispatchRequest(userId, input.requestId)
        .pipe(
          Effect.catchTag("lineup.persistence_failed", () => Effect.succeed("pending" as const)),
        );
      const runIds = created.runs.map((run) => run.id);
      const loaded = yield* repository
        .loadRuns(userId, { runs: runIds, limit: runIds.length })
        .pipe(mapRepositoryError);
      yield* Effect.annotateCurrentSpan({
        "lineup.request": input.requestId,
        "lineup.run_count": loaded.runs.length,
        "lineup.delivery": delivery,
        "lineup.replayed": !created.created,
      });
      return {
        request: input.requestId,
        delivery,
        runs: loaded.runs.map(toLineupRun),
      } satisfies LineupSubmitData;
    });

    const get = Effect.fn("LineupRuns.get")(function* (userId: UserId, input: GetLineupRunsInput) {
      const limit = Math.max(input.limit ?? defaultRunLimit, input.runs?.length ?? 0);
      const query: RunQuery = {
        ...(input.runs === undefined ? {} : { runs: input.runs }),
        ...(input.request === undefined ? {} : { request: input.request }),
        ...(input.team === undefined ? {} : { team: input.team }),
        limit,
      };
      const result = yield* repository.loadRuns(userId, query).pipe(mapRepositoryError);
      if (input.runs !== undefined && !result.complete) {
        const found = new Set(result.runs.map((run) => run.id));
        const missing = input.runs.find((id) => !found.has(id));
        if (missing !== undefined) {
          return yield* LineupRunNotFound.make({ run: missing });
        }
      }
      return {
        status: "ok" as const,
        runs: result.runs.map(toLineupRun),
        observedAt: yield* DateTime.now,
        page: { returned: result.runs.length, complete: result.complete },
      } satisfies LineupRunsData;
    });

    const wait = Effect.fn("LineupRuns.wait")(function* (
      userId: UserId,
      runIds: ReadonlyArray<LineupRun["run"]>,
      timeoutMs: number,
    ) {
      const deadline = DateTime.addDuration(yield* DateTime.now, timeoutMs);
      for (;;) {
        const data = yield* get(userId, { runs: runIds, limit: runIds.length });
        if (data.runs.every((run) => isSettled(run.status))) {
          return data;
        }
        const now = yield* DateTime.now;
        if (DateTime.toEpochMillis(now) >= DateTime.toEpochMillis(deadline)) {
          return data;
        }
        const remaining = DateTime.toEpochMillis(deadline) - DateTime.toEpochMillis(now);
        yield* Effect.sleep(Duration.millis(Math.min(waitPollMillis, remaining)));
      }
    });

    const shape: LineupRunsShape = { submit, get, wait };
    return LineupRuns.of(shape);
  }),
);

function validateTeams(
  queries: QueryRepository["Service"],
  userId: UserId,
  input: LineupRequestInput,
): Effect.Effect<
  ReadonlyArray<{
    readonly owned: OwnedTeam;
    readonly request: LineupRequestInput["teams"][number];
  }>,
  LineupError
> {
  return Effect.gen(function* () {
    const ids = input.teams.map((team) => team.team);
    if (new Set(ids).size !== ids.length) {
      return yield* LineupSelectionInvalid.make({
        detail: "Each team may appear once in a lineup request.",
      });
    }
    const owned = yield* queries.loadOwnedTeams(userId, ids).pipe(
      Effect.mapError((cause): LineupError => {
        switch (cause._tag) {
          case "query.team_not_found":
            return LineupTeamNotFound.make({ team: cause.team });
          case "query.connection_not_ready":
            return LineupConnectionNotReady.make({ team: cause.team, status: cause.status });
          case "query.persistence_failed":
            return LineupPersistenceFailed.make({ cause: cause.cause });
        }
      }),
    );
    const byTeam = new Map(owned.map((entry) => [entry.team.id, entry]));
    const selected: Array<{
      readonly owned: OwnedTeam;
      readonly request: LineupRequestInput["teams"][number];
    }> = [];
    for (const request of input.teams) {
      const entry = byTeam.get(request.team);
      if (entry === undefined) {
        return yield* LineupTeamNotFound.make({ team: request.team });
      }
      selected.push({ owned: entry, request });
    }
    return selected;
  });
}

function canonicalIntent(input: LineupRequestInput): string {
  const teams = [...input.teams]
    .sort((left, right) => left.team.localeCompare(right.team))
    .map((team) => ({ team: team.team, period: team.period }));
  return JSON.stringify({ teams });
}

function mapRepositoryError<A, E>(effect: Effect.Effect<A, E>): Effect.Effect<A, LineupError> {
  return effect.pipe(
    Effect.mapError((cause) => {
      if (Schema.is(LineupRequestConflict)(cause)) {
        return cause;
      }
      if (Schema.is(LineupPersistenceFailed)(cause)) {
        return cause;
      }
      return LineupPersistenceFailed.make({ cause });
    }),
  );
}
