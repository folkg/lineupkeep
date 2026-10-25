export const noteScopes = {
  read: {
    name: "notes:read",
    description:
      "Read and search your active and trashed Notes. This cannot change or permanently delete Notes, or include Notes owned by other people.",
  },
  write: {
    name: "notes:write",
    description:
      "Create and edit Notes, move them to Trash, and restore them. This cannot permanently delete Notes or change Notes owned by other people.",
  },
} as const;
