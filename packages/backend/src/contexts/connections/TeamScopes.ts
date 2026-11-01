export const teamScopes = {
  manage: {
    name: "teams:manage",
    description:
      "Change what Lineupkeep records about your own teams: enable, disable, pause for the rest of the provider fantasy day, or resume scheduled lineup automation, and the note you keep on a team. This changes only Lineupkeep's stored team state; it does not set a lineup, contact the provider, or manage another person's team.",
  },
} as const;
