import { and, asc, desc, eq, gte, isNull, lte, ne, notInArray, or } from "drizzle-orm";
import { Array, Context, DateTime, Effect, Equal, Layer, Option, Schema } from "effect";
import { SecureRandom } from "effect/crypto";

import { UserId } from "#contexts/auth/User.ts";
import { ConnectionId } from "#contexts/connections/Connection.ts";
import { TeamId } from "#contexts/connections/FantasyTeam.ts";
import type { LineupRunOutcome } from "#contexts/connections/LineupRun.ts";
import {
  activeLineupImplementation,
  customLineupImplementation,
  customPolicyImplementationVersion,
  LineupPersistenceFailed,
  LineupRequestConflict,
  LineupRequestId,
  LineupRunId,
  LineupId,
  providerNativeImplementationVersion,
} from "#contexts/connections/LineupRun.ts";
import type {
  LineupImplementation,
  LineupTargetPeriod,
  LineupTrigger,
} from "#contexts/connections/LineupRun.ts";
import { anyOf, maxInsertRows, mutateRows, runningRunPredicate } from "#database/dbUtilities.ts";
import { retentionPolicy } from "#retention/RetentionPolicy.ts";
import { chunked } from "#utilities/collections.ts";
import { plan, snapshotOf } from "#utilities/machine.ts";

import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import { providerConnections, providerCredentials, providerTeams } from "./ConnectionTables.ts";
import {
  initialLineupDeliveryState,
  lineupDeliveryState,
  lineupDeliveryStatus,
  LineupDeliveryWorkflow,
} from "./LineupDeliveryWorkflow.ts";
import type { LineupDeliveryEvent, LineupDeliveryState } from "./LineupDeliveryWorkflow.ts";
import {
  LineupDeliveryRow,
  LineupRunRow,
  LineupWriteIntentRow,
  lineupDeliveries,
  lineupRequests,
  lineupRunAttempts,
  lineupRunDiagnostics,
  lineupRuns,
  lineupTeamLeases,
  lineupWriteIntents,
} from "./LineupRunTables.ts";
import type {
  LineupDeliveryRecord,
  LineupRunRecord,
  LineupWriteIntentRecord,
} from "./LineupRunTables.ts";

export type { LineupWriteIntentRecord };
import { Array as EffectArray } from "effect";
import { Option as EffectOption } from "effect";

import { toLineupRun } from "./LineupRunViewRepository.ts";
import {
  LineupPlan,
  LineupRunState,
  LineupRunWorkflow,
  lineupRunStatus,
} from "./LineupRunWorkflow.ts";
import { LineupObservation } from "./LineupRunWorkflow.ts";
import type {
  LineupLeaseRef,
  LineupRunEvent,
  LineupWriteIntentStatus,
} from "./LineupRunWorkflow.ts";
import { TeamAutomationState } from "./TeamAutomationWorkflow.ts";

function arrayValueIsArray<A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> {
  return EffectArray.isArray(value);
}

const lineupLeaseDurationMillis = 10 * 60_000;
const lineupDeliveryStaleMillis = 60_000;
const lineupQueuedStaleMillis = 120_000;

export type NewLineupRun = {
  readonly team: TeamId;
  readonly connectionId: ConnectionId;
  readonly target: LineupTargetPeriod;
  readonly trigger: LineupTrigger;
};

type CreatedLineupRequest = {
  readonly created: boolean;
  readonly runs: ReadonlyArray<LineupRunRecord>;
};

type TeamActivityRecord = {
  readonly runs: ReadonlyArray<LineupRunRecord>;
  readonly latest: LineupRunRecord;
};

const nonTerminalRunStatuses = [
  "queued",
  "reading",
  "planning",
  "validating",
  "applying",
  "verifying",
  "retry-wait",
  "uncertain",
] as const;

export type NewScheduledLineupRun = {
  readonly team: TeamId;
  readonly connectionId: ConnectionId;
};

export type ClaimedLineupRun = {
  readonly record: LineupRunRecord;
  readonly lease: LineupLeaseRef;
  readonly attempt: number;
  readonly resumeVerification: boolean;
};

export type RunQuery = {
  readonly runs?: ReadonlyArray<LineupRunId>;
  readonly request?: LineupRequestId;
  readonly team?: TeamId;
  readonly limit: number;
};

type Transaction = Parameters<Parameters<ConnectionsDatabase["Service"]["transaction"]>[0]>[0];

