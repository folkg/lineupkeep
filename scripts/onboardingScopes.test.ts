import { readFileSync } from "node:fs";

import { retiredScopeNames } from "@lineupkeep/backend/auth/AuthorizationScopes";
import { advertisedScopes, onboardingScopes } from "@lineupkeep/backend/runtime/ApplicationScopes";
import { EffectString } from "@lineupkeep/collections";
import { Array as EffectArray } from "effect";
import { expect, it } from "vitest";

const read = (name: string): string => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");

it("documents the minimal scope set a client requests on its first authorization", () => {
  const documented = EffectArray.join(
    EffectArray.map(onboardingScopes, (scope) => scope.name),
    " ",
  );

  for (const name of ["README.md", "docs/fantasy-manager/MCP.md"]) {
    expect(read(name), name).toContain(documented);
  }
});

it("documents the full authorization-server scope set in the MCP contract", () => {
  const documented = EffectArray.join(
    EffectArray.map(advertisedScopes, (scope) => scope.name),
    " ",
  );

  expect(read("docs/fantasy-manager/MCP.md")).toContain(documented);
});

it("says in the MCP contract that retired names are accepted but never advertised", () => {
  const contract = EffectString.replaceAll(read("docs/fantasy-manager/MCP.md"), /\s+/gu, " ");

  expect(contract).toContain("accepted but never advertised");
  for (const retired of retiredScopeNames) {
    expect(contract, retired).toContain(`\`${retired}\``);
  }
});
