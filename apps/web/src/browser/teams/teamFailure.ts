import { AuthenticationRequestFailure } from "#browser/session/AuthenticationRequestFailure.ts";
import type {
  LineupRunError,
  LineupRunRequestResult,
  TeamMutationError,
  TeamRequestResult,
} from "#contracts/connections/teamContract.ts";

export function requireTeamSuccess<TData>(result: TeamRequestResult<TData>): TData {
  switch (result.type) {
    case "success":
      return result.data;
    case "error":
      if (result.error.type === "auth.required") {
        throw new AuthenticationRequestFailure(result.error);
      }
      throw new TeamWriteFailure(result.error);
  }
}

export function requireRunSuccess<TData>(result: LineupRunRequestResult<TData>): TData {
  switch (result.type) {
    case "success":
      return result.data;
    case "error":
      if (result.error.type === "auth.required") {
        throw new AuthenticationRequestFailure(result.error);
      }
      throw new RunReadFailure(result.error);
  }
}

class TeamWriteFailure extends Error {
  constructor(readonly reason: TeamMutationError) {
    super(reason.type);
  }
}

class RunReadFailure extends Error {
  constructor(readonly reason: LineupRunError) {
    super(reason.type);
  }
}

export function describeTeamFailure(error: unknown): TeamFailure {
  if (error instanceof AuthenticationRequestFailure) {
    return {
      kind: "authentication",
      message: "Your session has ended. Sign in again to continue.",
    };
  }
  if (error instanceof TeamWriteFailure) {
    switch (error.reason.type) {
      case "team.not_found":
      case "team.input_invalid":
        return {
          kind: "rejected",
          message: "This team is no longer available. Refresh the latest list before retrying.",
        };
      case "team.control_rejected":
        return {
          kind: "rejected",
          message: "This team changed. Refresh the latest status before retrying.",
        };
      case "team.persistence_failed":
        break;
      case "team.refresh_failed":
        return {
          kind: "unconfirmed",
          message: "We could not refresh teams from Yahoo. Try again.",
        };
    }
  }
  return {
    kind: "unconfirmed",
    message: "We could not confirm the change. Check the latest list before retrying.",
  };
}

export function describeRunFailure(error: unknown): string {
  if (error instanceof AuthenticationRequestFailure) {
    return "Your session has ended. Sign in again to continue.";
  }
  if (error instanceof RunReadFailure) {
    switch (error.reason.type) {
      case "lineup.run_not_found":
      case "lineup.team_not_found":
      case "lineup.input_invalid":
        return "This run is no longer available to this account.";
      case "lineup.connection_not_ready":
      case "lineup.selection_invalid":
      case "lineup.request_conflict":
        return "This run cannot be read from the current account state.";
      case "lineup.persistence_failed":
        break;
    }
  }
  return "We could not load this run. Try again.";
}

export type TeamFailure = {
  readonly kind: "authentication" | "rejected" | "unconfirmed";
  readonly message: string;
};
