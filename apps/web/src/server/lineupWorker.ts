import type { AutomationFailed } from "@lineupkeep/backend/connections/Automation";
import { Automation } from "@lineupkeep/backend/connections/Automation";
import { LineupRunId } from "@lineupkeep/backend/connections/LineupRun";
import { LineupDispatcher, LineupWorker } from "@lineupkeep/backend/connections/LineupWork";
import { Notifications } from "@lineupkeep/backend/connections/Notifications";
import { FeedbackRetention } from "@lineupkeep/backend/feedback/FeedbackRetention";
import { DateTime, Config, Effect, Option, Schema } from "effect";

import { runBackend } from "./backendEntry.ts";

const LineupWorkerRequest = Schema.Union([
  Schema.Struct({
    action: Schema.Literal("deliver"),
    runs: Schema.Array(LineupRunId).pipe(
      Schema.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
    ),
  }),
  Schema.Struct({
    action: Schema.Literal("repair"),
    limit: Schema.optional(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
    ),
  }),
  Schema.Struct({
    action: Schema.Literal("tick"),
    limit: Schema.optional(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
    ),
  }),
]);
const LineupWorkerRequestJson = Schema.fromJsonString(LineupWorkerRequest);

export function handleLineupWorkerRequest(request: Request): Promise<Response> {
  return runBackend(
    request,
    "lineup.worker",
    Effect.gen(function* () {
      const enabled = yield* Config.option(Config.String("LINEUP_WORKER_ENABLED"));
      if (Option.isNone(enabled) || enabled.value !== "true") {
        return new Response("Not found", { status: 404 });
      }
      const decoded = yield* Effect.tryPromise(() => request.text()).pipe(
        Effect.flatMap((body) => Schema.decodeEffect(LineupWorkerRequestJson)(body)),
        Effect.option,
      );
      if (Option.isNone(decoded)) {
        return new Response("Invalid worker request", { status: 400 });
      }
      return yield* execute(decoded.value).pipe(
        Effect.catchTags({
          "lineup.persistence_failed": () =>
            Effect.succeed(
              new Response("The worker could not persist its result", { status: 503 }),
            ),
          "automation.failed": () =>
            Effect.succeed(new Response("The automation tick could not finish", { status: 503 })),
          "notifications.failed": () =>
            Effect.succeed(new Response("Notifications could not be delivered", { status: 503 })),
          "feedback.persistence_failed": () =>
            Effect.succeed(new Response("Feedback retention could not finish", { status: 503 })),
        }),
      );
    }),
  );
}

function execute(
  request: typeof LineupWorkerRequest.Type,
): Effect.Effect<
  Response,
  | import("@lineupkeep/backend/connections/LineupRun").LineupPersistenceFailed
  | import("@lineupkeep/backend/connections/Notifications").NotificationsFailed
  | import("@lineupkeep/backend/feedback/Feedback").FeedbackPersistenceFailed
  | AutomationFailed,
  LineupWorker | LineupDispatcher | Automation | Notifications | FeedbackRetention
> {
  return Effect.gen(function* () {
    switch (request.action) {
      case "deliver": {
        const worker = yield* LineupWorker;
        const dispatcher = yield* LineupDispatcher;
        const report = yield* worker.deliver(request.runs);
        yield* dispatcher
          .dispatchPending(20)
          .pipe(
            Effect.catchTag("lineup.persistence_failed", (cause) =>
              Effect.logWarning("A waiting lineup run could not be started", cause),
            ),
          );
        return json({
          status: report.stopped.length === 0 ? "ok" : "incomplete",
          action: request.action,
          processed: request.runs.length,
          ...(report.stopped.length === 0 ? {} : { stopped: report.stopped }),
        });
      }
      case "repair": {
        const dispatcher = yield* LineupDispatcher;
        const summary = yield* dispatcher.repair(request.limit ?? 50);
        return json({ status: "ok", action: request.action, ...summary });
      }
      case "tick": {
        const automation = yield* Automation;
        const notifications = yield* Notifications;
        const feedbackRetention = yield* FeedbackRetention;
        const at = yield* DateTime.now;
        const summary = yield* automation.run(request.limit ?? 50);
        const delivered = yield* notifications.run(request.limit ?? 50, at);
        const feedback = yield* feedbackRetention.run(request.limit ?? 50, at);
        return json({
          status: "ok",
          action: request.action,
          ...summary,
          notifications: delivered,
          feedback,
        });
      }
    }
  });
}

function json(value: unknown): Response {
  return Response.json(value, { headers: { "cache-control": "no-store" } });
}