export class LineupRunRepository extends Context.Service<LineupRunRepository>()(
  "@lineupkeep/backend/contexts/connections/internal/LineupRunRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;
      const random = yield* SecureRandom.SecureRandom;

      const newId = random.ulid;

      const createRequest = Effect.fn("LineupRunRepository.createRequest")(function* (input: {
        readonly userId: UserId;
        readonly requestId: LineupRequestId;
        readonly intent: string;
        readonly runs: ReadonlyArray<NewLineupRun>;
      }) {
        const now = yield* DateTime.now;
        const at = DateTime.toDateUtc(now);
        const deliveryId = yield* newId;
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const inserted = yield* tx
                .insert(lineupRequests)
                .values({
                  userId: input.userId,
                  id: input.requestId,
                  intent: input.intent,
                  createdAt: at,
                  updatedAt: at,
                })
                .onConflictDoNothing({
                  target: [lineupRequests.userId, lineupRequests.id],
                })
                .returning({ id: lineupRequests.id });

              if (inserted.length === 0) {
                const existing = yield* tx
                  .select()
                  .from(lineupRequests)
                  .where(
                    and(
                      eq(lineupRequests.userId, input.userId),
                      eq(lineupRequests.id, input.requestId),
                    ),
                  )
                  .limit(1)
                  .for("update");
                const request = existing[0];
                if (request === undefined || request.intent !== input.intent) {
                  return yield* LineupRequestConflict.make({ request: input.requestId });
                }
                return {
                  created: false,
                  runs: yield* loadRequestRuns(tx, input.userId, input.requestId),
                };
              }

              const records: ReadonlyArray<LineupRunRecord> = yield* Effect.forEach(
                input.runs,
                (run) =>
                  Effect.gen(function* () {
                    const implementation = activeLineupImplementation;
                    const state: LineupRunState = {
                      _tag: "Queued",
                      team: run.team,
                      target: run.target,
                      trigger: run.trigger,
                      implementation,
                      implementationVersion: implementationVersionOf(implementation),
                      queuedAt: now,
                      updatedAt: now,
                    };
                    const yielded1 = yield* newId;
                    return {
                      id: yield* Schema.decodeEffect(LineupRunId)(yielded1),
                      userId: input.userId,
                      requestId: input.requestId,
                      teamId: run.team,
                      connectionId: run.connectionId,
                      trigger: run.trigger,
                      scheduleKey: null,
                      target: run.target,
                      status: lineupRunStatus(state),
                      state,
                      implementation,
                      implementationVersion: implementationVersionOf(implementation),
                      attempts: 0,
                      nextActionAt: null,
                      createdAt: now,
                      updatedAt: now,
                    } satisfies LineupRunRecord;
                  }),
                { concurrency: 1 },
              );

              const rows = yield* Effect.forEach(
                records,
                (record) => Schema.encodeEffect(LineupRunRow)(record),
                { concurrency: 1 },
              );
              const insertedRows = yield* chunked(rows, maxInsertRows(lineupRuns), (chunk) =>
                tx.insert(lineupRuns).values(chunk).onConflictDoNothing().returning({
                  id: lineupRuns.id,
                }),
              );
              const insertedIds = new Set(EffectArray.map(insertedRows, (row) => row.id));
              const created = EffectArray.filter(records, (record) => insertedIds.has(record.id));
              const refused = EffectArray.filter(records, (record) => !insertedIds.has(record.id));
              const refusedTeams = [
                ...new Set(EffectArray.map(refused, (record) => record.teamId)),
              ];
              const waiting = !Array.isArrayNonEmpty(refusedTeams)
                ? []
                : yield* tx
                    .select()
                    .from(lineupRuns)
                    .where(
                      and(
                        eq(lineupRuns.userId, input.userId),
                        anyOf(lineupRuns.teamId, refusedTeams),
                        eq(lineupRuns.status, "queued"),
                      ),
                    )
                    .orderBy(desc(lineupRuns.createdAt))
                    .for("update");
              const joined = new Map<string, LineupRunRecord>();
              for (const row of waiting) {
                const record = yield* decodeRun(row);
                const requested = EffectOption.getOrUndefined(
                  EffectArray.findFirst(refused, (entry) => entry.teamId === record.teamId),
                );
                if (requested !== undefined && Equal.equals(requested.target, record.target)) {
                  joined.set(record.teamId, record);
                }
              }
              if (created.length > 0) {
                const state = initialLineupDeliveryState(now);
                yield* tx.insert(lineupDeliveries).values({
                  id: deliveryId,
                  userId: input.userId,
                  requestId: input.requestId,
                  ...deliveryRowProjection(state),
                  runIds: EffectArray.map(created, (record) => record.id),
                  createdAt: at,
                });
              }
              const settled = EffectArray.flatMap(input.runs, (run) => {
                const record = EffectOption.getOrUndefined(
                  EffectArray.findFirst(created, (entry) => entry.teamId === run.team),
                );
                if (record !== undefined) {
                  return [record];
                }
                const waitingRun = joined.get(run.team);
                return waitingRun === undefined ? [] : [waitingRun];
              });
              yield* Effect.annotateCurrentSpan("lineup.run_count", created.length);
              yield* Effect.annotateCurrentSpan(
                "lineup.run_joined_count",
                settled.length - created.length,
              );
              return { created: created.length > 0, runs: settled } satisfies CreatedLineupRequest;
            }),
          )
          .pipe(
            Effect.mapError((cause) =>
              Schema.is(LineupRequestConflict)(cause)
                ? cause
                : LineupPersistenceFailed.make({ cause }),
            ),
          );
      });

      const createScheduledRuns = Effect.fn("LineupRunRepository.createScheduledRuns")(
        function* (input: {
          readonly userId: UserId;
          readonly at: DateTime.Utc;
          readonly runs: ReadonlyArray<NewScheduledLineupRun>;
        }) {
          if (input.runs.length === 0) {
            return { created: false, runs: [] as ReadonlyArray<LineupRunRecord> };
          }
          return yield* Effect.gen(function* () {
            const [requestId, deliveryId] = yield* Effect.all(
              [newId.pipe(Effect.flatMap((id) => Schema.decodeEffect(LineupRequestId)(id))), newId],
              { concurrency: 1 },
            );
            const at = DateTime.toDateUtc(input.at);
            const records: ReadonlyArray<LineupRunRecord> = yield* Effect.forEach(
              input.runs,
              (run) =>
                Effect.gen(function* () {
                  const implementation = activeLineupImplementation;
                  const state: LineupRunState = {
                    _tag: "Queued",
                    team: run.team,
                    target: { coverage: "current" },
                    trigger: "scheduled",
                    implementation,
                    implementationVersion: implementationVersionOf(implementation),
                    queuedAt: input.at,
                    updatedAt: input.at,
                  };
                  const yielded2 = yield* newId;
                  return {
                    id: yield* Schema.decodeEffect(LineupRunId)(yielded2),
                    userId: input.userId,
                    requestId,
                    teamId: run.team,
                    connectionId: run.connectionId,
                    trigger: "scheduled" as const,
                    scheduleKey: hourKey(input.at),
                    target: { coverage: "current" as const },
                    status: lineupRunStatus(state),
                    state,
                    implementation,
                    implementationVersion: implementationVersionOf(implementation),
                    attempts: 0,
                    nextActionAt: null,
                    createdAt: input.at,
                    updatedAt: input.at,
                  } satisfies LineupRunRecord;
                }),
              { concurrency: 1 },
            );
            const rows = yield* Effect.forEach(
              records,
              (record) => Schema.encodeEffect(LineupRunRow)(record),
              { concurrency: 1 },
            );
            return yield* database.transaction((tx) =>
              Effect.gen(function* () {
                const inserted = yield* tx
                  .insert(lineupRuns)
                  .values(rows)
                  .onConflictDoNothing()
                  .returning();
                if (inserted.length === 0) {
                  return { created: false, runs: [] as ReadonlyArray<LineupRunRecord> };
                }
                const created = yield* Effect.forEach(inserted, (row) => decodeRun(row), {
                  concurrency: 1,
                });
                const intent = yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))({
                  trigger: "scheduled",
                  target: { coverage: "current" },
                });
                yield* tx.insert(lineupRequests).values({
                  userId: input.userId,
                  id: requestId,
                  intent,
                  createdAt: at,
                  updatedAt: at,
                });
                yield* tx.insert(lineupDeliveries).values({
                  id: deliveryId,
                  userId: input.userId,
                  requestId,
                  ...deliveryRowProjection(initialLineupDeliveryState(input.at)),
                  runIds: EffectArray.map(created, (record) => record.id),
                  createdAt: at,
                });
                return { created: true, runs: created };
              }),
            );
          }).pipe(Effect.mapError(mapPersistenceFailure));
        },
      );

      const createScheduledRunsForOwners = Effect.fn(
        "LineupRunRepository.createScheduledRunsForOwners",
      )(function* (
        inputs: ReadonlyArray<{
          readonly userId: UserId;
          readonly at: DateTime.Utc;
          readonly runs: ReadonlyArray<NewScheduledLineupRun>;
        }>,
      ) {
        const results: Array<{
          readonly created: boolean;
          readonly runs: ReadonlyArray<LineupRunRecord>;
        }> = [];
        for (const input of inputs) {
          const yielded3 = yield* createScheduledRuns(input);
          results.push(yielded3);
        }
        return results;
      });

      const scheduledTeamIds = Effect.fn("LineupRunRepository.scheduledTeamIds")(function* (
        teamIds: ReadonlyArray<TeamId>,
      ) {
        const ids = [...new Set(teamIds)];
        if (!Array.isArrayNonEmpty(ids)) {
          return new Set<TeamId>();
        }
        const rows = yield* database
          .selectDistinct({ teamId: lineupRuns.teamId })
          .from(lineupRuns)
          .where(
            and(anyOf(lineupRuns.teamId, ids), anyOf(lineupRuns.status, nonTerminalRunStatuses)),
          )
          .pipe(Effect.mapError(mapPersistenceFailure));
        return new Set(EffectArray.map(rows, (row) => row.teamId));
      });

      const loadRuns = Effect.fn("LineupRunRepository.loadRuns")(function* (
        userId: UserId,
        query: RunQuery,
      ) {
        const ids = query.runs === undefined ? [] : [...new Set(query.runs)];
        const filters = [eq(lineupRuns.userId, userId)];
        if (Array.isArrayNonEmpty(ids)) {
          filters.push(anyOf(lineupRuns.id, ids));
        }
        if (query.request !== undefined) {
          filters.push(eq(lineupRuns.requestId, query.request));
        }
        if (query.team !== undefined) {
          filters.push(eq(lineupRuns.teamId, query.team));
        }
        const rows = yield* database
          .select()
          .from(lineupRuns)
          .where(and(...filters))
          .orderBy(desc(lineupRuns.createdAt), asc(lineupRuns.id))
          .limit(query.limit + 1)
          .pipe(Effect.mapError(mapPersistenceFailure));
        const records = yield* Effect.forEach(rows.slice(0, query.limit), (row) => decodeRun(row), {
          concurrency: 1,
        });
        if (query.runs !== undefined) {
          const byId = new Map(EffectArray.map(records, (record) => [record.id, record]));
          const ordered = EffectArray.flatMap(query.runs, (id) => {
            const record = byId.get(id);
            return record === undefined ? [] : [record];
          });
          return { runs: ordered, complete: ordered.length === query.runs.length };
        }
        return { runs: records, complete: rows.length <= query.limit };
      });

      const loadTeamActivity = Effect.fn("LineupRunRepository.loadTeamActivity")(function* (
        userId: UserId,
        teamIds: ReadonlyArray<TeamId>,
        since: DateTime.Utc,
      ) {
        const ids = [...new Set(teamIds)];
        if (!Array.isArrayNonEmpty(ids)) {
          return new Map<TeamId, TeamActivityRecord>();
        }
        const rows = yield* database
          .select()
          .from(lineupRuns)
          .where(
            and(
              eq(lineupRuns.userId, userId),
              anyOf(lineupRuns.teamId, ids),
              gte(lineupRuns.createdAt, DateTime.toDateUtc(since)),
            ),
          )
          .orderBy(asc(lineupRuns.teamId), desc(lineupRuns.createdAt), asc(lineupRuns.id))
          .pipe(Effect.mapError(mapPersistenceFailure));
        const grouped = new Map<TeamId, Array<LineupRunRecord>>();
        for (const row of rows) {
          const record = yield* decodeRun(row);
          const existing = grouped.get(record.teamId) ?? [];
          existing.push(record);
          grouped.set(record.teamId, existing);
        }
        const activity = new Map<TeamId, TeamActivityRecord>();
        for (const [teamId, runs] of grouped) {
          const latest = runs[0];
          if (latest !== undefined) {
            activity.set(teamId, { runs, latest });
          }
        }
        const missing = EffectArray.filter(ids, (teamId) => !activity.has(teamId));
        if (Array.isArrayNonEmpty(missing)) {
          const latestRows = yield* database
            .selectDistinctOn([lineupRuns.teamId])
            .from(lineupRuns)
            .where(and(eq(lineupRuns.userId, userId), anyOf(lineupRuns.teamId, missing)))
            .orderBy(asc(lineupRuns.teamId), desc(lineupRuns.createdAt), asc(lineupRuns.id))
            .pipe(Effect.mapError(mapPersistenceFailure));
          for (const row of latestRows) {
            const latest = yield* decodeRun(row);
            activity.set(latest.teamId, { runs: [], latest });
          }
        }
        return activity;
      });

      const loadTeamRunsSince = Effect.fn("LineupRunRepository.loadTeamRunsSince")(
        function* (input: {
          readonly userId: UserId;
          readonly team: TeamId;
          readonly since: DateTime.Utc;
          readonly excluding: LineupRunId;
        }) {
          const rows = yield* database
            .select()
            .from(lineupRuns)
            .where(
              and(
                eq(lineupRuns.userId, input.userId),
                eq(lineupRuns.teamId, input.team),
                gte(lineupRuns.createdAt, DateTime.toDateUtc(input.since)),
                ne(lineupRuns.id, input.excluding),
              ),
            )
            .orderBy(desc(lineupRuns.createdAt), asc(lineupRuns.id))
            .pipe(Effect.mapError(mapPersistenceFailure));
          const records = yield* Effect.forEach(rows, (row) => decodeRun(row), { concurrency: 1 });
          return EffectArray.map(records, toLineupRun);
        },
      );

      const loadRunConnections = Effect.fn("LineupRunRepository.loadRunConnections")(function* (
        runIds: ReadonlyArray<LineupRunId>,
      ) {
        const ids = [...new Set(runIds)];
        if (!Array.isArrayNonEmpty(ids)) {
          return [];
        }
        const rows = yield* database
          .select({
            run: lineupRuns.id,
            userId: lineupRuns.userId,
            connectionId: lineupRuns.connectionId,
          })
          .from(lineupRuns)
          .where(anyOf(lineupRuns.id, ids))
          .pipe(Effect.mapError(mapPersistenceFailure));
        return yield* Effect.forEach(
          rows,
          (row) =>
            Effect.all(
              [
                Schema.decodeEffect(LineupRunId)(row.run),
                Schema.decodeEffect(UserId)(row.userId),
                Schema.decodeEffect(ConnectionId)(row.connectionId),
              ],
              { concurrency: 1 },
            ).pipe(
              Effect.map(([run, userId, connectionId]) => ({ run, userId, connectionId })),
              Effect.mapError(mapPersistenceFailure),
            ),
          { concurrency: 1 },
        );
      });

      const claim = Effect.fn("LineupRunRepository.claim")(function* (
        runId: LineupRunId,
        now: DateTime.Utc,
      ) {
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const rows = yield* tx
                .select()
                .from(lineupRuns)
                .where(eq(lineupRuns.id, runId))
                .limit(1)
                .for("update");
              const row = rows[0];
              if (row === undefined) {
                return Option.none<ClaimedLineupRun>();
              }
              const yielded4 = yield* decodeRun(row);
              const record = alignClaimedImplementation(yielded4, activeLineupImplementation);
              const state = record.state;
              if (isTerminal(state)) {
                return Option.none<ClaimedLineupRun>();
              }
              if (state._tag === "RetryWait") {
                if (DateTime.toEpochMillis(state.retryAt) > DateTime.toEpochMillis(now)) {
                  return Option.none<ClaimedLineupRun>();
                }
              }
              if (state._tag === "Uncertain" && state.writeIntent === undefined) {
                return Option.none<ClaimedLineupRun>();
              }
              const existingLease = yield* tx
                .select()
                .from(lineupTeamLeases)
                .where(eq(lineupTeamLeases.teamId, record.teamId))
                .limit(1)
                .for("update");
              const leaseRow = existingLease[0];
              if (
                leaseRow !== undefined &&
                DateTime.toEpochMillis(DateTime.fromDateUnsafe(leaseRow.expiresAt)) >
                  DateTime.toEpochMillis(now)
              ) {
                return Option.none<ClaimedLineupRun>();
              }

              const attempt = record.attempts + 1;
              const yielded5 = yield* newId;
              const lease: LineupLeaseRef = {
                token: yield* Schema.decodeEffect(LineupId)(yielded5),
                generation: (leaseRow?.generation ?? 0) + 1,
              };
              const expiresAt = DateTime.addDuration(now, lineupLeaseDurationMillis);
              if (leaseRow === undefined) {
                yield* tx.insert(lineupTeamLeases).values({
                  teamId: record.teamId,
                  userId: record.userId,
                  runId: record.id,
                  token: lease.token,
                  generation: lease.generation,
                  expiresAt: DateTime.toDateUtc(expiresAt),
                  updatedAt: DateTime.toDateUtc(now),
                });
              } else {
                yield* tx
                  .update(lineupTeamLeases)
                  .set({
                    userId: record.userId,
                    runId: record.id,
                    token: lease.token,
                    generation: lease.generation,
                    expiresAt: DateTime.toDateUtc(expiresAt),
                    updatedAt: DateTime.toDateUtc(now),
                  })
                  .where(eq(lineupTeamLeases.teamId, record.teamId));
              }

              const event = claimEvent(state, lease, attempt, now);
              const next = yield* planState(state, event.event);
              yield* tx.insert(lineupRunAttempts).values({
                runId: record.id,
                attempt,
                leaseToken: lease.token,
                leaseGeneration: lease.generation,
                startedAt: DateTime.toDateUtc(now),
                finishedAt: null,
                outcome: null,
              });
              yield* updateRunState(tx, record, next, now, attempt);
              yield* Effect.annotateCurrentSpan("lineup.attempt", attempt);
              return Option.some<ClaimedLineupRun>({
                record: {
                  ...record,
                  state: next,
                  status: lineupRunStatus(next),
                  attempts: attempt,
                },
                lease,
                attempt,
                resumeVerification: event.resumeVerification,
              });
            }),
          )
          .pipe(Effect.mapError(mapPersistenceFailure));
      });

      const loadWriteIntent = (
        intentId: string,
      ): Effect.Effect<LineupWriteIntentRecord | undefined, LineupPersistenceFailed> =>
        Effect.gen(function* () {
          const rows = yield* database
            .select()
            .from(lineupWriteIntents)
            .where(eq(lineupWriteIntents.id, intentId))
            .limit(1);
          const row = rows[0];
          return row === undefined
            ? undefined
            : yield* Schema.decodeEffect(LineupWriteIntentRow)(row);
        }).pipe(
          Effect.mapError((cause) =>
            Schema.is(LineupPersistenceFailed)(cause)
              ? cause
              : LineupPersistenceFailed.make({ cause }),
          ),
          Effect.withSpan("LineupRunRepository.loadWriteIntent"),
        );

      const unresolvedWriteIntent = (
        userId: UserId,
        teamId: TeamId,
        excludingRun: LineupRunId,
      ): Effect.Effect<boolean, LineupPersistenceFailed> =>
        Effect.gen(function* () {
          const rows = yield* database
            .select({ id: lineupWriteIntents.id })
            .from(lineupWriteIntents)
            .where(
              and(
                eq(lineupWriteIntents.userId, userId),
                eq(lineupWriteIntents.teamId, teamId),
                anyOf(lineupWriteIntents.status, ["intended", "accepted", "unknown"]),
                ne(lineupWriteIntents.runId, excludingRun),
              ),
            )
            .limit(1);
          return rows[0] !== undefined;
        }).pipe(
          Effect.mapError((cause) =>
            Schema.is(LineupPersistenceFailed)(cause)
              ? cause
              : LineupPersistenceFailed.make({ cause }),
          ),
          Effect.withSpan("LineupRunRepository.unresolvedWriteIntent"),
        );

      const beginApply = Effect.fn("LineupRunRepository.beginApply")(function* (input: {
        readonly runId: LineupRunId;
        readonly lease: LineupLeaseRef;
        readonly at: DateTime.Utc;
        readonly plan: LineupPlan;
        readonly before: LineupObservation["players"];
      }) {
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const record = yield* lockClaimedRun(tx, input.runId, input.lease);
              if (record === undefined || record.state._tag !== "Validating") {
                return { status: "stale" as const };
              }
              const control = yield* tx
                .select({
                  automationState: providerTeams.automationState,
                })
                .from(providerTeams)
                .where(
                  and(eq(providerTeams.userId, record.userId), eq(providerTeams.id, record.teamId)),
                )
                .limit(1);
              const ownedControl = control[0];
              const automation =
                ownedControl === undefined
                  ? undefined
                  : yield* Schema.decodeUnknownEffect(Schema.toCodecJson(TeamAutomationState))(
                      ownedControl.automationState,
                    ).pipe(Effect.mapError(mapPersistenceFailure));
              if (
                ownedControl === undefined ||
                (record.trigger === "scheduled" && automation?._tag !== "Enabled")
              ) {
                return { status: "blocked" as const, reason: "controls_changed" as const };
              }
              const connection = yield* tx
                .select({
                  status: providerConnections.status,
                  generation: providerCredentials.generation,
                })
                .from(providerConnections)
                .innerJoin(
                  providerCredentials,
                  and(
                    eq(providerCredentials.connectionId, providerConnections.id),
                    eq(providerCredentials.userId, record.userId),
                  ),
                )
                .where(
                  and(
                    eq(providerConnections.userId, record.userId),
                    eq(providerConnections.id, record.connectionId),
                  ),
                )
                .limit(1);
              const ownedConnection = connection[0];
              if (
                ownedConnection === undefined ||
                ownedConnection.status !== "ready" ||
                ownedConnection.generation !== input.plan.connectionGeneration
              ) {
                return { status: "blocked" as const, reason: "connection_changed" as const };
              }
              const prior = yield* tx
                .select({ id: lineupWriteIntents.id })
                .from(lineupWriteIntents)
                .where(
                  and(
                    eq(lineupWriteIntents.userId, record.userId),
                    eq(lineupWriteIntents.teamId, record.teamId),
                    anyOf(lineupWriteIntents.status, ["intended", "accepted", "unknown"]),
                    ne(lineupWriteIntents.runId, input.runId),
                  ),
                )
                .limit(1);
              if (prior[0] !== undefined) {
                return { status: "blocked" as const, reason: "unresolved_prior_write" as const };
              }

              const yielded6 = yield* newId;
              const intentId = yield* Schema.decodeEffect(LineupId)(yielded6);
              const plan = yield* Schema.encodeEffect(Schema.toCodecJson(LineupPlan))(
                input.plan,
              ).pipe(Effect.mapError(mapPersistenceFailure));
              const inserted = yield* tx
                .insert(lineupWriteIntents)
                .values({
                  id: intentId,
                  runId: record.id,
                  attempt: record.attempts,
                  userId: record.userId,
                  teamId: record.teamId,
                  connectionId: record.connectionId,
                  connectionGeneration: input.plan.connectionGeneration,
                  leaseToken: input.lease.token,
                  leaseGeneration: input.lease.generation,
                  action: input.plan._tag,
                  target: input.plan.target,
                  before: input.before,
                  plan,
                  status: "intended",
                  createdAt: DateTime.toDateUtc(input.at),
                  updatedAt: DateTime.toDateUtc(input.at),
                })
                .returning();
              const intentRow = inserted[0];
              if (intentRow === undefined) {
                return yield* Effect.die(new Error("Lineup write intent insert returned no row"));
              }
              const intent = yield* Schema.decodeEffect(LineupWriteIntentRow)(intentRow);
              const next = yield* planState(record.state, {
                _tag: "ApplyStarted",
                at: input.at,
                writeIntent: { id: intent.id, attempt: intent.attempt, status: "intended" },
              });
              yield* updateRunState(tx, record, next, input.at, record.attempts);
              return { status: "started" as const, intent };
            }),
          )
          .pipe(Effect.mapError(mapPersistenceFailure));
      });

      const recordObservation = Effect.fn("LineupRunRepository.recordObservation")(
        function* (input: {
          readonly runId: LineupRunId;
          readonly lease: LineupLeaseRef;
          readonly observation: LineupObservation;
          readonly at: DateTime.Utc;
        }) {
          const diagnosticId = yield* newId.pipe(Effect.mapError(mapPersistenceFailure));
          yield* mutateClaimed(input.runId, input.lease, (record, tx) =>
            Effect.gen(function* () {
              yield* transition(
                tx,
                record,
                { _tag: "ObservationRecorded", at: input.at, observation: input.observation },
                input.at,
              );
              const observationData = yield* Schema.encodeEffect(
                Schema.toCodecJson(LineupObservation),
              )(input.observation).pipe(Effect.mapError(mapPersistenceFailure));
              yield* tx
                .insert(lineupRunDiagnostics)
                .values({
                  id: diagnosticId,
                  runId: record.id,
                  attempt: record.attempts,
                  userId: record.userId,
                  teamId: record.teamId,
                  kind: "observation",
                  data: observationData,
                  createdAt: DateTime.toDateUtc(input.at),
                  expiresAt: DateTime.toDateUtc(
                    DateTime.addDuration(input.at, retentionPolicy.lineupDiagnostic.millis),
                  ),
                })
                .pipe(Effect.mapError(mapPersistenceFailure));
            }),
          );
        },
      );

      const recordPlan = Effect.fn("LineupRunRepository.recordPlan")(function* (input: {
        readonly runId: LineupRunId;
        readonly lease: LineupLeaseRef;
        readonly plan: LineupPlan;
        readonly at: DateTime.Utc;
      }) {
        yield* mutateClaimed(input.runId, input.lease, (record, tx) =>
          transition(
            tx,
            record,
            { _tag: "PlanPrepared", at: input.at, plan: input.plan },
            input.at,
          ),
        );
      });

      const recordApplyResponse = Effect.fn("LineupRunRepository.recordApplyResponse")(
        function* (input: {
          readonly runId: LineupRunId;
          readonly lease: LineupLeaseRef;
          readonly intentId: string;
          readonly response: "accepted" | "unknown";
          readonly at: DateTime.Utc;
        }) {
          yield* mutateClaimed(input.runId, input.lease, (record, tx) =>
            Effect.gen(function* () {
              yield* requireRunIntent(record.state, input.intentId);
              yield* transition(
                tx,
                record,
                { _tag: "ApplyResponded", at: input.at, providerResponse: input.response },
                input.at,
              );
            }),
          );
        },
      );

      const recordVerified = Effect.fn("LineupRunRepository.recordVerified")(function* (input: {
        readonly runId: LineupRunId;
        readonly lease: LineupLeaseRef;
        readonly intentId: string;
        readonly outcome: LineupRunOutcome;
        readonly at: DateTime.Utc;
      }) {
        yield* mutateClaimed(input.runId, input.lease, (record, tx) =>
          Effect.gen(function* () {
            yield* requireRunIntent(record.state, input.intentId);
            yield* transition(
              tx,
              record,
              {
                _tag: "Verified",
                at: input.at,
                outcome: input.outcome,
                writeIntent: {
                  id: input.intentId,
                  attempt:
                    "writeIntent" in record.state && record.state.writeIntent !== undefined
                      ? record.state.writeIntent.attempt
                      : record.attempts,
                  status: input.outcome.kind === "changed" ? "verified_changed" : "verified_no_op",
                },
              },
              input.at,
            );
          }),
        );
      });

      const recordUncertain = Effect.fn("LineupRunRepository.recordUncertain")(function* (input: {
        readonly runId: LineupRunId;
        readonly lease: LineupLeaseRef;
        readonly intentId: string;
        readonly outcome: LineupRunOutcome;
        readonly at: DateTime.Utc;
      }) {
        yield* mutateClaimed(input.runId, input.lease, (record, tx) =>
          Effect.gen(function* () {
            yield* requireRunIntent(record.state, input.intentId);
            const writeIntent =
              record.state._tag === "Verifying" || record.state._tag === "Applying"
                ? record.state.writeIntent
                : undefined;
            yield* transition(
              tx,
              record,
              {
                _tag: "Uncertain",
                at: input.at,
                outcome: input.outcome,
                ...(writeIntent === undefined ? {} : { writeIntent }),
              },
              input.at,
            );
          }),
        );
      });

      const recordBlocked = terminal("Blocked");
      const recordSkipped = terminal("Skipped");
      const recordFailed = terminal("Failed");

      const recordRetry = Effect.fn("LineupRunRepository.recordRetry")(function* (input: {
        readonly runId: LineupRunId;
        readonly lease: LineupLeaseRef;
        readonly at: DateTime.Utc;
        readonly reason: string;
        readonly detail: string;
        readonly retryAt: DateTime.Utc;
        readonly intent?: {
          readonly id: string;
          readonly status: "not_sent" | "unknown";
          readonly resumeVerification: boolean;
        };
      }) {
        yield* mutateClaimed(input.runId, input.lease, (record, tx) =>
          Effect.gen(function* () {
            if (input.intent !== undefined) {
              yield* requireRunIntent(record.state, input.intent.id);
            }
            if (input.intent !== undefined && !input.intent.resumeVerification) {
              yield* updateIntentStatus(
                tx,
                record.id,
                input.intent.id,
                input.intent.status,
                input.at,
              );
            }
            yield* transition(
              tx,
              record,
              {
                _tag: "RetryScheduled",
                at: input.at,
                attempt: record.attempts,
                reason: input.reason,
                detail: input.detail,
                retryAt: input.retryAt,
                ...(input.intent?.resumeVerification === true
                  ? {
                      writeIntent: {
                        id: input.intent.id,
                        attempt:
                          "writeIntent" in record.state && record.state.writeIntent !== undefined
                            ? record.state.writeIntent.attempt
                            : record.attempts,
                        status: input.intent.status,
                      },
                    }
                  : {}),
              },
              input.at,
            );
          }),
        );
      });

      const blockedRunIds = Effect.fn("LineupRunRepository.blockedRunIds")(function* (
        runIds: ReadonlyArray<LineupRunId>,
      ) {
        const ids = [...new Set(runIds)];
        if (!Array.isArrayNonEmpty(ids)) {
          return new Set<LineupRunId>();
        }
        const runs = yield* database
          .select({ id: lineupRuns.id, teamId: lineupRuns.teamId })
          .from(lineupRuns)
          .where(anyOf(lineupRuns.id, ids));
        const teams = [...new Set(EffectArray.map(runs, (run) => run.teamId))];
        if (!Array.isArrayNonEmpty(teams)) {
          return new Set<LineupRunId>();
        }
        const busy = yield* database
          .selectDistinct({ teamId: lineupRuns.teamId })
          .from(lineupRuns)
          .where(
            and(
              anyOf(lineupRuns.teamId, teams),
              runningRunPredicate(lineupRuns),
              notInArray(lineupRuns.id, ids),
            ),
          );
        const busyTeams = new Set(EffectArray.map(busy, (row) => row.teamId));
        return new Set(
          EffectArray.map(
            EffectArray.filter(runs, (run) => busyTeams.has(run.teamId)),
            (run) => run.id,
          ),
        );
      }, Effect.mapError(mapPersistenceFailure));

      const claimDeliveries = (
        now: DateTime.Utc,
        limit: number,
      ): Effect.Effect<ReadonlyArray<LineupDeliveryRecord>, LineupPersistenceFailed> =>
        database
          .transaction((tx) =>
            Effect.gen(function* () {
              const staleBefore = DateTime.toDateUtc(
                DateTime.subtractDuration(now, lineupDeliveryStaleMillis),
              );
              const candidates = yield* tx
                .select({ id: lineupDeliveries.id })
                .from(lineupDeliveries)
                .where(
                  or(
                    eq(lineupDeliveries.status, "pending"),
                    and(
                      eq(lineupDeliveries.status, "dispatching"),
                      lte(lineupDeliveries.updatedAt, staleBefore),
                    ),
                  ),
                )
                .orderBy(asc(lineupDeliveries.createdAt))
                .limit(limit)
                .for("update");
              if (candidates.length === 0) {
                return [];
              }
              const ids = EffectArray.map(candidates, (row) => row.id);
              if (!Array.isArrayNonEmpty(ids)) {
                return [];
              }
              const updated = yield* mutateRows(tx, lineupDeliveries, {
                where: undefined,
                ids,
                codec: LineupDeliveryRow,
                plan: (locked) =>
                  Effect.forEach(
                    ids,
                    (id) =>
                      Effect.gen(function* () {
                        const record = locked.get(id);
                        if (record === undefined) {
                          throw new Error("A locked delivery is missing");
                        }
                        const next = yield* planDeliveryState(lineupDeliveryState(record), {
                          _tag: "Claimed",
                          at: now,
                        });
                        return { ...record, ...deliveryProjection(next) };
                      }),
                    { concurrency: 1 },
                  ),
              });
              return updated;
            }),
          )
          .pipe(
            Effect.mapError((cause) =>
              Schema.is(LineupPersistenceFailed)(cause)
                ? cause
                : LineupPersistenceFailed.make({ cause }),
            ),
          );

      const finishDeliveries = (
        inputs: ReadonlyArray<{
          readonly deliveryId: string;
          readonly at: DateTime.Utc;
          readonly outcome: "dispatched" | "pending";
          readonly error?: string;
        }>,
      ): Effect.Effect<void, LineupPersistenceFailed> => {
        if (inputs.length === 0) {
          return Effect.void;
        }
        const byId = new Map(EffectArray.map(inputs, (input) => [input.deliveryId, input]));
        const at = inputs[0]?.at;
        if (at === undefined) {
          return Effect.void;
        }
        const ids = [...byId.keys()];
        if (!Array.isArrayNonEmpty(ids)) {
          return Effect.void;
        }
        return database
          .transaction((tx) =>
            mutateRows(tx, lineupDeliveries, {
              where: undefined,
              ids,
              codec: LineupDeliveryRow,
              plan: (locked) =>
                Effect.forEach(
                  [...byId],
                  ([id, input]) =>
                    Effect.gen(function* () {
                      const record = locked.get(id);
                      if (record === undefined) {
                        return [];
                      }
                      const event: LineupDeliveryEvent =
                        input.outcome === "dispatched"
                          ? { _tag: "Dispatched", at: input.at }
                          : { _tag: "Released", at: input.at, error: input.error };
                      const next = yield* planDeliveryState(lineupDeliveryState(record), event);
                      return [{ ...record, ...deliveryProjection(next) }];
                    }),
                  { concurrency: 1 },
                ).pipe(Effect.map((rows) => rows.flat())),
            }),
          )
          .pipe(
            Effect.mapError((cause) =>
              Schema.is(LineupPersistenceFailed)(cause)
                ? cause
                : LineupPersistenceFailed.make({ cause }),
            ),
            Effect.asVoid,
          );
      };

      const loadDelivery = Effect.fn("LineupRunRepository.loadDelivery")(function* (
        userId: UserId,
        requestId: LineupRequestId,
      ) {
        const rows = yield* database
          .select()
          .from(lineupDeliveries)
          .where(
            and(eq(lineupDeliveries.userId, userId), eq(lineupDeliveries.requestId, requestId)),
          )
          .limit(1)
          .pipe(Effect.mapError(mapPersistenceFailure));
        const row = rows[0];
        return row === undefined ? undefined : yield* decodeDelivery(row);
      });

      const staleRequests = (
        now: DateTime.Utc,
        limit: number,
      ): Effect.Effect<
        ReadonlyArray<{ readonly userId: UserId; readonly requestId: LineupRequestId }>,
        LineupPersistenceFailed
      > =>
        Effect.gen(function* () {
          const queuedBefore = DateTime.toDateUtc(
            DateTime.subtractDuration(now, lineupQueuedStaleMillis),
          );
          const rows = yield* database
            .selectDistinct({ userId: lineupRuns.userId, requestId: lineupRuns.requestId })
            .from(lineupRuns)
            .leftJoin(lineupTeamLeases, eq(lineupTeamLeases.teamId, lineupRuns.teamId))
            .where(
              or(
                and(
                  anyOf(lineupRuns.status, [
                    "reading",
                    "planning",
                    "validating",
                    "applying",
                    "verifying",
                  ]),
                  or(
                    isNull(lineupTeamLeases.teamId),
                    lte(lineupTeamLeases.expiresAt, DateTime.toDateUtc(now)),
                  ),
                ),
                and(
                  eq(lineupRuns.status, "queued"),
                  lte(lineupRuns.createdAt, queuedBefore),
                  or(
                    isNull(lineupTeamLeases.teamId),
                    lte(lineupTeamLeases.expiresAt, DateTime.toDateUtc(now)),
                  ),
                ),
                and(
                  eq(lineupRuns.status, "retry-wait"),
                  lte(lineupRuns.nextActionAt, DateTime.toDateUtc(now)),
                ),
                and(eq(lineupRuns.status, "uncertain"), isNull(lineupTeamLeases.teamId)),
              ),
            )
            .limit(limit);
          return yield* Effect.forEach(
            rows,
            (row) =>
              Effect.all(
                {
                  userId: Schema.decodeEffect(UserId)(row.userId),
                  requestId: Schema.decodeEffect(LineupRequestId)(row.requestId),
                },
                { concurrency: 1 },
              ),
            { concurrency: 1 },
          );
        }).pipe(
          Effect.mapError((cause) =>
            Schema.is(LineupPersistenceFailed)(cause)
              ? cause
              : LineupPersistenceFailed.make({ cause }),
          ),
          Effect.withSpan("LineupRunRepository.staleRequests"),
        );

      const loadDeliveriesForRequests = (
        requests: ReadonlyArray<{
          readonly userId: UserId;
          readonly requestId: LineupRequestId;
        }>,
      ): Effect.Effect<ReadonlyArray<LineupDeliveryRecord>, LineupPersistenceFailed> =>
        Effect.gen(function* () {
          const byUser = new Map<UserId, string[]>();
          for (const request of requests) {
            const ids = byUser.get(request.userId) ?? [];
            ids.push(request.requestId);
            byUser.set(request.userId, ids);
          }
          const conditions = EffectArray.flatMap([...byUser], ([userId, requestIds]) => {
            const flatMapped1 = Array.isArrayNonEmpty(requestIds)
              ? [
                  and(
                    eq(lineupDeliveries.userId, userId),
                    anyOf(lineupDeliveries.requestId, requestIds),
                  ),
                ]
              : [];
            return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
          });
          if (!Array.isArrayNonEmpty(conditions)) {
            return [];
          }
          const rows = yield* database
            .select()
            .from(lineupDeliveries)
            .where(or(...conditions));
          const deliveries: LineupDeliveryRecord[] = [];
          for (const row of rows) {
            const yielded7 = yield* decodeDelivery(row);
            deliveries.push(yielded7);
          }
          return deliveries;
        }).pipe(
          Effect.mapError((cause) =>
            Schema.is(LineupPersistenceFailed)(cause)
              ? cause
              : LineupPersistenceFailed.make({ cause }),
          ),
        );

      const markAttemptFinished = Effect.fn("LineupRunRepository.markAttemptFinished")(function* (
        runId: LineupRunId,
        attempt: number,
        at: DateTime.Utc,
        outcome: string,
      ) {
        yield* database
          .update(lineupRunAttempts)
          .set({ finishedAt: DateTime.toDateUtc(at), outcome })
          .where(and(eq(lineupRunAttempts.runId, runId), eq(lineupRunAttempts.attempt, attempt)))
          .pipe(Effect.mapError(mapPersistenceFailure));
      });

      const mutateClaimed = (
        runId: LineupRunId,
        lease: LineupLeaseRef,
        mutate: (
          record: LineupRunRecord,
          tx: Transaction,
        ) => Effect.Effect<void, LineupPersistenceFailed>,
      ): Effect.Effect<boolean, LineupPersistenceFailed> =>
        database
          .transaction((tx) =>
            Effect.gen(function* () {
              const record = yield* lockClaimedRun(tx, runId, lease);
              if (record === undefined) {
                return false;
              }
              const currentLease = yield* tx
                .select({
                  token: lineupTeamLeases.token,
                  generation: lineupTeamLeases.generation,
                })
                .from(lineupTeamLeases)
                .where(eq(lineupTeamLeases.teamId, record.teamId))
                .limit(1)
                .for("update");
              const owned = currentLease[0];
              if (
                owned === undefined ||
                owned.token !== lease.token ||
                owned.generation !== lease.generation
              ) {
                return false;
              }
              yield* mutate(record, tx);
              return true;
            }),
          )
          .pipe(
            Effect.mapError((cause) =>
              Schema.is(LineupPersistenceFailed)(cause)
                ? cause
                : LineupPersistenceFailed.make({ cause }),
            ),
          );

      function transition(
        tx: Transaction,
        record: LineupRunRecord,
        event: LineupRunEvent,
        at: DateTime.Utc,
      ): Effect.Effect<void, LineupPersistenceFailed> {
        return Effect.gen(function* () {
          const next = yield* planState(record.state, event);
          yield* updateRunState(tx, record, next, at, record.attempts);
          if (!holdsLease(next)) {
            yield* tx
              .delete(lineupTeamLeases)
              .where(eq(lineupTeamLeases.teamId, record.teamId))
              .pipe(Effect.mapError(mapPersistenceFailure));
          }
        });
      }

      function terminal(
        tag: "Blocked" | "Skipped" | "Failed" | "Superseded",
      ): (input: TerminalInput) => Effect.Effect<void, LineupPersistenceFailed> {
        return (input: TerminalInput) =>
          mutateClaimed(input.runId, input.lease, (record, tx) =>
            Effect.gen(function* () {
              if (input.intent !== undefined) {
                yield* requireRunIntent(record.state, input.intent.id);
              }
              const event: LineupRunEvent =
                tag === "Failed" && input.intent !== undefined
                  ? {
                      _tag: "Failed",
                      at: input.at,
                      outcome: input.outcome,
                      writeIntent: {
                        id: input.intent.id,
                        attempt:
                          "writeIntent" in record.state && record.state.writeIntent !== undefined
                            ? record.state.writeIntent.attempt
                            : record.attempts,
                        status: input.intent.status,
                      },
                    }
                  : { _tag: tag, at: input.at, outcome: input.outcome };
              yield* transition(tx, record, event, input.at);
              yield* tx
                .update(lineupRunAttempts)
                .set({ finishedAt: DateTime.toDateUtc(input.at), outcome: tag })
                .where(
                  and(
                    eq(lineupRunAttempts.runId, record.id),
                    eq(lineupRunAttempts.attempt, record.attempts),
                  ),
                )
                .pipe(Effect.mapError(mapPersistenceFailure));
            }),
          ).pipe(Effect.asVoid);
      }

      return {
        createRequest,
        createScheduledRuns,
        createScheduledRunsForOwners,
        scheduledTeamIds,
        loadRuns,
        loadRunConnections,
        loadTeamActivity,
        loadTeamRunsSince,
        claim,
        loadWriteIntent,
        unresolvedWriteIntent,
        beginApply,
        recordObservation,
        recordPlan,
        recordApplyResponse,
        recordVerified,
        recordUncertain,
        recordBlocked,
        recordSkipped,
        recordFailed,
        recordRetry,
        claimDeliveries,
        blockedRunIds,
        finishDeliveries,
        loadDelivery,
        staleRequests,
        loadDeliveriesForRequests,
        markAttemptFinished,
      };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

