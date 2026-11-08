export const lineupScopes = {
  write: {
    name: "lineups:write",
    description:
      "Ask Lineupgrade to set an owned team's lineup for a validated period. Lineupgrade plans the lineup from your league's final per-player scores, and a team whose league your league cannot value falls back to your league's own native lineup action. This never submits transactions, buys premium actions, or changes another person's team.",
  },
} as const;
