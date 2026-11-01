export const fantasyQueryScopes = {
  read: {
    name: "fantasy:read",
    description:
      "Read your own fantasy data: linked provider connections, teams, leagues, rosters, players, matchups, transaction history, and the status of your lineup runs, plus the feedback reports your account filed and a feedback report of your own. This cannot change a lineup or an automation setting, cannot propose or submit a transaction, and cannot read another person's data.",
  },
  reviewTransactions: {
    name: "transactions:review",
    description:
      "Propose player transactions for your own review, read your proposal sets back, and revalidate them against current provider state, and generate human-review links for add, drop, and trade intents. This stores proposals and reads provider state; it never submits a transaction, never executes a proposal, and never guarantees eligibility.",
  },
} as const;