function hourKey(at: DateTime.Utc): string {
  return DateTime.formatIso(DateTime.startOf(at, "hour"));
}

function claimEvent(
  state: LineupRunState,
  lease: LineupLeaseRef,
  attempt: number,
  at: DateTime.Utc,
): { readonly event: LineupRunEvent; readonly resumeVerification: boolean } {
  switch (state._tag) {
    case "Queued":
      return { event: { _tag: "Claimed", at, lease, attempt }, resumeVerification: false };
    case "RetryWait":
      return state.writeIntent === undefined
        ? { event: { _tag: "RetryClaimed", at, lease, attempt }, resumeVerification: false }
        : {
            event: { _tag: "VerificationClaimed", at, lease, attempt },
            resumeVerification: true,
          };
    case "Reading":
    case "Planning":
    case "Validating":
      return { event: { _tag: "Reclaimed", at, lease, attempt }, resumeVerification: false };
    case "Applying":
    case "Verifying":
      return {
        event: { _tag: "VerificationResumed", at, lease, attempt },
        resumeVerification: true,
      };
    case "Uncertain":
      return {
        event: { _tag: "ReconciliationStarted", at, lease, attempt },
        resumeVerification: true,
      };
    case "Completed":
    case "Skipped":
    case "Blocked":
    case "Failed":
    case "Superseded":
      throw new Error("Terminal lineup run cannot be claimed");
  }
}

