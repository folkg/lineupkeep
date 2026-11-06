import type { ConnectionStatus } from "@lineupkeep/backend/connections/Connection";
import type {
  FantasyLeague,
  FantasySport,
  TeamAvailability,
  TeamAutomationStatus,
} from "@lineupkeep/backend/connections/FantasyTeam";
import type {
  LineupRunStatus,
  LineupTargetPeriod,
  LineupTrigger,
} from "@lineupkeep/backend/connections/LineupRun";
import type { TeamControlInput } from "@lineupkeep/backend/connections/Teams";

import type { AuthenticationFailure } from "#contracts/auth/authContract.ts";
import type { UseCaseResult } from "#contracts/useCaseContract.ts";

export type TeamAutomationView = {
  readonly status: TeamAutomationStatus;
  readonly changedAt: string;
  readonly pausedAt?: string;
  readonly resumesAt?: string;
  readonly timeZone?: string;
  readonly fantasyDay?: string;
  readonly fantasyDayVersion?: string;
};

export type TeamView = {
  readonly id: string;
  readonly connectionId: string;
  readonly provider: string;
  readonly providerTeamKey: string;
  readonly providerLeagueKey: string;
  readonly league: FantasyLeague;
  readonly sport: FantasySport;
  readonly season: number;
  readonly name: string;
  readonly leagueName?: string;
  readonly providerUrl?: string;
  readonly availability: TeamAvailability;
  readonly automation: TeamAutomationView;
  readonly ownerNote: string | null;
  readonly ownerNoteUpdatedAt: string | null;
  readonly ownerNoteLimit: number;
  readonly lastSeenAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};

export type LineupRunView = {
  readonly run: string;
  readonly request: string;
  readonly team: string;
  readonly target: LineupTargetPeriod;
  readonly trigger: LineupTrigger;
  readonly implementation: "provider_native" | "custom_policy";
  readonly implementationVersion: string;
  readonly status: LineupRunStatus;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly outcome?: {
    readonly kind:
      | "changed"
      | "no_op"
      | "blocked"
      | "skipped"
      | "failed"
      | "uncertain"
      | "superseded";
    readonly verified: boolean;
    readonly reconciled: boolean;
    readonly summary: string;
    readonly observedAt: string;
    readonly nextGameAt?: string;
    readonly nextTickAt?: string;
    readonly changes: ReadonlyArray<{
      readonly name: string;
      readonly from: string;
      readonly to: string;
    }>;
    readonly differences?: ReadonlyArray<{
      readonly name: string;
      readonly expected: string;
      readonly actual: string;
    }>;
    readonly leftInPlace?: ReadonlyArray<{
      readonly name: string;
      readonly slot: string;
      readonly reason: string;
    }>;
    readonly implementation?: "provider_native" | "custom_policy";
    readonly provenance?:
      | { readonly kind: "planned"; readonly label: string }
      | {
          readonly kind: "refused";
          readonly label: string;
          readonly detail: string;
        };
    readonly lockedPlayers: number;
    readonly editablePlayers: number;
  };
  readonly pending?: {
    readonly reason: string;
    readonly detail: string;
    readonly retryAt?: string;
  };
};

export type TeamSummaryView = {
  readonly team: TeamView;
  readonly connectionStatus: ConnectionStatus;
  readonly connectionCount: number;
  readonly lastRun?: LineupRunView;
  readonly recentRuns: ReadonlyArray<LineupRunView>;
};

export type TeamChangeView = {
  readonly changed: ReadonlyArray<TeamSummaryView>;
  readonly teams: ReadonlyArray<TeamSummaryView>;
};

export type TeamRefreshView = {
  readonly teams: ReadonlyArray<TeamSummaryView>;
};

export type TeamControlData = typeof TeamControlInput.Encoded;

export type TeamNoteData = {
  readonly team: string;
  readonly note: string;
};

export type TeamNoteSaveResult =
  | {
      readonly outcome: "saved";
      readonly note: string | null;
      readonly updatedAt: string | null;
    }
  | {
      readonly outcome: "rejected";
      readonly reason: "too_long";
      readonly message: string;
    };

export type TeamNoteError = {
  readonly type: "team.not_found" | "team.persistence_failed" | "team.input_invalid";
};
export type TeamNoteRequestResult<A> =
  | UseCaseResult<A, TeamNoteError["type"]>
  | { readonly type: "error"; readonly error: AuthenticationFailure };

export type TeamMutationError = {
  readonly type:
    | "team.not_found"
    | "team.control_rejected"
    | "team.persistence_failed"
    | "team.refresh_failed"
    | "team.input_invalid";
};
export type TeamRequestResult<A> =
  | UseCaseResult<A, TeamMutationError["type"]>
  | { readonly type: "error"; readonly error: AuthenticationFailure };

export type LineupRunData = {
  readonly run: LineupRunView;
};

export type LineupRunError = {
  readonly type:
    | "lineup.run_not_found"
    | "lineup.team_not_found"
    | "lineup.connection_not_ready"
    | "lineup.selection_invalid"
    | "lineup.request_conflict"
    | "lineup.persistence_failed"
    | "lineup.input_invalid";
};
export type LineupRunRequestResult<A> =
  | UseCaseResult<A, LineupRunError["type"]>
  | { readonly type: "error"; readonly error: AuthenticationFailure };
