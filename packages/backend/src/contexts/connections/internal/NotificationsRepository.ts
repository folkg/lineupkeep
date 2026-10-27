import { and, eq, lte } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Array, DateTime, Effect, Layer, Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { UserDirectory } from "#contexts/auth/UserDirectory.ts";
import { Notifications, NotificationsFailed } from "#contexts/connections/Notifications.ts";
import { anyOf } from "#database/dbUtilities.ts";
import { EmailDelivery } from "#email/EmailDelivery.ts";
import type { EmailMessage } from "#email/EmailDelivery.ts";

import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import { providerConnections } from "./ConnectionTables.ts";
import { connectionIncidents, notifications } from "./IncidentTables.ts";

const staleSendingMillis = 10 * 60 * 1000;
const retryDelaysMillis = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  6 * 60 * 60_000,
] as const;

export const NotificationsLive = Layer.effect(
  Notifications,
  Effect.gen(function* () {
    const database = yield* ConnectionsDatabase;
    const directory = yield* UserDirectory;
    const email = yield* EmailDelivery;

    const updateNotifications = (
      ids: ReadonlyArray<string>,
      values: NotificationUpdate,
    ): Effect.Effect<void, EffectDrizzleQueryError> => {
      const first = ids[0];
      if (first === undefined) {
        return Effect.void;
      }
      const targetIds: [string, ...string[]] = [first, ...ids.slice(1)];
      return database
        .update(notifications)
        .set(values)
        .where(anyOf(notifications.id, targetIds))
        .pipe(Effect.asVoid);
    };

    const run = Effect.fn("Notifications.run")(function* (limit: number, at: DateTime.Utc) {
      const now = DateTime.toDateUtc(at);
      yield* database
        .update(notifications)
        .set({ status: "pending", nextAttemptAt: now, updatedAt: now })
        .where(
          and(
            eq(notifications.status, "sending"),
            lte(
              notifications.updatedAt,
              DateTime.toDateUtc(DateTime.subtractDuration(at, staleSendingMillis)),
            ),
          ),
        );

      const rows = yield* database
        .select({
          notificationId: notifications.id,
          userId: notifications.userId,
          incidentId: connectionIncidents.id,
          incidentStatus: connectionIncidents.status,
          connectionId: connectionIncidents.connectionId,
          credentialGeneration: connectionIncidents.credentialGeneration,
          connectionStatus: providerConnections.status,
          connectionGeneration: providerConnections.credentialGeneration,
          attempts: notifications.attempts,
        })
        .from(notifications)
        .innerJoin(connectionIncidents, eq(connectionIncidents.id, notifications.incidentId))
        .innerJoin(
          providerConnections,
          eq(providerConnections.id, connectionIncidents.connectionId),
        )
        .where(and(eq(notifications.status, "pending"), lte(notifications.nextAttemptAt, now)))
        .orderBy(notifications.nextAttemptAt)
        .limit(limit);

      const userIds = yield* Effect.forEach([...new Set(rows.map((row) => row.userId))], (id) =>
        Schema.decodeEffect(UserId)(id).pipe(
          Effect.mapError((cause) => NotificationsFailed.make({ cause })),
        ),
      );
      const emails = new Map(
        (yield* directory.emailsFor(userIds)).map((entry) => [entry.userId, entry.email]),
      );

      const notificationIds = rows.map((row) => row.notificationId);
      if (!Array.isArrayNonEmpty(notificationIds)) {
        return { sent: 0, retried: 0, cancelled: 0, failed: 0 };
      }
      const claimed = yield* database
        .update(notifications)
        .set({ status: "sending", updatedAt: now })
        .where(and(anyOf(notifications.id, notificationIds), eq(notifications.status, "pending")))
        .returning({ id: notifications.id });
      const claimedIds = new Set(claimed.map((row) => row.id));
      const claimedRows = rows.filter((row) => claimedIds.has(row.notificationId));

      const cancelledIds: string[] = [];
      const missingEmailIds: string[] = [];
      const messages: EmailMessage[] = [];
      const messageRows: typeof claimedRows = [];
      for (const row of claimedRows) {
        const stillRequired =
          row.incidentStatus === "open" &&
          row.connectionStatus === "reconnect-required" &&
          row.connectionGeneration === row.credentialGeneration;
        if (!stillRequired) {
          cancelledIds.push(row.notificationId);
          continue;
        }
        const recipient = emails.get(row.userId);
        if (recipient === undefined) {
          missingEmailIds.push(row.notificationId);
          continue;
        }
        messages.push(reconnectEmail(row.incidentId, recipient));
        messageRows.push(row);
      }

      const results = yield* email.sendMany(messages);
      const sentByAttempts = new Map<number, string[]>();
      const rejectedByAttempts = new Map<number, string[]>();
      const retryByAttempts = new Map<number, string[]>();
      for (const [index, result] of results.entries()) {
        const row = messageRows[index];
        if (row === undefined) {
          continue;
        }
        if (result._tag === "sent") {
          addToBucket(sentByAttempts, row.attempts, row.notificationId);
        } else if (result.reason === "rejected") {
          addToBucket(rejectedByAttempts, row.attempts, row.notificationId);
        } else {
          addToBucket(retryByAttempts, row.attempts, row.notificationId);
        }
      }

      if (cancelledIds.length > 0) {
        yield* updateNotifications(cancelledIds, {
          status: "cancelled",
          updatedAt: now,
        });
      }
      if (missingEmailIds.length > 0) {
        yield* updateNotifications(missingEmailIds, {
          status: "failed",
          lastError: "No verified email address for the account",
          updatedAt: now,
        });
      }
      for (const [attempts, ids] of sentByAttempts) {
        yield* updateNotifications(ids, {
          status: "sent",
          attempts: attempts + 1,
          sentAt: now,
          updatedAt: now,
          lastError: null,
        });
      }
      for (const [attempts, ids] of rejectedByAttempts) {
        yield* updateNotifications(ids, {
          status: "failed",
          attempts: attempts + 1,
          lastError: "The email provider rejected the message",
          updatedAt: now,
        });
      }
      for (const [attempts, ids] of retryByAttempts) {
        yield* updateNotifications(ids, {
          status: "pending",
          attempts: attempts + 1,
          nextAttemptAt: nextAttemptAt(at, attempts + 1),
          lastError: "The email provider was unavailable",
          updatedAt: now,
        });
      }

      const summary = {
        sent: countBucket(sentByAttempts),
        retried: countBucket(retryByAttempts),
        cancelled: cancelledIds.length,
        failed: missingEmailIds.length + countBucket(rejectedByAttempts),
      };
      yield* Effect.annotateCurrentSpan({
        "notifications.sent": summary.sent,
        "notifications.retried": summary.retried,
        "notifications.cancelled": summary.cancelled,
        "notifications.failed": summary.failed,
      });
      return summary;
    });

    return Notifications.of({
      run: (limit, at) =>
        run(limit, at).pipe(Effect.mapError((cause) => NotificationsFailed.make({ cause }))),
    });
  }),
);

