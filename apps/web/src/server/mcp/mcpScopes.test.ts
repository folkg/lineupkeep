import { retiredScopeNames } from "@lineupkeep/backend/auth/AuthorizationScopes";
import { fantasyQueryScopes } from "@lineupkeep/backend/connections/QueryScopes";
import {
  advertisedScopes,
  onboardingScopes,
  resourceScopes,
} from "@lineupkeep/backend/runtime/ApplicationScopes";
import { toolCallLimits } from "@lineupkeep/backend/toolCalls/ToolCallQuota";
import { Context, Schema } from "effect";
import { Array as EffectArray } from "effect";
import { Record as EffectRecord } from "effect";
import { Tool } from "effect/ai";
import { expect, it } from "vitest";

import { applicationTools } from "./mcpServer";
import { RequiredScope, toolCallClass } from "./toolAuthorization";

const toolScopes = EffectArray.map(EffectRecord.values(applicationTools.tools), (tool) => ({
  name: tool.name,
  scope: Context.getUnsafe(tool.annotations, RequiredScope).name,
  readOnly: Context.getUnsafe(tool.annotations, Tool.Readonly),
}));

it("declares exactly the advertised resource scopes on the shipped tools", () => {
  expect([...new Set(EffectArray.map(toolScopes, ({ scope }) => scope))].sort()).toEqual(
    EffectArray.map(resourceScopes, ({ name }) => name).sort(),
  );
});

const toolClasses = EffectArray.map(EffectRecord.values(applicationTools.tools), (tool) => ({
  name: tool.name,
  callClass: toolCallClass(tool),
}));

it("spends a declared allowance on every shipped tool, smallest for the destructive one", () => {
  expect(
    EffectArray.map(
      EffectArray.filter(toolClasses, ({ callClass }) => callClass === "destructive"),
      ({ name }) => name,
    ),
  ).toEqual(["set_lineup"]);
  expect(
    EffectArray.map(
      EffectArray.filter(toolClasses, ({ callClass }) => callClass === "write"),
      ({ name }) => name,
    ).sort(),
  ).toEqual([
    "add_team_agent_note",
    "discard_transaction_move",
    "propose_transactions",
    "set_team_automation",
    "submit_feedback",
  ]);
  expect(
    EffectArray.map(
      EffectArray.filter(toolClasses, ({ callClass }) => callClass === "read"),
      ({ name }) => name,
    ).sort(),
  ).toEqual([
    "get_calendar",
    "get_league",
    "get_lineup_runs",
    "get_matchups",
    "get_pending_trade_offers",
    "get_players",
    "get_rosters",
    "get_team_snapshot",
    "get_team_summary",
    "get_transaction_plan",
    "get_transactions",
    "list_connections",
    "list_feedback",
    "list_teams",
    "list_transaction_proposals",
    "search_players",
  ]);
  expect(toolCallLimits.destructive.clientMax).toBeLessThan(toolCallLimits.write.clientMax);
  expect(toolCallLimits.write.clientMax).toBeLessThan(toolCallLimits.read.clientMax);
});

it("bounds a tool that declares no annotations with the smallest allowance", () => {
  expect(toolCallClass(Tool.make("unannotated", { success: Schema.String }))).toBe("destructive");
});

it("requires no retired scope name and advertises none", () => {
  const advertised = EffectArray.map(advertisedScopes, ({ name }) => name);

  for (const { name, scope } of toolScopes) {
    expect(advertised, name).toContain(scope);
    expect(retiredScopeNames, name).not.toContain(scope);
  }
  for (const retired of retiredScopeNames) {
    expect(advertised).not.toContain(retired);
    expect(EffectArray.map(resourceScopes, ({ name }) => name)).not.toContain(retired);
  }
  expect(advertised).toContain("offline_access");
});

it("says in the read scope description that the grant can file a feedback report", () => {
  expect(fantasyQueryScopes.read.description).toMatch(/file a feedback report/u);
});

it("reaches only read tools and feedback submission and read-back with the onboarding grant", () => {
  const onboarding = new Set(EffectArray.map(onboardingScopes, ({ name }) => name));
  const reachable = EffectArray.filter(toolScopes, ({ scope }) => onboarding.has(scope));

  for (const { name, readOnly } of reachable) {
    if (name === "submit_feedback") {
      continue;
    }
    expect(readOnly, name).toBe(true);
  }
  expect(EffectArray.map(reachable, ({ name }) => name)).toContain("submit_feedback");
  expect(EffectArray.map(reachable, ({ name }) => name)).toContain("list_feedback");
  expect(EffectArray.map(reachable, ({ name }) => name)).toContain("list_connections");
  expect(onboarding.has("lineups:write")).toBe(false);
  expect(onboarding.has("transactions:review")).toBe(false);
  expect(onboarding.has("teams:manage")).toBe(false);
  expect(onboarding.has("notes:write")).toBe(false);
});

it("reads a connection, a team, and a lineup run under the same read scope", () => {
  const scopeOf = new Map(EffectArray.map(toolScopes, ({ name, scope }) => [name, scope]));

  expect(scopeOf.get("list_connections")).toBe("fantasy:read");
  expect(scopeOf.get("list_teams")).toBe("fantasy:read");
  expect(scopeOf.get("list_transaction_proposals")).toBe("fantasy:read");
  expect(scopeOf.get("discard_transaction_move")).toBe("transactions:review");
  expect(scopeOf.get("get_lineup_runs")).toBe("fantasy:read");
  expect(scopeOf.get("set_lineup")).toBe("lineups:write");
  expect(scopeOf.get("set_team_automation")).toBe("teams:manage");
  expect(scopeOf.get("add_team_agent_note")).toBe("notes:write");
  expect(scopeOf.get("submit_feedback")).toBe("fantasy:read");
});
