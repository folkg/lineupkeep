import { Context } from "effect";
import type { DateTime, Effect, Redacted } from "effect";

import type { UserId } from "#contexts/auth/User.ts";

import type { FantasyTeam } from "./FantasyTeam.ts";
import type { LineupRunId } from "./LineupRun.ts";
import type { ProviderShape } from "./Provider.ts";

export type ScheduleGateRunReason =
  | "no_game_source"
  | "game_source_unavailable"
  | "game_observation_stale"
  | "provider_schedule_unavailable"
  | "provider_schedule_stale"
  | "roster_team_unmapped"
  | "provider_game_missing_from_source"
  | "game_start_unknown"
  | "game_before_next_tick"
  | "invalid_window"
  | "unexpected_error"
  | "no_run_today"
  | "last_run_blocked"
  | "last_run_unverified"
  | "run_state_unavailable";

export type TodayLineupRun =
  | { readonly kind: "none" }
  | { readonly kind: "verified" }
  | { readonly kind: "blocked" }
  | { readonly kind: "unverified" };

export type ScheduleGateDecision =
  | { readonly kind: "run"; readonly reason: ScheduleGateRunReason }
  | {
      readonly kind: "skip";
      readonly summary: string;
      readonly nextTickAt: DateTime.Utc;
      readonly nextGameAt?: DateTime.Utc;
    };

type ScheduleGateInput = {
  readonly team: FantasyTeam;
  readonly provider: ProviderShape;
  readonly session: Redacted.Redacted<string>;
  readonly now: DateTime.Utc;
  readonly userId: UserId;
  readonly excludingRun: LineupRunId;
};

export class ScheduleGate extends Context.Service<ScheduleGate, ScheduleGateShape>()(
  "@lineupkeep/backend/contexts/connections/ScheduleGate",
) {}

export type ScheduleGateShape = {
  readonly evaluate: (input: ScheduleGateInput) => Effect.Effect<ScheduleGateDecision, never>;
};
