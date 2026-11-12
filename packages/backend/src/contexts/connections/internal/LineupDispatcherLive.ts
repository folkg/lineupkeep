import { DateTime, Effect, Layer } from "effect";

import type { LineupRequestId, LineupRunId } from "#contexts/connections/LineupRun.ts";
import { LineupDispatcher } from "#contexts/connections/LineupWork.ts";
import type { LineupDispatcherShape } from "#contexts/connections/LineupWork.ts";
import { LineupDelivery } from "#contexts/connections/LineupWork.ts";

import { LineupRunRepository } from "./LineupRunRepository.ts";

export const LineupDispatcherLive = Layer.effect(
  LineupDispatcher,
  Effect.gen(function* () {
    const repository = yield* LineupRunRepository;
    const delivery = yield* LineupDelivery;

    const dispatchRequest: LineupDispatcherShape["dispatchRequest"] = (userId, requestId) =>
      dispatchById(userId, requestId).pipe(
        Effect.catchTag("lineup.persistence_failed", () => Effect.succeed("pending" as const)),
      );

    const dispatchPending: LineupDispatcherShape["dispatchPending"] = (limit) =>
      Effect.gen(function* () {
        const now = yield* DateTime.now;
        const claimed = yield* repository.claimDeliveries(now, limit);
        if (claimed.length === 0) {
          return { delivered: 0, pending: 0 };
        }
        const blocked = yield* repository.blockedRunIds(claimed.flatMap((record) => record.runIds));
        const runnable = claimed.filter((record) =>
          record.runIds.every((runId) => !blocked.has(runId)),
        );
        const held = claimed.filter((record) => !runnable.includes(record));
        if (held.length > 0) {
          yield* repository.finishDeliveries(
            held.map((record) => ({ deliveryId: record.id, at: now, outcome: "pending" as const })),
          );
        }
        if (runnable.length === 0) {
          return { delivered: 0, pending: held.length };
        }
        const result = yield* Effect.result(
          delivery.enqueueMany(
            runnable.map((record) => ({ delivery: record.id, runs: record.runIds })),
          ),
        );
        if (result._tag === "Success") {
          yield* repository.finishDeliveries(
            runnable.map((record) => ({ deliveryId: record.id, at: now, outcome: "dispatched" })),
          );
          return { delivered: runnable.length, pending: held.length };
        }
        yield* repository.finishDeliveries(
          runnable.map((record) => ({
            deliveryId: record.id,
            at: now,
            outcome: "pending" as const,
            error: result.failure._tag,
          })),
        );
        yield* Effect.annotateCurrentSpan({
          "lineup.delivery_count": runnable.length,
          "app.outcome": "failure",
          "error.type": result.failure._tag,
        });
        return { delivered: 0, pending: claimed.length };
      });

    const repair: LineupDispatcherShape["repair"] = (limit) =>
      Effect.gen(function* () {
        const dispatched = yield* dispatchPending(limit);
        const now = yield* DateTime.now;
        const stale = yield* repository.staleRequests(now, limit);
        const records = yield* repository.loadDeliveriesForRequests(stale);
        if (records.length === 0) {
          return dispatched;
        }
        const result = yield* Effect.result(
          delivery.enqueueMany(
            records.map((record) => ({ delivery: record.id, runs: record.runIds })),
          ),
        );
        return result._tag === "Success"
          ? { delivered: dispatched.delivered + records.length, pending: dispatched.pending }
          : { delivered: dispatched.delivered, pending: dispatched.pending + records.length };
      });

    const dispatchById = Effect.fnUntraced(function* (
      userId: Parameters<LineupDispatcherShape["dispatchRequest"]>[0],
      requestId: LineupRequestId,
    ) {
      const record = yield* repository.loadDelivery(userId, requestId);
      if (record === undefined || record.status === "dispatched") {
        return "queued" as const;
      }
      const claimed = yield* repository.claimDeliveries(yield* DateTime.now, 1);
      const target = claimed.find((delivery) => delivery.id === record.id);
      if (target === undefined) {
        return "queued" as const;
      }
      return yield* deliverClaimed(target.id, target.runIds);
    });

    const deliverClaimed = Effect.fnUntraced(function* (
      deliveryId: string,
      runIds: ReadonlyArray<LineupRunId>,
    ) {
      const result = yield* Effect.result(
        delivery.enqueueMany([{ delivery: deliveryId, runs: runIds }]),
      );
      const at = yield* DateTime.now;
      if (result._tag === "Success") {
        yield* repository.finishDeliveries([{ deliveryId, at, outcome: "dispatched" }]);
        return "queued" as const;
      }
      yield* repository.finishDeliveries([
        { deliveryId, at, outcome: "pending", error: result.failure._tag },
      ]);
      yield* Effect.annotateCurrentSpan({
        "lineup.delivery": deliveryId,
        "app.outcome": "failure",
        "error.type": result.failure._tag,
      });
      return "pending" as const;
    });

    return LineupDispatcher.of({
      dispatchRequest,
      dispatchPending,
      repair,
    });
  }),
);
