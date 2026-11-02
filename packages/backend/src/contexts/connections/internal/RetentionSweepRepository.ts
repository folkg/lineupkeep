import { and, eq, isNull, lte, or } from "drizzle-orm";
import { Array, DateTime, Effect, Layer } from "effect";

import { AccountRetention } from "#contexts/auth/AccountRetention.ts";
import type { LineupRunStatus } from "#contexts/connections/LineupRun.ts";
import { RetentionPersistenceFailed, RetentionSweep } from "#contexts/connections/Retention.ts";
import type { RetentionSummary } from "#contexts/connections/Retention.ts";
import { anyOf } from "#database/dbUtilities.ts";
import { retentionPolicy } from "#retention/RetentionPolicy.ts";

import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import { hostedLinkingSessions } from "./HostedLinkingTables.ts";
import {
  lineupDeliveries,
  lineupRequests,
  lineupRunAttempts,
  lineupRunDiagnostics,
  lineupRuns,
  lineupWriteIntents,
} from "./LineupRunTables.ts";
import { scheduleObservations } from "./ScheduleObservationTables.ts";

const terminalOutcomeStatuses = [
  "completed",
  "skipped",
  "blocked",
  "failed",
  "superseded",
] as const satisfies ReadonlyArray<LineupRunStatus>;
const terminalHostedLinkingStatuses = ["completed", "cancelled", "expired", "failed"] as const;

export const RetentionSweepLive = Layer.effect(
  RetentionSweep,
  Effect.gen(function* () {
    const database = yield* ConnectionsDatabase;
    const accountRetention = yield* AccountRetention;

    const run = Effect.fn("RetentionSweep.run")(function* (limit: number, now: DateTime.Utc) {
      const outcomesBefore = DateTime.toDateUtc(
        DateTime.subtractDuration(now, retentionPolicy.lineupRun.millis),
      );
      const observationsBefore = DateTime.formatIsoDate(
        DateTime.subtractDuration(now, retentionPolicy.scheduleObservation.millis),
      );
      const hostedLinkingBefore = DateTime.toDateUtc(
        DateTime.subtractDuration(now, retentionPolicy.hostedLinkingSession.millis),
      );
      const connections = yield* database
        .transaction((tx) =>
          Effect.gen(function* () {
            const diagnosticIds = yield* tx
              .select({ id: lineupRunDiagnostics.id })
              .from(lineupRunDiagnostics)
              .where(lte(lineupRunDiagnostics.expiresAt, DateTime.toDateUtc(now)))
              .orderBy(lineupRunDiagnostics.expiresAt)
              .limit(limit);
            const diagnostics = yield* deleteIds(tx, lineupRunDiagnostics, diagnosticIds);

            const oldRunIds = yield* tx
              .select({ id: lineupRuns.id })
              .from(lineupRuns)
              .where(
                and(
                  anyOf(lineupRuns.status, terminalOutcomeStatuses),
                  lte(lineupRuns.updatedAt, outcomesBefore),
                ),
              )
              .orderBy(lineupRuns.updatedAt)
              .limit(limit);
            const runIds = oldRunIds.map((row) => row.id);
            const attempts = yield* deleteRunChildren(tx, lineupRunAttempts, runIds);
            const writeIntents = yield* deleteRunChildren(tx, lineupWriteIntents, runIds);
            const runDiagnostics = yield* deleteRunChildren(tx, lineupRunDiagnostics, runIds);
            const runs = yield* deleteIds(tx, lineupRuns, oldRunIds);

            const orphanRequests = yield* tx
              .select({ userId: lineupRequests.userId, id: lineupRequests.id })
              .from(lineupRequests)
              .leftJoin(
                lineupRuns,
                and(
                  eq(lineupRuns.userId, lineupRequests.userId),
                  eq(lineupRuns.requestId, lineupRequests.id),
                ),
              )
              .where(and(lte(lineupRequests.createdAt, outcomesBefore), isNull(lineupRuns.id)))
              .orderBy(lineupRequests.createdAt)
              .limit(limit);
            let deliveries = 0;
            let requests = 0;
            if (orphanRequests.length > 0) {
              const requestIds = orphanRequests.map((row) => row.id);
              const deliveryRows = Array.isArrayNonEmpty(requestIds)
                ? yield* tx
                    .select({ id: lineupDeliveries.id })
                    .from(lineupDeliveries)
                    .where(
                      and(
                        anyOf(lineupDeliveries.requestId, requestIds),
                        lte(lineupDeliveries.createdAt, outcomesBefore),
                      ),
                    )
                : [];
              deliveries = yield* deleteIds(tx, lineupDeliveries, deliveryRows);
              requests = yield* deleteRequestIds(tx, orphanRequests);
            }

            const observations = yield* tx
              .delete(scheduleObservations)
              .where(lte(scheduleObservations.coversTo, observationsBefore))
              .returning({ subjectKey: scheduleObservations.subjectKey })
              .pipe(
                Effect.orDie,
                Effect.map((deleted) => deleted.length),
              );

            const oldHostedLinkingSessions = yield* tx
              .select({ id: hostedLinkingSessions.id })
              .from(hostedLinkingSessions)
              .where(
                and(
                  anyOf(hostedLinkingSessions.status, terminalHostedLinkingStatuses),
                  lte(hostedLinkingSessions.updatedAt, hostedLinkingBefore),
                ),
              )
              .orderBy(hostedLinkingSessions.updatedAt)
              .limit(limit);
            const hosted = yield* deleteIds(tx, hostedLinkingSessions, oldHostedLinkingSessions);

            const summary = {
              diagnostics: diagnostics + runDiagnostics,
              attempts,
              writeIntents,
              runs,
              requests,
              deliveries,
              scheduleObservations: observations,
              hostedLinkingSessions: hosted,
            };
            return summary;
          }),
        )
        .pipe(Effect.mapError((cause) => RetentionPersistenceFailed.make({ cause })));

      const account = yield* accountRetention
        .run(limit, now)
        .pipe(Effect.mapError((cause) => RetentionPersistenceFailed.make({ cause })));

      const summary: RetentionSummary = { ...connections, ...account };
      yield* Effect.annotateCurrentSpan({
        "retention.diagnostics": summary.diagnostics,
        "retention.runs": summary.runs,
        "retention.requests": summary.requests,
        "retention.schedule_observations": summary.scheduleObservations,
        "retention.hosted_linking_sessions": summary.hostedLinkingSessions,
        "retention.sessions": summary.sessions,
        "retention.verifications": summary.verifications,
        "retention.consents": summary.consents,
        "retention.registrations": summary.registrations,
      });
      return summary;
    });

    return RetentionSweep.of({ run });
  }),
);

