export const feedbackScopes = {
  manage: {
    name: "feedback:manage",
    description:
      "Read, acknowledge, resolve, or close the feedback reports your account owns. Submission needs only connections:read. This never exposes another person's reports.",
  },
} as const;
