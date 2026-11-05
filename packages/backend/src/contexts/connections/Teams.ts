import type { UserId } from "@lineupkeep/backend/auth/User";
import { Context, Schema } from "effect";
import type { Effect } from "effect";

import { ConnectionStatus } from "./Connection.ts";
import {
  FantasyTeam,
  TeamAvailability,
  TeamAutomation,
  TeamAutomationStatus,
  TeamId,
} from "./FantasyTeam.ts";
import { LineupRun } from "./LineupRun.ts";

export const TeamSummary = Schema.Struct({
  team: FantasyTeam,
  connectionStatus: ConnectionStatus,
  connectionCount: Schema.Int.check(Schema.isGreaterThan(0)),
  lastRun: Schema.optional(LineupRun),
  recentRuns: Schema.Array(LineupRun),
});
export type TeamSummary = typeof TeamSummary.Type;

export const TeamAutomationAction = Schema.Literals(["enable", "disable", "pause-today", "resume"]);
export type TeamAutomationAction = typeof TeamAutomationAction.Type;

export const TeamControlInput = Schema.Struct({
  team: TeamId,
  action: TeamAutomationAction,
});
export type TeamControlInput = typeof TeamControlInput.Type;

const ControlledTeam = Schema.Struct({
  team: TeamId,
  action: TeamAutomationAction,
  enrolled: Schema.Boolean,
  availability: TeamAvailability,
  automation: TeamAutomation,
  detail: Schema.NonEmptyString,
});

const MissingTeam = Schema.Struct({
  team: TeamId,
  action: TeamAutomationAction,
  detail: Schema.NonEmptyString,
});

export const TeamControlResult = Schema.Union([
  Schema.Struct({ outcome: Schema.Literal("changed"), ...ControlledTeam.fields }),
  Schema.Struct({ outcome: Schema.Literal("unchanged"), ...ControlledTeam.fields }),
  Schema.Struct({ outcome: Schema.Literal("rejected"), ...ControlledTeam.fields }),
  Schema.Struct({ outcome: Schema.Literal("not_found"), ...MissingTeam.fields }),
]);
export type TeamControlResult = typeof TeamControlResult.Type;

export const TeamNoteInput = Schema.Struct({
  team: TeamId,
  note: Schema.String,
});
export type TeamNoteInput = typeof TeamNoteInput.Type;

export const TeamNoteSaved = Schema.Struct({
  team: TeamId,
  note: Schema.NullOr(Schema.NonEmptyString),
  updatedAt: Schema.NullOr(Schema.DateTimeUtc),
});
export type TeamNoteSaved = typeof TeamNoteSaved.Type;

export type TeamError = TeamNotFound | TeamControlRejected | TeamPersistenceFailed;

export type TeamNoteError = TeamNotFound | TeamNoteRejected | TeamPersistenceFailed;

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

export class TeamNoteRejected extends Schema.TaggedError<
  TeamNoteRejected,
  { readonly brand: unique symbol }
>()("team.note_rejected", {
  team: TeamId,
  reason: Schema.Literal("too_long"),
  message: Schema.NonEmptyString,
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

  readonly control: (
    userId: UserId,
    inputs: ReadonlyArray<TeamControlInput>,
  ) => Effect.Effect<ReadonlyArray<TeamControlResult>, TeamPersistenceFailed>;

  readonly saveNote: (
    userId: UserId,
    input: TeamNoteInput,
  ) => Effect.Effect<TeamNoteSaved, TeamNoteError>;
};
