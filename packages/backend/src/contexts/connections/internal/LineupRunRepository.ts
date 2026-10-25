import { Machine } from "@typeonce/effect-machine";
import { and, asc, desc, eq, getTableColumns, isNull, lte, ne, or, sql } from "drizzle-orm";
import { Array, Context, Crypto, DateTime, Effect, Layer, Option, Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import type { ConnectionId } from "#contexts/connections/Connection.ts";
import type { TeamId } from "#contexts/connections/FantasyTeam.ts";
import type { LineupRunOutcome } from "#contexts/connections/LineupRun.ts";
import {
  LineupPersistenceFailed,
  LineupRequestConflict,
  LineupRequestId,
  LineupRunId,
  LineupUuid,
  nativeLineupImplementation,
  providerNativeImplementationVersion,
} from "#contexts/connections/LineupRun.ts";
import type { LineupTargetPeriod, LineupTrigger } from "#contexts/connections/LineupRun.ts";
import { anyOf, maxInsertRows, mutateRows } from "#database/dbUtilities.ts";
import { chunked } from "#utilities/collections.ts";
import { snapshotOf } from "#utilities/machine.ts";

import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import { providerConnections, providerCredentials, providerTeams } from "./ConnectionTables.ts";
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
import { LineupRunState, LineupRunWorkflow, lineupRunStatus } from "./LineupRunWorkflow.ts";
import { TeamAutomationState } from "./TeamAutomationWorkflow.ts";
import { LineupObservation } from "./LineupRunWorkflow.ts";
import type {
  LineupLeaseRef,
  LineupNativePlan,
  LineupRunEvent,
} from "./LineupRunWorkflow.ts";

const lineupLeaseDurationMillis = 45_000;
const lineupDeliveryStaleMillis = 60_000;
const lineupDiagnosticRetentionMillis = 7 * 24 * 60 * 60 * 1000;

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

type IntentStatus =
  | "intended"
  | "sent"
  | "accepted"
  | "rejected"
  | "unknown"
  | "not_sent"
  | "verified_changed"
  | "verified_no_op";

type Transaction = Parameters<Parameters<ConnectionsDatabase["Service"]["transaction"]>[0]>[0];

export class LineupRunRepository extends Context.Service<LineupRunRepository>()(
  "@lineupkeep/backend/contexts/connections/internal/LineupRunRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;
      const crypto = yield* Crypto.Crypto;

      const newId = crypto.randomUUIDv7();

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
                    const state: LineupRunState = {
                      _tag: "Queued",
                      team: run.team,
                      target: run.target,
                      trigger: run.trigger,
                      implementation: nativeLineupImplementation,
                      implementationVersion: providerNativeImplementationVersion,
                      queuedAt: now,
                      updatedAt: now,
                    };
                    return {
                      id: yield* Schema.decodeEffect(LineupRunId)(yield* newId),
                      userId: input.userId,
                      requestId: input.requestId,
                      teamId: run.team,
                      connectionId: run.connectionId,
                      trigger: run.trigger,
                      scheduleKey: null,
                      target: run.target,
                      status: lineupRunStatus(state),
                      state,
                      implementation: nativeLineupImplementation,
                      implementationVersion: providerNativeImplementationVersion,
                      attempts: 0,
                      nextActionAt: null,
                      createdAt: now,
                      updatedAt: now,
                    } satisfies LineupRunRecord;
                  }),
                { concurrency: 1 },
              );

              const rows = yield* Effect.forEach(records, (record) =>
                Schema.encodeEffect(LineupRunRow)(record),
              );
              yield* chunked(rows, maxInsertRows(lineupRuns), (chunk) =>
                tx.insert(lineupRuns).values(chunk).returning(),
              );
              yield* tx.insert(lineupDeliveries).values({
                id: deliveryId,
                userId: input.userId,
                requestId: input.requestId,
                status: "pending",
                attempts: 0,
                runIds: records.map((record) => record.id),
                lastError: null,
                createdAt: at,
                updatedAt: at,
                dispatchedAt: null,
              });
              yield* Effect.annotateCurrentSpan("lineup.run_count", records.length);
              return { created: true, runs: records } satisfies CreatedLineupRequest;
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
          const requestId = yield* newId.pipe(
            Effect.flatMap((id) => Schema.decodeEffect(LineupRequestId)(id)),
            Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })),
          );
          const deliveryId = yield* newId.pipe(
            Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })),
          );
          const at = DateTime.toDateUtc(input.at);
          const records: ReadonlyArray<LineupRunRecord> = yield* Effect.forEach(
            input.runs,
            (run) =>
              Effect.gen(function* () {
                const state: LineupRunState = {
                  _tag: "Queued",
                  team: run.team,
                  target: { coverage: "current" },
                  trigger: "scheduled",
                  implementation: nativeLineupImplementation,
                  implementationVersion: providerNativeImplementationVersion,
                  queuedAt: input.at,
                  updatedAt: input.at,
                };
                return {
                  id: yield* Schema.decodeEffect(LineupRunId)(yield* newId),
                  userId: input.userId,
                  requestId,
                  teamId: run.team,
                  connectionId: run.connectionId,
                  trigger: "scheduled" as const,
                  scheduleKey: hourKey(input.at),
                  target: { coverage: "current" as const },
                  status: lineupRunStatus(state),
                  state,
                  implementation: nativeLineupImplementation,
                  implementationVersion: providerNativeImplementationVersion,
                  attempts: 0,
                  nextActionAt: null,
                  createdAt: input.at,
                  updatedAt: input.at,
                } satisfies LineupRunRecord;
              }),
            { concurrency: 1 },
          ).pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
          const rows = yield* Effect.forEach(records, (record) =>
            Schema.encodeEffect(LineupRunRow)(record),
          ).pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
          return yield* database
            .transaction((tx) =>
              Effect.gen(function* () {
                const inserted = yield* tx
                  .insert(lineupRuns)
                  .values(rows)
                  .onConflictDoNothing()
                  .returning();
                if (inserted.length === 0) {
                  return { created: false, runs: [] as ReadonlyArray<LineupRunRecord> };
                }
                const created = yield* Effect.forEach(inserted, (row) => decodeRun(row));
                yield* tx.insert(lineupRequests).values({
                  userId: input.userId,
                  id: requestId,
                  intent: JSON.stringify({ trigger: "scheduled", target: { coverage: "current" } }),
                  createdAt: at,
                  updatedAt: at,
                });
                yield* tx.insert(lineupDeliveries).values({
                  id: deliveryId,
                  userId: input.userId,
                  requestId,
                  status: "pending",
                  attempts: 0,
                  runIds: created.map((record) => record.id),
                  lastError: null,
                  createdAt: at,
                  updatedAt: at,
                  dispatchedAt: null,
                });
                return { created: true, runs: created };
              }),
            )
            .pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
        },
      );

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
            and(
              anyOf(lineupRuns.teamId, ids),
              eq(lineupRuns.trigger, "scheduled"),
              anyOf(lineupRuns.status, nonTerminalRunStatuses),
            ),
          )
          .pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
        return new Set(rows.map((row) => row.teamId));
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
          .pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
        const records = yield* Effect.forEach(rows.slice(0, query.limit), (row) => decodeRun(row));
        if (query.runs !== undefined) {
          const byId = new Map(records.map((record) => [record.id, record]));
          const ordered = query.runs.flatMap((id) => {
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
        perTeam: number,
      ) {
        const ids = [...new Set(teamIds)];
        if (!Array.isArrayNonEmpty(ids)) {
          return new Map<TeamId, ReadonlyArray<LineupRunRecord>>();
        }
        const ranked = database
          .select({
            ...getTableColumns(lineupRuns),
            rank: sql<number>`row_number() over (partition by ${lineupRuns.teamId} order by ${lineupRuns.createdAt} desc, ${lineupRuns.id} asc)`.as(
              "rank",
            ),
          })
          .from(lineupRuns)
          .where(and(eq(lineupRuns.userId, userId), anyOf(lineupRuns.teamId, ids)))
          .as("ranked_runs");
        const rows = yield* database
          .select()
          .from(ranked)
          .where(lte(ranked.rank, perTeam))
          .orderBy(asc(ranked.teamId), desc(ranked.createdAt), asc(ranked.id))
          .pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
        const grouped = new Map<TeamId, Array<LineupRunRecord>>();
        for (const row of rows) {
          const record = yield* decodeRun(row);
          const existing = grouped.get(record.teamId) ?? [];
          existing.push(record);
          grouped.set(record.teamId, existing);
        }
        return grouped;
      });

      const runsForRequest = Effect.fn("LineupRunRepository.runsForRequest")(function* (
        userId: UserId,
        requestId: LineupRequestId,
      ) {
        const rows = yield* database
          .select({ id: lineupRuns.id })
          .from(lineupRuns)
          .where(and(eq(lineupRuns.userId, userId), eq(lineupRuns.requestId, requestId)))
          .orderBy(asc(lineupRuns.createdAt), asc(lineupRuns.id))
          .pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
        return yield* Effect.forEach(rows, (row) => Schema.decodeEffect(LineupRunId)(row.id));
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
              const record = yield* decodeRun(row);
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
              const lease: LineupLeaseRef = {
                token: yield* Schema.decodeEffect(LineupUuid)(yield* newId),
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
          .pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
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
                anyOf(lineupWriteIntents.status, ["intended", "sent", "accepted", "unknown"]),
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
        readonly plan: LineupNativePlan;
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
                  availability: providerTeams.availability,
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
                    ).pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
              if (
                ownedControl === undefined ||
                ownedControl.availability !== "available" ||
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
                    anyOf(lineupWriteIntents.status, ["intended", "sent", "accepted", "unknown"]),
                    ne(lineupWriteIntents.runId, input.runId),
                  ),
                )
                .limit(1);
              if (prior[0] !== undefined) {
                return { status: "blocked" as const, reason: "unresolved_prior_write" as const };
              }

              const intentId = yield* Schema.decodeEffect(LineupUuid)(yield* newId);
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
                  action: "start_active_players",
                  target: input.plan.target,
                  before: input.before,
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
                writeIntent: { id: intent.id, attempt: intent.attempt },
              });
              yield* updateRunState(tx, record, next, input.at, record.attempts);
              return { status: "started" as const, intent };
            }),
          )
          .pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
      });

      const recordObservation = Effect.fn("LineupRunRepository.recordObservation")(
        function* (input: {
          readonly runId: LineupRunId;
          readonly lease: LineupLeaseRef;
          readonly observation: LineupObservation;
          readonly at: DateTime.Utc;
        }) {
          const diagnosticId = yield* newId.pipe(
            Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })),
          );
          yield* mutateClaimed(input.runId, input.lease, (record, tx) =>
            Effect.gen(function* () {
              yield* transition(
                tx,
                record,
                { _tag: "ObservationRecorded", at: input.at, observation: input.observation },
                input.at,
              );
              yield* tx
                .insert(lineupRunDiagnostics)
                .values({
                  id: diagnosticId,
                  runId: record.id,
                  attempt: record.attempts,
                  userId: record.userId,
                  teamId: record.teamId,
                  kind: "observation",
                  data: Schema.encodeSync(Schema.toCodecJson(LineupObservation))(
                    input.observation,
                  ),
                  createdAt: DateTime.toDateUtc(input.at),
                  expiresAt: DateTime.toDateUtc(
                    DateTime.addDuration(input.at, lineupDiagnosticRetentionMillis),
                  ),
                })
                .pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
            }),
          );
        },
      );

      const recordPlan = Effect.fn("LineupRunRepository.recordPlan")(function* (input: {
        readonly runId: LineupRunId;
        readonly lease: LineupLeaseRef;
        readonly plan: LineupNativePlan;
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
              yield* updateIntentStatus(tx, input.intentId, input.lease, input.response, input.at);
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
            yield* updateIntentStatus(
              tx,
              input.intentId,
              input.lease,
              input.outcome.kind === "changed" ? "verified_changed" : "verified_no_op",
              input.at,
            );
            yield* transition(
              tx,
              record,
              { _tag: "Verified", at: input.at, outcome: input.outcome },
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
      const recordSuperseded = terminal("Superseded");

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
              yield* updateIntentStatus(
                tx,
                input.intent.id,
                input.lease,
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
                  ? { writeIntent: { id: input.intent.id, attempt: record.attempts } }
                  : {}),
              },
              input.at,
            );
          }),
        );
      });

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
              const ids = candidates.map((row) => row.id);
              if (!Array.isArrayNonEmpty(ids)) {
                return [];
              }
              const updated = yield* mutateRows(tx, lineupDeliveries, {
                where: undefined,
                ids,
                codec: LineupDeliveryRow,
                plan: (locked) =>
                  Effect.succeed(
                    ids.map((id) => {
                      const record = locked.get(id);
                      if (record === undefined) {
                        throw new Error("A locked delivery is missing");
                      }
                      return {
                        ...record,
                        status: "dispatching" as const,
                        attempts: record.attempts + 1,
                        updatedAt: now,
                      };
                    }),
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
        const byId = new Map(inputs.map((input) => [input.deliveryId, input]));
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
              where: eq(lineupDeliveries.status, "dispatching"),
              ids,
              codec: LineupDeliveryRow,
              plan: (locked) =>
                Effect.succeed(
                  [...byId].flatMap(([id, input]) => {
                    const record = locked.get(id);
                    if (record === undefined) {
                      return [];
                    }
                    return [
                      {
                        ...record,
                        status: input.outcome,
                        lastError: input.error ?? null,
                        updatedAt: input.at,
                        ...(input.outcome === "dispatched" ? { dispatchedAt: input.at } : {}),
                      },
                    ];
                  }),
                ),
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
          .pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
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
                  eq(lineupRuns.status, "retry-wait"),
                  lte(lineupRuns.nextActionAt, DateTime.toDateUtc(now)),
                ),
                and(eq(lineupRuns.status, "uncertain"), isNull(lineupTeamLeases.teamId)),
              ),
            )
            .limit(limit);
          return yield* Effect.forEach(rows, (row) =>
            Effect.all({
              userId: Schema.decodeEffect(UserId)(row.userId),
              requestId: Schema.decodeEffect(LineupRequestId)(row.requestId),
            }),
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
          const conditions = [...byUser].flatMap(([userId, requestIds]) =>
            Array.isArrayNonEmpty(requestIds)
              ? [
                  and(
                    eq(lineupDeliveries.userId, userId),
                    anyOf(lineupDeliveries.requestId, requestIds),
                  ),
                ]
              : [],
          );
          if (!Array.isArrayNonEmpty(conditions)) {
            return [];
          }
          const rows = yield* database
            .select()
            .from(lineupDeliveries)
            .where(or(...conditions));
          const deliveries: LineupDeliveryRecord[] = [];
          for (const row of rows) {
            deliveries.push(yield* decodeDelivery(row));
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
          .pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
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
        });
      }

      function terminal(
        tag: "Blocked" | "Skipped" | "Failed" | "Superseded",
      ): (input: TerminalInput) => Effect.Effect<void, LineupPersistenceFailed> {
        return (input: TerminalInput) =>
          mutateClaimed(input.runId, input.lease, (record, tx) =>
            Effect.gen(function* () {
              if (input.intent !== undefined) {
                yield* updateIntentStatus(
                  tx,
                  input.intent.id,
                  input.lease,
                  input.intent.status,
                  input.at,
                );
              }
              yield* transition(
                tx,
                record,
                { _tag: tag, at: input.at, outcome: input.outcome },
                input.at,
              );
              yield* tx
                .update(lineupRunAttempts)
                .set({ finishedAt: DateTime.toDateUtc(input.at), outcome: tag })
                .where(
                  and(
                    eq(lineupRunAttempts.runId, record.id),
                    eq(lineupRunAttempts.attempt, record.attempts),
                  ),
                )
                .pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
            }),
          ).pipe(Effect.asVoid);
      }

      return {
        createRequest,
        createScheduledRuns,
        scheduledTeamIds,
        loadRuns,
        runsForRequest,
        loadTeamActivity,
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
        recordSuperseded,
        recordRetry,
        claimDeliveries,
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

function planState(
  state: LineupRunState,
  event: LineupRunEvent,
): Effect.Effect<LineupRunState, LineupPersistenceFailed> {
  return Effect.gen(function* () {
    const snapshot = yield* snapshotOf(LineupRunWorkflow, state).pipe(
      Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })),
    );
    const planned = yield* Machine.plan(LineupRunWorkflow, snapshot, event).pipe(
      Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })),
    );
    const handled = planned.microsteps.some((step) => step.transitions.length > 0);
    if (!handled) {
      return yield* LineupPersistenceFailed.make({
        cause: new Error(`Lineup run rejected ${event._tag} from ${state._tag}`),
      });
    }
    return yield* Schema.decodeEffect(LineupRunState)(planned.next.state.value).pipe(
      Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })),
    );
  });
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
    yield* tx.update(lineupRuns).set(row).where(eq(lineupRuns.id, record.id));
  }).pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
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

