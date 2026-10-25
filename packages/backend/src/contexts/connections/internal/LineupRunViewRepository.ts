import type { LineupRun } from "#contexts/connections/LineupRun.ts";

import type { LineupRunRecord } from "./LineupRunTables.ts";
import type { LineupRunState } from "./LineupRunWorkflow.ts";

export function toLineupRun(record: LineupRunRecord): LineupRun {
  const state = record.state;
  return {
    run: record.id,
    request: record.requestId,
    team: record.teamId,
    target: record.target,
    trigger: record.trigger,
    implementation: record.implementation,
    implementationVersion: record.implementationVersion,
    status: record.status,
    attempts: record.attempts,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(terminalOutcome(state) === undefined ? {} : { outcome: terminalOutcome(state) }),
    ...(pendingInfo(state) === undefined ? {} : { pending: pendingInfo(state) }),
  };
}

export function isSettled(status: LineupRun["status"]): boolean {
  switch (status) {
    case "completed":
    case "skipped":
    case "blocked":
    case "failed":
    case "uncertain":
    case "superseded":
      return true;
    case "queued":
    case "reading":
    case "planning":
    case "validating":
    case "applying":
    case "verifying":
    case "retry-wait":
      return false;
  }
}

function terminalOutcome(state: LineupRunState): LineupRun["outcome"] {
  switch (state._tag) {
    case "Completed":
    case "Skipped":
    case "Blocked":
    case "Failed":
    case "Uncertain":
    case "Superseded":
      return state.outcome;
    case "Queued":
    case "Reading":
    case "Planning":
    case "Validating":
    case "Applying":
    case "Verifying":
    case "RetryWait":
      return undefined;
  }
}

function pendingInfo(state: LineupRunState): LineupRun["pending"] {
  switch (state._tag) {
    case "RetryWait":
      return {
        reason: state.reason,
        detail: state.detail,
        retryAt: state.retryAt,
      };
    case "Queued":
    case "Reading":
    case "Planning":
    case "Validating":
    case "Applying":
    case "Verifying":
      return { reason: state._tag.toLocaleLowerCase(), detail: "The durable run is in progress." };
    case "Completed":
    case "Skipped":
    case "Blocked":
    case "Failed":
    case "Uncertain":
    case "Superseded":
      return undefined;
  }
}
