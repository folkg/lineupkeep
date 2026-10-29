export const feedbackScopes = {
  manage: {
    name: "feedback:manage",
    description:
      "Acknowledge, resolve, or close the feedback reports your account owns. Reading your own reports and submitting one need only connections:read. This never exposes another person's reports.",
  },
} as const;
