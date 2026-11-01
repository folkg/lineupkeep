import { retiredScopeNames } from "@lineupkeep/backend/auth/AuthorizationScopes";
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

it("declares exactly the advertised resource scopes on the shipped tools", () => {
  expect([...new Set(toolScopes.map(({ scope }) => scope))].sort()).toEqual(
    resourceScopes.map(({ name }) => name).sort(),
  );
});

it("requires no retired scope name and advertises none", () => {
  const advertised = advertisedScopes.map(({ name }) => name);

  for (const { name, scope } of toolScopes) {
    expect(advertised, name).toContain(scope);
    expect(retiredScopeNames, name).not.toContain(scope);
  }
  for (const retired of retiredScopeNames) {
    expect(advertised).not.toContain(retired);
    expect(resourceScopes.map(({ name }) => name)).not.toContain(retired);
  }
  expect(advertised).toContain("offline_access");
});

it("reaches only read tools and feedback submission and read-back with the onboarding grant", () => {
  const onboarding = new Set(onboardingScopes.map(({ name }) => name));
  const reachable = toolScopes.filter(({ scope }) => onboarding.has(scope));

  for (const { name, readOnly } of reachable) {
    if (name === "submit_feedback") {
      continue;
    }
    expect(readOnly, name).toBe(true);
  }
  expect(reachable.map(({ name }) => name)).toContain("submit_feedback");
  expect(reachable.map(({ name }) => name)).toContain("list_feedback");
  expect(reachable.map(({ name }) => name)).toContain("list_connections");
  expect(onboarding.has("lineups:write")).toBe(false);
  expect(onboarding.has("transactions:review")).toBe(false);
  expect(onboarding.has("teams:manage")).toBe(false);
});

it("reads a connection, a team, and a lineup run under the same read scope", () => {
  const scopeOf = new Map(toolScopes.map(({ name, scope }) => [name, scope]));

  expect(scopeOf.get("list_connections")).toBe("fantasy:read");
  expect(scopeOf.get("list_teams")).toBe("fantasy:read");
  expect(scopeOf.get("get_lineup_runs")).toBe("fantasy:read");
  expect(scopeOf.get("set_lineup")).toBe("lineups:write");
  expect(scopeOf.get("submit_feedback")).toBe("fantasy:read");
  expect(toolScopes.map(({ name }) => name)).not.toContain("triage_feedback");
});