function updateIntentStatus(
  tx: Transaction,
  intentId: string,
  lease: LineupLeaseRef,
  status: IntentStatus,
  at: DateTime.Utc,
): Effect.Effect<unknown, LineupPersistenceFailed> {
  return tx
    .update(lineupWriteIntents)
    .set({ status, updatedAt: DateTime.toDateUtc(at) })
    .where(
      and(
        eq(lineupWriteIntents.id, intentId),
        eq(lineupWriteIntents.leaseToken, lease.token),
        eq(lineupWriteIntents.leaseGeneration, lease.generation),
      ),
    )
    .pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
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
    return yield* Effect.forEach(rows, (row) => decodeRun(row));
  }).pipe(
    Effect.mapError((cause) =>
      Schema.is(LineupPersistenceFailed)(cause) ? cause : LineupPersistenceFailed.make({ cause }),
    ),
  );
}

function decodeRun(
  row: typeof lineupRuns.$inferSelect,
): Effect.Effect<LineupRunRecord, LineupPersistenceFailed> {
  return Schema.decodeEffect(LineupRunRow)(row).pipe(
    Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })),
  );
}

function decodeDelivery(
  row: typeof lineupDeliveries.$inferSelect,
): Effect.Effect<LineupDeliveryRecord, LineupPersistenceFailed> {
  return Schema.decodeEffect(LineupDeliveryRow)(row).pipe(
    Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })),
  );
}

type TerminalInput = {
  readonly runId: LineupRunId;
  readonly lease: LineupLeaseRef;
  readonly outcome: LineupRunOutcome;
  readonly at: DateTime.Utc;
  readonly intent?: { readonly id: string; readonly status: IntentStatus };
};