type NotificationUpdate = Partial<
  Pick<
    typeof notifications.$inferInsert,
    "status" | "attempts" | "nextAttemptAt" | "lastError" | "sentAt" | "updatedAt"
  >
>;

function addToBucket(buckets: Map<number, string[]>, attempts: number, id: string): void {
  const bucket = buckets.get(attempts) ?? [];
  bucket.push(id);
  buckets.set(attempts, bucket);
}

function countBucket(buckets: ReadonlyMap<number, ReadonlyArray<string>>): number {
  let total = 0;
  for (const ids of buckets.values()) {
    total += ids.length;
  }
  return total;
}

function reconnectEmail(incidentId: string, to: string): EmailMessage {
  return {
    to,
    subject: "Action required: reconnect your fantasy provider for Lineupkeep",
    text: [
      "Lineupkeep cannot run your lineups because your provider connection needs to be reconnected.",
      "",
      "Open Lineupkeep and go to Connections to reconnect your provider. Your team automation settings are unchanged.",
      "",
      "You will not receive another reminder for this connection until it is reconnected.",
    ].join("\n"),
    purpose: "connection-reconnect-required",
    idempotencyKey: `connection-reconnect:${incidentId}`,
  };
}

function nextAttemptAt(at: DateTime.Utc, attempts: number): Date {
  const index = Math.min(Math.max(attempts - 1, 0), retryDelaysMillis.length - 1);
  return DateTime.toDateUtc(DateTime.addDuration(at, retryDelaysMillis[index] ?? 6 * 60 * 60_000));
}