function holdsLease(state: LineupRunState): boolean {
  switch (state._tag) {
    case "Reading":
    case "Planning":
    case "Validating":
    case "Applying":
    case "Verifying":
    case "Uncertain":
      return true;
    case "Queued":
    case "Completed":
    case "Skipped":
    case "Blocked":
    case "Failed":
    case "Superseded":
    case "RetryWait":
      return false;
  }
}

function isTerminal(state: LineupRunState): boolean {
  switch (state._tag) {
    case "Completed":
    case "Skipped":
    case "Blocked":
    case "Failed":
    case "Superseded":
      return true;
    case "Queued":
    case "Reading":
    case "Planning":
    case "Validating":
    case "Applying":
    case "Verifying":
    case "RetryWait":
    case "Uncertain":
      return false;
  }
}

function alignClaimedImplementation(
  record: LineupRunRecord,
  implementation: LineupImplementation,
): LineupRunRecord {
  if (hasWriteInFlight(record.state) || record.implementation === implementation) {
    return record;
  }
  const implementationVersion = implementationVersionOf(implementation);
  return {
    ...record,
    implementation,
    implementationVersion,
    state: { ...record.state, implementation, implementationVersion },
  };
}

function hasWriteInFlight(state: LineupRunState): boolean {
  switch (state._tag) {
    case "Applying":
    case "Verifying":
      return true;
    case "RetryWait":
    case "Uncertain":
      return state.writeIntent !== undefined;
    case "Queued":
    case "Reading":
    case "Planning":
    case "Validating":
    case "Completed":
    case "Skipped":
    case "Blocked":
    case "Failed":
    case "Superseded":
      return false;
  }
}

