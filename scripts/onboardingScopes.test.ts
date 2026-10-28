import { readFileSync } from "node:fs";

import { advertisedScopes, onboardingScopes } from "@lineupkeep/backend/runtime/ApplicationScopes";
import { expect, it } from "vitest";

const read = (name: string): string => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

it("documents the minimal scope set a client requests on its first authorization", () => {
  const documented = onboardingScopes.map((scope) => scope.name).join(" ");

  for (const name of ["README.md", "docs/fantasy-manager/MCP.md"]) {
    expect(read(name), name).toContain(documented);
  }
});

it("documents the full authorization-server scope set in the MCP contract", () => {
  const documented = advertisedScopes.map((scope) => scope.name).join(" ");

  expect(read("docs/fantasy-manager/MCP.md")).toContain(documented);
});
