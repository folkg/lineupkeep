import { Context } from "effect";
import type { Effect } from "effect";

import type { ConnectionError } from "./Connection.ts";

type TeamAvailabilitySweepSummary = {
  readonly connectionsChecked: number;
  readonly connectionsSkipped: number;
  readonly leaguesChecked: number;
  readonly teamsObserved: number;
  readonly teamsUnavailable: number;
};

export class TeamAvailabilitySweep extends Context.Service<
  TeamAvailabilitySweep,
  TeamAvailabilitySweepShape
>()("@lineupkeep/backend/contexts/connections/TeamAvailabilitySweep") {}

export type TeamAvailabilitySweepShape = {
  readonly run: (limit: number) => Effect.Effect<TeamAvailabilitySweepSummary, ConnectionError>;
};
