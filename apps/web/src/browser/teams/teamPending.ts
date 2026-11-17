import type {
  LineupRunView,
  TeamAutomationView,
  TeamControlData,
  TeamPendingAction,
  TeamPendingView,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";

export function teamAutomation(team: TeamSummaryView): TeamAutomationView {
  return team.pending?.automation ?? team.team.automation;
}

export function teamLastRun(team: TeamSummaryView): LineupRunView | undefined {
  return team.pending === undefined ? team.lastRun : team.pending.lastRun;
}

export function pendingControlAction(action: TeamControlData["action"]): TeamPendingAction {
  return action === "pause-today" ? "pause" : action;
}

export function pendingValues(team: TeamSummaryView, action: TeamPendingAction): TeamPendingView {
  return {
    action,
    automation: optimisticAutomation(team.team.automation, action),
    ...(team.lastRun === undefined ? {} : { lastRun: team.lastRun }),
  };
}

function optimisticAutomation(
  automation: TeamAutomationView,
  action: TeamPendingAction,
): TeamAutomationView {
  switch (action) {
    case "enable":
    case "resume":
      return { status: "enabled", changedAt: automation.changedAt };
    case "disable":
      return { status: "disabled", changedAt: automation.changedAt };
    case "pause":
      return { status: "paused-until-fantasy-day-end", changedAt: automation.changedAt };
    case "refresh":
      return automation;
  }
}