function planState(
  state: LineupRunState,
  event: LineupRunEvent,
): Effect.Effect<LineupRunState, LineupPersistenceFailed> {
  return Effect.gen(function* () {
    const snapshot = yield* snapshotOf(LineupRunWorkflow, state).pipe(
      Effect.mapError(mapPersistenceFailure),
    );
    return yield* plan(LineupRunWorkflow, snapshot, event).pipe(
      Effect.mapError((cause) =>
        cause._tag === "TransitionRejected"
          ? LineupPersistenceFailed.make({
              cause: new Error(`Lineup run rejected ${event._tag} from ${state._tag}`),
            })
          : mapPersistenceFailure(cause),
      ),
    );
  });
}

function planDeliveryState(
  state: LineupDeliveryState,
  event: LineupDeliveryEvent,
): Effect.Effect<LineupDeliveryState, LineupPersistenceFailed> {
  return Effect.gen(function* () {
    const snapshot = yield* snapshotOf(LineupDeliveryWorkflow, state).pipe(
      Effect.mapError(mapPersistenceFailure),
    );
    return yield* plan(LineupDeliveryWorkflow, snapshot, event).pipe(
      Effect.mapError((cause) =>
        cause._tag === "TransitionRejected"
          ? LineupPersistenceFailed.make({
              cause: new Error(`Lineup delivery rejected ${event._tag} from ${state._tag}`),
            })
          : mapPersistenceFailure(cause),
      ),
    );
  });
}

