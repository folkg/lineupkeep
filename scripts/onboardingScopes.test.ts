import { readFileSync } from "node:fs";

import { advertisedScopes } from "@lineupkeep/backend/runtime/ApplicationScopes";
import { expect, it } from "vitest";

it("documents the advertised scope set a client must request first", () => {
  const documented = advertisedScopes.map((scope) => scope.name).join(" ");

  for (const path of [
    new URL("../README.md", import.meta.url),
    new URL("../docs/fantasy-manager/MCP.md", import.meta.url),
  ]) {
    expect(readFileSync(path, "utf8")).toContain(documented);
  }
});