type Transaction = Parameters<Parameters<ConnectionsDatabase["Service"]["transaction"]>[0]>[0];

function deleteIds(
  tx: Transaction,
  table:
    | typeof lineupRunDiagnostics
    | typeof lineupRuns
    | typeof lineupDeliveries
    | typeof hostedLinkingSessions,
  rows: ReadonlyArray<{ readonly id: string }>,
): Effect.Effect<number, never> {
  const ids = rows.map((row) => row.id);
  if (!Array.isArrayNonEmpty(ids)) {
    return Effect.succeed(0);
  }
  return tx
    .delete(table)
    .where(anyOf(table.id, ids))
    .returning({ id: table.id })
    .pipe(
      Effect.orDie,
      Effect.map((deleted) => deleted.length),
    );
}

function deleteRunChildren(
  tx: Transaction,
  table: typeof lineupRunAttempts | typeof lineupWriteIntents | typeof lineupRunDiagnostics,
  runIds: ReadonlyArray<string>,
): Effect.Effect<number, never> {
  const ids = [...runIds];
  if (!Array.isArrayNonEmpty(ids)) {
    return Effect.succeed(0);
  }
  return tx
    .delete(table)
    .where(anyOf(table.runId, ids))
    .returning({ runId: table.runId })
    .pipe(
      Effect.orDie,
      Effect.map((deleted) => deleted.length),
    );
}

function deleteRequestIds(
  tx: Transaction,
  requests: ReadonlyArray<{ readonly userId: string; readonly id: string }>,
): Effect.Effect<number, never> {
  if (requests.length === 0) {
    return Effect.succeed(0);
  }
  return tx
    .delete(lineupRequests)
    .where(
      or(
        ...requests.map((request) =>
          and(eq(lineupRequests.userId, request.userId), eq(lineupRequests.id, request.id)),
        ),
      ),
    )
    .returning({ id: lineupRequests.id })
    .pipe(
      Effect.orDie,
      Effect.map((deleted) => deleted.length),
    );
}
