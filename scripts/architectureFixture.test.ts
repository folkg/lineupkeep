import { expect, it } from "vitest";

import { checkArchitecture, checkLint } from "./architectureFixture.ts";

it("isolates architecture fixtures with the same paths without changing the working directory", async () => {
  const cwd = process.cwd();
  const path = "apps/web/src/routes/mcp.ts";

  const [rejected, accepted] = await Promise.all([
    checkArchitecture({ [path]: 'import "effect";' }),
    checkArchitecture({ [path]: 'import "@tanstack/solid-router";' }),
  ]);
  const repeated = await checkArchitecture({ [path]: 'import "effect";' });

  expect(rejected.status).toBeGreaterThan(0);
  expect(rejected.output).toContain("mcp-route-delegates-to-adapter");
  expect(accepted.status, accepted.output).toBe(0);
  expect(repeated.status).toBeGreaterThan(0);
  expect(repeated.output).toContain("mcp-route-delegates-to-adapter");
  expect(process.cwd()).toBe(cwd);
});

it("checks fixture types as well as architecture rules", () => {
  const result = checkLint({
    "apps/web/src/routes/mcp.ts": 'import "effect"; export const count: number = "invalid";',
  });

  expect(result.status).toBeGreaterThan(0);
  expect(result.output).toContain("no-restricted-imports");
  expect(result.output).toContain("Type 'string' is not assignable to type 'number'");
});
