import { advertisedScopes } from "@lineupkeep/backend/runtime/ApplicationScopes";
import { expect, it } from "vitest";

import { AcceptanceReport, requestedScopeNames, tokenGrantedScopes } from "#e2e/mcpAccept.ts";

it("defaults the requested scope set to every advertised scope", () => {
  expect(requestedScopeNames(undefined)).toEqual(advertisedScopes.map((scope) => scope.name));
});

it("accepts a comma- or space-separated scope subset and rejects an unknown scope", () => {
  expect(requestedScopeNames("connections:read, feedback:manage")).toEqual([
    "connections:read",
    "feedback:manage",
  ]);
  expect(() => requestedScopeNames("connections:read unknown:read")).toThrow("Unknown scopes");
  expect(() => requestedScopeNames(" ")).toThrow("named no scopes");
});

it("reads granted scopes from a JWT scope claim", () => {
  const payload = Buffer.from(
    JSON.stringify({ scope: "connections:read feedback:manage" }),
  ).toString("base64url");

  expect(tokenGrantedScopes(`header.${payload}.signature`)).toEqual([
    "connections:read",
    "feedback:manage",
  ]);
  expect(() => tokenGrantedScopes("opaque")).toThrow("not a JWT");
});

it("accepts only the documented metadata difference", () => {
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
    authorizationScopes: advertisedScopes.map((scope) => scope.name),
    resourceScopes: ["connections:read", "fantasy:read", "feedback:manage"],
  });

  expect(inconsistent.findings.length).toBeGreaterThan(0);
});

it("accepts the minimal 401 baseline and the full registration ceiling", () => {
  const report = new AcceptanceReport({ mode: "local", origin: "http://127.0.0.1:3000" });
  report.baseline({
    status: 401,
    scope: "connections:read fantasy:read offline_access",
    expected: ["connections:read", "fantasy:read", "offline_access"],
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
    expected: ["connections:read", "fantasy:read", "offline_access"],
    matches: false,
    asksForFullSet: true,
  });
  wrong.register([{ grant: "requested", scope: "connections:read" }]);

  expect(wrong.findings.length).toBeGreaterThan(0);
});
