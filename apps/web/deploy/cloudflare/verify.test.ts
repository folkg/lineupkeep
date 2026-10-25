import { expect, it } from "vitest";

import { assertPublicRouting } from "./settings";

it("rejects a Worker without public-only global fetch routing", () => {
  expect(() => assertPublicRouting({ compatibility: { flags: [] } })).toThrow(
    "generate Worker compatibility settings with workerConfiguration",
  );
  expect(() => assertPublicRouting({})).toThrow();
});

it("accepts a Worker with public-only global fetch routing", () => {
  expect(() =>
    assertPublicRouting({
      compatibility: { flags: ["nodejs_compat", "global_fetch_strictly_public"] },
    }),
  ).not.toThrow();
});
