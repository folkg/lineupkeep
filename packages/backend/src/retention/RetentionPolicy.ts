const millisecondsPerDay = 24 * 60 * 60 * 1000;

export const retentionPolicy = {
  lineupDiagnostic: {
    appliesTo: "lineup run diagnostics",
    countedFrom: "the attempt that recorded them",
    millis: 7 * millisecondsPerDay,
  },
  lineupRun: {
    appliesTo: "lineup runs, their attempts, and their write intents",
    countedFrom: "the run's end state",
    millis: 90 * millisecondsPerDay,
  },
  closedPlan: {
    appliesTo:
      "transaction plans whose moves have all ended, and their moves, submissions and steps",
    countedFrom: "the plan's last change",
    millis: 90 * millisecondsPerDay,
  },
  scheduleObservation: {
    appliesTo: "stored schedule observations",
    countedFrom: "the end of the covered window",
    millis: 14 * millisecondsPerDay,
  },
  unapprovedRegistration: {
    appliesTo: "dynamic client registrations that never completed an authorization",
    countedFrom: "registration",
    millis: 7 * millisecondsPerDay,
  },
  oauthConsent: {
    appliesTo: "OAuth consents",
    countedFrom: "the last consent interaction",
    millis: 180 * millisecondsPerDay,
  },
  hostedLinkingSession: {
    appliesTo: "hosted linking sessions",
    countedFrom: "the session's end state",
    millis: 1 * millisecondsPerDay,
  },
  closedFeedbackReport: {
    appliesTo: "resolved and not-planned feedback reports",
    countedFrom: "closure",
    millis: 365 * millisecondsPerDay,
  },
  feedbackQuota: {
    appliesTo: "feedback submission quota rows",
    countedFrom: "the start of the hour",
    millis: millisecondsPerDay,
  },
} as const satisfies Record<string, RetentionRule>;

export const unapprovedRegistrationLimit = 100;

type RetentionRule = {
  readonly appliesTo: string;
  readonly countedFrom: string;
  readonly millis: number;
};
