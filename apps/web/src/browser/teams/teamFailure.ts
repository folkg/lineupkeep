import { AuthenticationRequestFailure } from "#browser/session/AuthenticationRequestFailure.ts";
import { defaultProviderName } from "#contracts/connections/providerLabels.ts";
import type {
  LineupRunError,
  LineupRunRequestResult,
  TeamMutationError,
  TeamNoteError,
  TeamNoteRequestResult,
  TeamRequestResult,
  TeamRosterError,
  TeamRosterRequestResult,
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

export function requireNoteSuccess<TData>(result: TeamNoteRequestResult<TData>): TData {
  switch (result.type) {
    case "success":
      return result.data;
    case "error":
      if (result.error.type === "auth.required") {
        throw new AuthenticationRequestFailure(result.error);
      }
      throw new TeamNoteFailure(result.error);
  }
}

export function requireRosterSuccess<TData>(result: TeamRosterRequestResult<TData>): TData {
  switch (result.type) {
    case "success":
      return result.data;
    case "error":
      if (result.error.type === "auth.required") {
        throw new AuthenticationRequestFailure(result.error);
      }
      throw new TeamRosterFailure(result.error);
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

class TeamNoteFailure extends Error {
  constructor(readonly reason: TeamNoteError) {
    super(reason.type);
  }
}

class TeamRosterFailure extends Error {
  constructor(readonly reason: TeamRosterError) {
    super(reason.type);
  }
}

class RunReadFailure extends Error {
  constructor(readonly reason: LineupRunError) {
    super(reason.type);
  }
}

export function describeTeamFailure(error: unknown): TeamFailure {
  return classifyTeamFailure(error, "refresh");
}

export function describeControlFailure(error: unknown): TeamFailure {
  return classifyTeamFailure(error, "control");
}

export function describeCheckFailure(error: unknown): TeamFailure {
  return classifyTeamFailure(error, "check");
}

export function describeNoteFailure(error: unknown): TeamFailure {
  if (error instanceof AuthenticationRequestFailure) {
    return {
      kind: "authentication",
      message: "Your session has ended. Sign in again to continue.",
    };
  }
  if (error instanceof TeamNoteFailure) {
    switch (error.reason.type) {
      case "team.not_found":
        return {
          kind: "rejected",
          message: "This team is no longer available. Refresh the latest list before trying again.",
        };
      case "team.input_invalid":
        return {
          kind: "rejected",
          message:
            "The note was not saved. Check its length and remove anything that looks like a password or token.",
        };
      case "team.persistence_failed":
        break;
    }
  }
  return {
    kind: "unconfirmed",
    message:
      "We could not confirm the save. Refresh this page and check the note before trying again.",
  };
}

function classifyTeamFailure(
  error: unknown,
  surface: "control" | "refresh" | "check",
): TeamFailure {
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
          message:
            surface === "control"
              ? "This team is no longer available, so the control returned to the last known state. Refresh the latest list before trying again."
              : "This team is no longer available. Refresh the latest list before retrying.",
        };
      case "team.control_rejected":
        return {
          kind: "rejected",
          message:
            surface === "control"
              ? "This team changed while the request was in flight, so the control returned to the last known state. Refresh the latest status before trying again."
              : "This team changed. Refresh the latest status before retrying.",
        };
      case "team.persistence_failed":
        break;
      case "team.refresh_failed":
        return {
          kind: "unconfirmed",
          message:
            surface === "check"
              ? `We could not check this team with ${defaultProviderName()}. Try again.`
              : `We could not refresh teams from ${defaultProviderName()}. Try again.`,
        };
    }
  }
  switch (surface) {
    case "control":
      return {
        kind: "unconfirmed",
        message:
          "We could not confirm the change, so the control returned to the last known state. Check the latest list before trying again.",
      };
    case "refresh":
      return {
        kind: "unconfirmed",
        message: "We could not confirm the change. Check the latest list before retrying.",
      };
    case "check":
      return {
        kind: "unconfirmed",
        message: "We could not confirm the check. Check the latest list before trying again.",
      };
  }
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
