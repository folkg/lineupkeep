export const fantasyQueryScopes = {
  read: {
    name: "fantasy:read",
    description:
      "Read your linked fantasy leagues, rosters, players, matchups, and transaction history. This cannot change lineups, submit transactions, or access another person's teams.",
  },
  reviewTransactions: {
    name: "transactions:review",
    description:
      "Generate human-review links for proposed add, drop, and trade transactions. This does not submit transactions or guarantee eligibility.",
  },
} as const;
