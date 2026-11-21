import { and, eq, lte } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { Array, DateTime, Effect, Layer, Schema } from "effect";
import { Array as EffectArray } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { UserDirectory } from "#contexts/auth/UserDirectory.ts";
import { Notifications, NotificationsFailed } from "#contexts/connections/Notifications.ts";
import { mutateRows } from "#database/dbUtilities.ts";
import { EmailDelivery } from "#email/EmailDelivery.ts";
import type { EmailMessage } from "#email/EmailDelivery.ts";
import { plan, snapshotOf } from "#utilities/machine.ts";

import {
  ConnectionNotificationWorkflow,
  type ConnectionNotificationEvent,
} from "./ConnectionNotificationWorkflow.ts";
import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import { providerConnections } from "./ConnectionTables.ts";
import { connectionIncidents, notifications, NotificationsRow } from "./IncidentTables.ts";

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

    const applyEvents = (
      events: ReadonlyMap<string, ConnectionNotificationEvent>,
      where?: SQL,
    ): Effect.Effect<ReadonlyArray<typeof NotificationsRow.Type>, NotificationsFailed> => {
      const ids = [...events.keys()];
      if (!Array.isArrayNonEmpty(ids)) {
        return Effect.succeed([]);
      }
      return database
        .transaction((tx) =>
          mutateRows(tx, notifications, {
            where,
            ids,
            codec: NotificationsRow,
            plan: (locked) =>
              Effect.forEach(
                [...locked.values()],
                (row) => {
                  const event = events.get(row.id);
                  if (event === undefined) {
                    throw new Error("A locked notification has no event");
                  }
                  return Effect.map(
                    Effect.flatMap(
                      snapshotOf(ConnectionNotificationWorkflow, row.state),
                      (snapshot) => plan(ConnectionNotificationWorkflow, snapshot, event),
                    ),
                    (state) => ({ ...row, state }),
                  );
                },
                { concurrency: 1 },
              ),
          }),
        )
        .pipe(Effect.mapError((cause) => NotificationsFailed.make({ cause })));
    };

    const run = Effect.fn("Notifications.run")(function* (limit: number, at: DateTime.Utc) {
      const now = DateTime.toDateUtc(at);
      const stalePredicate = and(
        eq(notifications.status, "sending"),
        lte(
          notifications.updatedAt,
          DateTime.toDateUtc(DateTime.subtractDuration(at, staleSendingMillis)),
        ),
      );
      const stale = yield* database
        .select({ id: notifications.id })
        .from(notifications)
        .where(stalePredicate);
      yield* applyEvents(
        new Map(EffectArray.map(stale, (row) => [row.id, { _tag: "Reclaimed", at } as const])),
        stalePredicate,
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

      const userIds = yield* Effect.forEach(
        [...new Set(EffectArray.map(rows, (row) => row.userId))],
        (id) =>
          Schema.decodeEffect(UserId)(id).pipe(
            Effect.mapError((cause) => NotificationsFailed.make({ cause })),
          ),
        { concurrency: 1 },
      );
      const yielded1 = yield* directory.emailsFor(userIds);
      const emails = new Map(EffectArray.map(yielded1, (entry) => [entry.userId, entry.email]));

      const notificationIds = EffectArray.map(rows, (row) => row.notificationId);
      if (!Array.isArrayNonEmpty(notificationIds)) {
        return { sent: 0, retried: 0, cancelled: 0, failed: 0 };
      }
      const claimed = yield* database.transaction((tx) =>
        mutateRows(tx, notifications, {
          where: eq(notifications.status, "pending"),
          ids: notificationIds,
          codec: NotificationsRow,
          plan: (locked) =>
            Effect.forEach(
              [...locked.values()],
              (row) =>
                Effect.map(
                  Effect.flatMap(
                    snapshotOf(ConnectionNotificationWorkflow, row.state),
                    (snapshot) =>
                      plan(ConnectionNotificationWorkflow, snapshot, { _tag: "Claimed", at }),
                  ),
                  (state) => ({ ...row, state }),
                ),
              { concurrency: 1 },
            ),
        }),
      );
      const claimedIds = new Set(EffectArray.map(claimed, (row) => row.id));
      const claimedRows = EffectArray.filter(rows, (row) => claimedIds.has(row.notificationId));

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
      const events = new Map<string, ConnectionNotificationEvent>();
      for (const id of cancelledIds) {
        events.set(id, { _tag: "Cancelled", at });
      }
      for (const id of missingEmailIds) {
        events.set(id, {
          _tag: "Undeliverable",
          at,
          error: "No verified email address for the account",
        });
      }
      let sent = 0;
      let retried = 0;
      let rejected = 0;
      for (const [index, result] of results.entries()) {
        const row = messageRows[index];
        if (row === undefined) {
          continue;
        }
        if (result._tag === "sent") {
          events.set(row.notificationId, { _tag: "Sent", at });
          sent++;
        } else if (result.reason === "rejected") {
          events.set(row.notificationId, {
            _tag: "Rejected",
            at,
            error: "The email provider rejected the message",
          });
          rejected++;
        } else {
          events.set(row.notificationId, {
            _tag: "Retried",
            at,
            nextAttemptAt: nextAttemptAt(at, row.attempts + 1),
            error: "The email provider was unavailable",
          });
          retried++;
        }
      }
      yield* applyEvents(events);

      const summary = {
        sent,
        retried,
        cancelled: cancelledIds.length,
        failed: missingEmailIds.length + rejected,
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

function reconnectEmail(incidentId: string, to: string): EmailMessage {
  return {
    to,
    subject: "Action required: reconnect your fantasy provider for Lineupgrade",
    text: EffectArray.join(
      [
        "Lineupgrade cannot run your lineups because your provider connection needs to be reconnected.",
        "",
        "Open Lineupgrade and go to Connections to reconnect your provider. Your team automation settings are unchanged.",
        "",
        "You will not receive another reminder for this connection until it is reconnected.",
      ],
      "\n",
    ),
    purpose: "connection-reconnect-required",
    idempotencyKey: `connection-reconnect:${incidentId}`,
  };
}

function nextAttemptAt(at: DateTime.Utc, attempts: number): DateTime.Utc {
  const index = Math.min(Math.max(attempts - 1, 0), retryDelaysMillis.length - 1);
  return DateTime.addDuration(at, retryDelaysMillis[index] ?? 6 * 60 * 60_000);
}
