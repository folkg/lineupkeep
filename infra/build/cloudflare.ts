import * as Command from "alchemy/Command";

export function buildCloudflare(
  programs?: string,
): import("effect/Effect").Effect<Command.Build, never, import("alchemy").Provider<Command.Build>> {
  return Command.Build("Build", {
    cwd: new URL("../../", import.meta.url).pathname,
    command: `node infra/build/run.ts cloudflare${programs === undefined ? "" : " --test-composition"}`,
    env: {
      NODE_ENV: "production",
      DEPLOY_TARGET: "cloudflare",
      BUILD_WITHOUT_DOTENV: "true",
      E2E_TEST_COMPOSITION: programs === undefined ? "false" : "true",
      ...(programs === undefined ? {} : { E2E_SERVICE_PROGRAMS: programs }),
    },
    outdir: "apps/web/dist",
    memo: false,
    timeout: "5 minutes",
  });
}