function deliveryProjection(
  state: LineupDeliveryState,
): Pick<LineupDeliveryRecord, "status" | "attempts" | "lastError" | "dispatchedAt" | "updatedAt"> {
  return {
    status: lineupDeliveryStatus(state),
    attempts: state.attempts,
    lastError: state.lastError,
    dispatchedAt: state.dispatchedAt,
    updatedAt: state.updatedAt,
  };
}

function deliveryRowProjection(state: LineupDeliveryState): Pick<
  LineupDeliveryRecord,
  "status" | "attempts" | "lastError"
> & {
  readonly updatedAt: Date;
  readonly dispatchedAt: Date | null;
} {
  return {
    ...deliveryProjection(state),
    updatedAt: DateTime.toDateUtc(state.updatedAt),
    dispatchedAt: state.dispatchedAt === null ? null : DateTime.toDateUtc(state.dispatchedAt),
  };
}

function updateRunState(
  tx: Transaction,
  record: LineupRunRecord,
  state: LineupRunState,
  at: DateTime.Utc,
  attempts: number,
): Effect.Effect<void, LineupPersistenceFailed> {
  const next: LineupRunRecord = {
    ...record,
    state,
    status: lineupRunStatus(state),
    attempts,
    nextActionAt: state._tag === "RetryWait" ? state.retryAt : null,
    updatedAt: at,
  };
  return Effect.gen(function* () {
    const row = yield* Schema.encodeEffect(LineupRunRow)(next);
    if ("writeIntent" in state && state.writeIntent !== undefined) {
      yield* updateIntentStatus(tx, record.id, state.writeIntent.id, state.writeIntent.status, at);
    }
    yield* tx.update(lineupRuns).set(row).where(eq(lineupRuns.id, record.id));
  }).pipe(Effect.mapError(mapPersistenceFailure));
}

