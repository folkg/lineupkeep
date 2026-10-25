import { spawnSync } from "node:child_process";

import { assertDeployableComposition } from "@sourdough/web/deploy/verifyComposition.ts";

const target = process.argv[2];
if (target !== "node" && target !== "cloudflare") {
  throw new Error("Build target must be node or cloudflare");
}
const testComposition = process.argv[3] === "--test-composition";
const result = spawnSync("bun", ["--no-env-file", "--filter", "@sourdough/web", "build"], {
  cwd: new URL("../../", import.meta.url),
  stdio: "inherit",
  env: {
    PATH: process.env["PATH"],
    HOME: process.env["HOME"],
    TMPDIR: process.env["TMPDIR"],
    NODE_ENV: "production",
    DEPLOY_TARGET: target,
    BUILD_WITHOUT_DOTENV: "true",
    E2E_TEST_COMPOSITION: testComposition ? "true" : "false",
    ...(testComposition ? { E2E_SERVICE_PROGRAMS: process.env["E2E_SERVICE_PROGRAMS"] } : {}),
  },
});
if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  process.exitCode = result.status ?? 1;
} else if (!testComposition) {
  await assertDeployableComposition(
    new URL(
      target === "cloudflare" ? "../../apps/web/dist/server/" : "../../apps/web/.output/server/",
      import.meta.url,
    ),
  );
}
