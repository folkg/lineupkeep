import { Context, Schema } from "effect";
import type { Effect } from "effect";

const NotificationSummary = Schema.Struct({
  sent: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  retried: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  cancelled: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  failed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
type NotificationSummary = typeof NotificationSummary.Type;

export class Notifications extends Context.Service<Notifications, NotificationsShape>()(
  "@lineupkeep/backend/contexts/connections/Notifications",
) {}

export type NotificationsShape = {
  readonly run: (
    limit: number,
    at: import("effect").DateTime.Utc,
  ) => Effect.Effect<NotificationSummary, NotificationsFailed>;
};

export class NotificationsFailed extends Schema.TaggedError<
  NotificationsFailed,
  { readonly brand: unique symbol }
>()("notifications.failed", {
  cause: Schema.Defect(),
}) {}
