export const lineupScopes = {
  write: {
    name: "lineups:write",
    description:
      "Ask Lineupkeep to set an owned team's lineup for a validated period. Lineupkeep's own policy plans the lineup, and a team whose league the provider cannot value falls back to the provider's native start-active action. This never submits transactions, buys premium actions, or changes another person's team.",
  },
} as const;
