export const connectionScopes = {
  read: {
    name: "connections:read",
    description:
      "Read your provider connection status and safe metadata. This cannot read provider credentials or connections owned by other people.",
  },
} as const;
