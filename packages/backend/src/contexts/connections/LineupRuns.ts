import type { UserId } from "@lineupkeep/backend/auth/User";
import { Context } from "effect";
import type { Effect } from "effect";

import type {
  GetLineupRunsInput,
  LineupError,
  LineupRunId,
  LineupRunsData,
  LineupSubmitData,
  LineupRequestInput,
} from "./LineupRun.ts";

export class LineupRuns extends Context.Service<LineupRuns, LineupRunsShape>()(
  "@lineupkeep/backend/contexts/connections/LineupRuns",
) {}

export type LineupRunsShape = {
  readonly submit: (
    userId: UserId,
    input: LineupRequestInput,
  ) => Effect.Effect<LineupSubmitData, LineupError>;

  readonly get: (
    userId: UserId,
    input: GetLineupRunsInput,
  ) => Effect.Effect<LineupRunsData, LineupError>;

  readonly wait: (
    userId: UserId,
    runs: ReadonlyArray<LineupRunId>,
    timeoutMs: number,
  ) => Effect.Effect<LineupRunsData, LineupError>;
};
