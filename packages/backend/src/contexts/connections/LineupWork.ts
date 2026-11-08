import type { UserId } from "@lineupkeep/backend/auth/User";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

import type { ConnectionId } from "./Connection.ts";
import type { LineupPersistenceFailed, LineupRequestId, LineupRunId } from "./LineupRun.ts";

export class LineupDispatcher extends Context.Service<LineupDispatcher, LineupDispatcherShape>()(
  "@lineupkeep/backend/contexts/connections/LineupWork/LineupDispatcher",
) {}

export type LineupDispatcherShape = {
  readonly dispatchRequest: (
    userId: UserId,
    request: LineupRequestId,
  ) => Effect.Effect<LineupDeliveryState, LineupPersistenceFailed>;

  readonly dispatchPending: (
    limit: number,
  ) => Effect.Effect<LineupDispatchSummary, LineupPersistenceFailed>;

  readonly repair: (limit: number) => Effect.Effect<LineupRepairSummary, LineupPersistenceFailed>;
};

const LineupDeliveryState = Schema.Literals(["queued", "pending"]);
type LineupDeliveryState = typeof LineupDeliveryState.Type;

type LineupDispatchSummary = {
  readonly delivered: number;
  readonly pending: number;
};

type LineupRepairSummary = {
  readonly delivered: number;
  readonly pending: number;
};

export class LineupDelivery extends Context.Service<LineupDelivery, LineupDeliveryShape>()(
  "@lineupkeep/backend/contexts/connections/LineupWork/LineupDelivery",
) {}

export type LineupDeliveryShape = {
  readonly enqueueMany: (
    inputs: ReadonlyArray<LineupDeliveryInput>,
  ) => Effect.Effect<void, LineupDeliveryFailed>;
};

export type LineupDeliveryInput = {
  readonly delivery: string;
  readonly runs: ReadonlyArray<LineupRunId>;
};

export class LineupDeliveryFailed extends Schema.TaggedError<
  LineupDeliveryFailed,
  { readonly brand: unique symbol }
>()("lineup.delivery_failed", {
  reason: Schema.Literals(["unavailable", "rejected"]),
}) {}

export class LineupWorker extends Context.Service<LineupWorker, LineupWorkerShape>()(
  "@lineupkeep/backend/contexts/connections/LineupWork/LineupWorker",
) {}

export type LineupWorkerShape = {
  readonly deliver: (
    runs: ReadonlyArray<LineupRunId>,
  ) => Effect.Effect<LineupDeliveryReport, LineupPersistenceFailed>;
};

export type LineupDeliveryReport = {
  readonly stopped: ReadonlyArray<{
    readonly connectionId: ConnectionId;
    readonly detail: string;
  }>;
};
