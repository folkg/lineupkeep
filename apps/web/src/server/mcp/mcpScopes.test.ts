import { advertisedScopes, resourceScopes } from "@lineupkeep/backend/runtime/ApplicationScopes";
import { Context } from "effect";
import { expect, it } from "vitest";

import { applicationTools } from "./mcpServer";
import { RequiredScope } from "./toolAuthorization";

it("covers every shipped tool's required scope in the advertised scope set", () => {
  const required = new Set(
    Object.values(applicationTools.tools).map(
      (tool) => Context.getUnsafe(tool.annotations, RequiredScope).name,
    ),
  );
  const advertised = advertisedScopes.map((scope) => scope.name);

  expect([...required].sort()).toEqual(resourceScopes.map((scope) => scope.name).sort());
  for (const scope of required) {
    expect(advertised).toContain(scope);
  }
});
