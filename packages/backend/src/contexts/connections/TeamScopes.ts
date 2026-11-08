export const teamScopes = {
  manage: {
    name: "teams:manage",
    description:
      "Change what Lineupgrade records about your own teams: enable, disable, pause for the rest of the fantasy day at your league, or resume scheduled lineup automation, and the note you keep on a team. This changes only Lineupgrade's stored team state; it does not set a lineup, contact your league's site, or manage another person's team.",
  },
  agentNotes: {
    name: "notes:write",
    description:
      "Append notes to your own teams: durable memory a client records about a team, such as a keeper choice, a manager's tendency, or a league quirk. Each note records the client that wrote it and when it was written. Notes are append-only, never edited or deleted by a client, and never change the note you keep on a team. This does not set a lineup, contact your league's site, change an automation setting or a transaction, or write to another person's team.",
  },
} as const;
