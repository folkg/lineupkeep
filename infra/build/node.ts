import * as Command from "alchemy/Command";
import * as Docker from "alchemy/Docker";
import { Effect } from "effect";

export function buildNodeImage(
  programs?: string,
): Effect.Effect<
  Docker.Image,
  never,
  import("alchemy").Provider<Command.Build> | Docker.Providers
> {
  return Effect.gen(function* () {
    const build = yield* buildNode(programs);
    return yield* Docker.Image("Image", {
      build: {
        context: build.outdir,
        dockerfile: new URL("../../apps/web/deploy/node/Dockerfile", import.meta.url).pathname,
        platform: "linux/amd64",
      },
    });
  });
}

export function buildNode(
  programs?: string,
): Effect.Effect<Command.Build, never, import("alchemy").Provider<Command.Build>> {
  return Command.Build("Build", {
    cwd: new URL("../../", import.meta.url).pathname,
    command: `node infra/build/run.ts node${programs === undefined ? "" : " --test-composition"}`,
    env: {
      NODE_ENV: "production",
      E2E_TEST_COMPOSITION: programs === undefined ? "false" : "true",
      ...(programs === undefined ? {} : { E2E_SERVICE_PROGRAMS: programs }),
    },
    memo: false,
    outdir: "apps/web/.output",
    timeout: "5 minutes",
  });
}
