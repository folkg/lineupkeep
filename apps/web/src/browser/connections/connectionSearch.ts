export function parseConnectionSearch(input: Record<string, unknown>): ConnectionSearch {
  return {
    ...(typeof input["connect"] === "string" ? { connect: input["connect"] } : {}),
    ...(typeof input["connection"] === "string" ? { connection: input["connection"] } : {}),
  };
}

export type ConnectionSearch = {
  readonly connect?: string;
  readonly connection?: string;
};
