import {
  advertisedScopes,
  onboardingScopes,
  resourceScopes,
} from "@lineupkeep/backend/runtime/ApplicationScopes";
import { Context } from "effect";
import { Tool } from "effect/ai";
import { expect, it } from "vitest";

import { applicationTools } from "./mcpServer";
import { RequiredScope } from "./toolAuthorization";

const toolScopes = Object.values(applicationTools.tools).map((tool) => ({
  name: tool.name,
  scope: Context.getUnsafe(tool.annotations, RequiredScope).name,
  readOnly: Context.getUnsafe(tool.annotations, Tool.Readonly),
}));

it("derives the published resource scopes from the scope every shipped tool declares", () => {
  expect([...new Set(toolScopes.map(({ scope }) => scope))].sort()).toEqual(
    resourceScopes.map(({ name }) => name).sort(),
  );
});

it("advertises every tool scope and the refresh scope in the authorization-server set", () => {
  const advertised = advertisedScopes.map(({ name }) => name);

  for (const { name, scope } of toolScopes) {
    expect(advertised, name).toContain(scope);
  }
  expect(advertised).toContain("offline_access");
});

it("reaches only read tools and feedback submission with the onboarding grant", () => {
  const onboarding = new Set(onboardingScopes.map(({ name }) => name));
  const reachable = toolScopes.filter(({ scope }) => onboarding.has(scope));

  for (const { name, readOnly } of reachable) {
    if (name === "submit_feedback") {
      continue;
    }
    expect(readOnly, name).toBe(true);
  }
  expect(reachable.map(({ name }) => name)).toContain("submit_feedback");
  expect(onboarding.has("lineups:write")).toBe(false);
  expect(onboarding.has("teams:manage")).toBe(false);
  expect(onboarding.has("feedback:manage")).toBe(false);
});