function lockClaimedRun(
  tx: Transaction,
  runId: LineupRunId,
  lease: LineupLeaseRef,
): Effect.Effect<LineupRunRecord | undefined, LineupPersistenceFailed> {
  return Effect.gen(function* () {
    const rows = yield* tx
      .select()
      .from(lineupRuns)
      .where(eq(lineupRuns.id, runId))
      .limit(1)
      .for("update");
    const row = rows[0];
    if (row === undefined) {
      return undefined;
    }
    const record = yield* decodeRun(row);
    const state = record.state;
    if (!("lease" in state)) {
      return undefined;
    }
    return state.lease.token === lease.token && state.lease.generation === lease.generation
      ? record
      : undefined;
  }).pipe(
    Effect.mapError((cause) =>
      Schema.is(LineupPersistenceFailed)(cause) ? cause : LineupPersistenceFailed.make({ cause }),
    ),
  );
}

function requireRunIntent(
  state: LineupRunState,
  intentId: string,
): Effect.Effect<void, LineupPersistenceFailed> {
  return "writeIntent" in state && state.writeIntent?.id === intentId
    ? Effect.void
    : Effect.fail(
        LineupPersistenceFailed.make({
          cause: new Error("The run does not own this write intent"),
        }),
      );
}

function updateIntentStatus(
  tx: Transaction,
  runId: LineupRunId,
  intentId: string,
  status: LineupWriteIntentStatus,
  at: DateTime.Utc,
): Effect.Effect<void, LineupPersistenceFailed> {
  return Effect.gen(function* () {
    const updated = yield* tx
      .update(lineupWriteIntents)
      .set({ status, updatedAt: DateTime.toDateUtc(at) })
      .where(and(eq(lineupWriteIntents.id, intentId), eq(lineupWriteIntents.runId, runId)))
      .returning({ id: lineupWriteIntents.id });
    if (updated.length !== 1) {
      return yield* LineupPersistenceFailed.make({
        cause: new Error("The run's write intent could not be updated"),
      });
    }
  }).pipe(Effect.mapError(mapPersistenceFailure));
}

