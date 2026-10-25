import type { UserId } from "@lineupkeep/backend/auth/User";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

import { ConnectionStatus } from "./Connection.ts";
import { FantasyTeam, TeamAutomationStatus, TeamId } from "./FantasyTeam.ts";
import { LineupRun } from "./LineupRun.ts";

export const TeamSummary = Schema.Struct({
  team: FantasyTeam,
  connectionStatus: ConnectionStatus,
  lastRun: Schema.optional(LineupRun),
  recentRuns: Schema.Array(LineupRun),
});
export type TeamSummary = typeof TeamSummary.Type;

export const TeamEnabledInput = Schema.Struct({
  team: TeamId,
  enabled: Schema.Boolean,
});
export type TeamEnabledInput = typeof TeamEnabledInput.Type;

export const TeamPauseInput = Schema.Struct({
  team: TeamId,
});
export type TeamPauseInput = typeof TeamPauseInput.Type;

export type TeamError = TeamNotFound | TeamControlRejected | TeamPersistenceFailed;

export class TeamNotFound extends Schema.TaggedError<
  TeamNotFound,
  { readonly brand: unique symbol }
>()("team.not_found", {
  team: TeamId,
}) {}

export class TeamControlRejected extends Schema.TaggedError<
  TeamControlRejected,
  { readonly brand: unique symbol }
>()("team.control_rejected", {
  team: TeamId,
  status: TeamAutomationStatus,
}) {}

export class TeamPersistenceFailed extends Schema.TaggedError<
  TeamPersistenceFailed,
  { readonly brand: unique symbol }
>()("team.persistence_failed", {
  cause: Schema.Defect(),
}) {}

export class Teams extends Context.Service<Teams, TeamsShape>()(
  "@lineupkeep/backend/contexts/connections/Teams",
) {}

export type TeamsShape = {
  readonly list: (userId: UserId) => Effect.Effect<ReadonlyArray<TeamSummary>, TeamError>;

  readonly get: (userId: UserId, team: TeamId) => Effect.Effect<TeamSummary, TeamError>;

  readonly setEnabled: (
    userId: UserId,
    inputs: ReadonlyArray<TeamEnabledInput>,
  ) => Effect.Effect<ReadonlyArray<TeamSummary>, TeamError>;

  readonly pause: (
    userId: UserId,
    inputs: ReadonlyArray<TeamPauseInput>,
  ) => Effect.Effect<ReadonlyArray<TeamSummary>, TeamError>;
};
