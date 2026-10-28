export const lineupScopes = {
  write: {
    name: "lineups:write",
    description:
      "Ask Lineupkeep to set an owned team's lineup for a validated period. Lineupkeep plans the lineup from the provider's final per-player scores, and a team whose league the provider cannot value falls back to the provider's own native lineup action. This never submits transactions, buys premium actions, or changes another person's team.",
  },
} as const;