function loadRequestRuns(
  tx: Transaction,
  userId: UserId,
  requestId: LineupRequestId,
): Effect.Effect<ReadonlyArray<LineupRunRecord>, LineupPersistenceFailed> {
  return Effect.gen(function* () {
    const rows = yield* tx
      .select()
      .from(lineupRuns)
      .where(and(eq(lineupRuns.userId, userId), eq(lineupRuns.requestId, requestId)))
      .orderBy(asc(lineupRuns.createdAt), asc(lineupRuns.id));
    return yield* Effect.forEach(rows, (row) => decodeRun(row), { concurrency: 1 });
  }).pipe(
    Effect.mapError((cause) =>
      Schema.is(LineupPersistenceFailed)(cause) ? cause : LineupPersistenceFailed.make({ cause }),
    ),
  );
}

function decodeRun(
  row: typeof lineupRuns.$inferSelect,
): Effect.Effect<LineupRunRecord, LineupPersistenceFailed> {
  return Schema.decodeEffect(LineupRunRow)(row).pipe(Effect.mapError(mapPersistenceFailure));
}

function decodeDelivery(
  row: typeof lineupDeliveries.$inferSelect,
): Effect.Effect<LineupDeliveryRecord, LineupPersistenceFailed> {
  return Schema.decodeEffect(LineupDeliveryRow)(row).pipe(Effect.mapError(mapPersistenceFailure));
}

type TerminalInput = {
  readonly runId: LineupRunId;
  readonly lease: LineupLeaseRef;
  readonly outcome: LineupRunOutcome;
  readonly at: DateTime.Utc;
  readonly intent?: { readonly id: string; readonly status: "rejected" | "verified_mismatch" };
};

function mapPersistenceFailure(cause: unknown): LineupPersistenceFailed {
  return LineupPersistenceFailed.make({ cause });
}

function implementationVersionOf(implementation: LineupImplementation): string {
  return implementation === customLineupImplementation
    ? customPolicyImplementationVersion
    : providerNativeImplementationVersion;
}
