export const fantasyQueryScopes = {
  read: {
    name: "fantasy:read",
    description:
      "Read your linked fantasy leagues, rosters, players, matchups, and transaction history. This cannot change lineups, submit transactions, or access another person's teams.",
  },
  reviewTransactions: {
    name: "transactions:review",
    description:
      "Propose player transactions for your own review, read your proposal sets back, and revalidate them against current provider state, and generate human-review links for add, drop, and trade intents. This stores proposals and reads provider state; it never submits a transaction, never executes a proposal, and never guarantees eligibility.",
  },
} as const;
