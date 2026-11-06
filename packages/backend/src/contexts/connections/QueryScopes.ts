export const fantasyQueryScopes = {
  read: {
    name: "fantasy:read",
    description:
      "Read your own fantasy data: linked provider connections, teams, leagues, rosters, players, matchups, transaction history, and the status of your lineup runs. The same grant lets the client file a feedback report for your account and read back the reports your account filed, because reporting a problem should not need a write scope. It cannot change a lineup, an automation setting, or a transaction, cannot propose or submit a transaction, and cannot read another person's data.",
  },
  reviewTransactions: {
    name: "transactions:review",
    description:
      "Propose player transactions for your own review, read your proposal sets back, and revalidate them against current provider state. This stores proposals and reads provider state; it never submits a transaction, never executes a proposal, and never guarantees eligibility.",
  },
} as const;
