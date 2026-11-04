import type { FeedbackKind, FeedbackStatus } from "@lineupkeep/backend/feedback/Feedback";

import type {
  FeedbackContextView,
  FeedbackReportView,
} from "#contracts/feedback/feedbackContract.ts";

export function feedbackKindLabel(kind: FeedbackKind): string {
  switch (kind) {
    case "bug":
      return "Bug";
    case "data-issue":
      return "Wrong data";
    case "friction":
      return "Difficult to use";
    case "wishlist":
      return "Idea";
    case "other":
      return "Other";
  }
}

export function feedbackStatusLabel(status: FeedbackStatus): string {
  switch (status) {
    case "open":
      return "Open";
    case "acknowledged":
      return "Acknowledged";
    case "resolved":
      return "Resolved";
    case "wontfix":
      return "Not planned";
  }
}

export function feedbackStatusDetail(report: FeedbackReportView): string {
  switch (report.status) {
    case "open":
      return "Received. Nobody has reviewed it yet.";
    case "acknowledged":
      return "Reviewed and being worked on.";
    case "resolved":
      return report.resolutionNote === undefined
        ? "Closed as resolved."
        : `Resolved: ${report.resolutionNote}`;
    case "wontfix":
      return report.resolutionNote === undefined
        ? "Closed as not planned."
        : `Not planned: ${report.resolutionNote}`;
  }
}

export function feedbackContextSummary(
  context: FeedbackContextView,
  teamName?: string,
): string | undefined {
  if (context.surface === "team" || (context.surface === undefined && context.team !== undefined)) {
    return teamName === undefined ? "Report about this team." : `Report about ${teamName}.`;
  }
  switch (context.surface) {
    case "run":
      return "About this lineup run";
    case "teams":
      return "About the teams list";
    case "connections":
      return "About connections";
    case "mcp":
      return "About an MCP client";
    case "app":
      return "About the app";
    case undefined:
      return undefined;
  }
}

export function formatFeedbackDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
