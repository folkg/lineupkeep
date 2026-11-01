import {
  currentScopeName,
  retiredScopeAliases,
} from "@lineupkeep/backend/auth/AuthorizationScopes";
import { advertisedScopes, onboardingScopes } from "@lineupkeep/backend/runtime/ApplicationScopes";
import { expect, it } from "vitest";

import { AcceptanceReport, requestedScopeNames, tokenGrantedScopes } from "#e2e/mcpAccept.ts";

const onboarding = onboardingScopes.map((scope) => scope.name);

it("defaults the requested scope set to every advertised scope", () => {
  expect(requestedScopeNames(undefined)).toEqual(advertisedScopes.map((scope) => scope.name));
});

it("accepts a comma- or space-separated scope subset, including a retired name", () => {
  expect(requestedScopeNames("fantasy:read, teams:manage")).toEqual([
    "fantasy:read",
    "teams:manage",
  ]);
  expect(requestedScopeNames("connections:read")).toEqual(["connections:read"]);
  expect(() => requestedScopeNames("fantasy:read unknown:read")).toThrow("Unknown scopes");
  expect(() => requestedScopeNames(" ")).toThrow("named no scopes");
});

it("reads granted scopes from a JWT scope claim", () => {
  const payload = Buffer.from(JSON.stringify({ scope: "connections:read teams:manage" })).toString(
    "base64url",
  );

  expect(tokenGrantedScopes(`header.${payload}.signature`)).toEqual([
    "connections:read",
    "teams:manage",
  ]);
  expect(() => tokenGrantedScopes("opaque")).toThrow("not a JWT");
});

it("accepts only the documented metadata difference and no retired name", () => {
  const report = new AcceptanceReport({ mode: "local", origin: "http://127.0.0.1:3000" });
  report.metadata({
    metadataUrl: "http://127.0.0.1:3000/.well-known/oauth-protected-resource/mcp",
    authorizationUrl: "http://127.0.0.1:3000/.well-known/oauth-authorization-server/api/auth",
    authorizationScopes: advertisedScopes.map((scope) => scope.name),
    resourceScopes: advertisedScopes
      .filter((scope) => scope.name !== "offline_access")
      .map((scope) => scope.name),
  });

  expect(report.findings).toEqual([]);

  const inconsistent = new AcceptanceReport({ mode: "local", origin: "http://127.0.0.1:3000" });
  inconsistent.metadata({
    metadataUrl: "http://127.0.0.1:3000/.well-known/oauth-protected-resource/mcp",
    authorizationUrl: "http://127.0.0.1:3000/.well-known/oauth-authorization-server/api/auth",
    authorizationScopes: [...advertisedScopes.map((scope) => scope.name), "connections:read"],
    resourceScopes: ["fantasy:read", "transactions:review"],
  });

  expect(inconsistent.findings.length).toBeGreaterThan(0);
});

it("reports a retired name in either metadata document as a finding", () => {
  for (const retired of Object.keys(retiredScopeAliases)) {
    const authorization = new AcceptanceReport({
      mode: "local",
      origin: "http://127.0.0.1:3000",
    });
    authorization.metadata({
      metadataUrl: "http://127.0.0.1:3000/.well-known/oauth-protected-resource/mcp",
      authorizationUrl: "http://127.0.0.1:3000/.well-known/oauth-authorization-server/api/auth",
      authorizationScopes: [...advertisedScopes.map((scope) => scope.name), retired],
      resourceScopes: advertisedScopes
        .filter((scope) => scope.name !== "offline_access")
        .map((scope) => scope.name),
    });
    expect(authorization.failureMessage()).toContain(retired);

    const resource = new AcceptanceReport({ mode: "local", origin: "http://127.0.0.1:3000" });
    resource.metadata({
      metadataUrl: "http://127.0.0.1:3000/.well-known/oauth-protected-resource/mcp",
      authorizationUrl: "http://127.0.0.1:3000/.well-known/oauth-authorization-server/api/auth",
      authorizationScopes: advertisedScopes.map((scope) => scope.name),
      resourceScopes: [
        ...advertisedScopes
          .filter((scope) => scope.name !== "offline_access")
          .map((scope) => scope.name),
        retired,
      ],
    });
    expect(resource.failureMessage()).toContain(retired);
  }
});

it("accepts the minimal 401 baseline and the full registration ceiling", () => {
  const report = new AcceptanceReport({ mode: "local", origin: "http://127.0.0.1:3000" });
  report.baseline({
    status: 401,
    scope: onboarding.join(" "),
    expected: onboarding,
    matches: true,
    asksForFullSet: false,
  });
  report.register([
    {
      grant: "requested",
      scope: advertisedScopes.map((scope) => scope.name).join(" "),
    },
  ]);

  expect(report.findings).toEqual([]);

  const wrong = new AcceptanceReport({ mode: "local", origin: "http://127.0.0.1:3000" });
  wrong.baseline({
    status: 401,
    scope: advertisedScopes.map((scope) => scope.name).join(" "),
    expected: onboarding,
    matches: false,
    asksForFullSet: true,
  });
  wrong.register([{ grant: "requested", scope: "fantasy:read" }]);

  expect(wrong.findings.length).toBeGreaterThan(0);
});

it("notes a provided token minted with a retired name as accepted", () => {
  const report = new AcceptanceReport({ mode: "token", origin: "https://lineupkeep.example" });
  report.providedToken("MCP_TOKEN", ["connections:read", "offline_access"]);

  expect(report.findings).toEqual([]);
  expect(report.markdown()).toContain(
    `retired connections:read; each is accepted as ${currentScopeName("connections:read")}`,
  );
});
