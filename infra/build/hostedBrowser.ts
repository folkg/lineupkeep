import * as Command from "alchemy/Command";
import * as Docker from "alchemy/Docker";
import { Effect } from "effect";

export function buildHostedBrowserImage(): Effect.Effect<
  Docker.Image,
  never,
  import("alchemy").Provider<Command.Build> | Docker.Providers
> {
  return Effect.gen(function* () {
    const build = yield* Command.Build("BuildHostedBrowser", {
      cwd: new URL("../../", import.meta.url).pathname,
      command: "bun --filter @lineupkeep/hosted-browser-service build",
      env: { NODE_ENV: "production" },
      memo: false,
      outdir: "apps/hosted-browser/.output",
      timeout: "5 minutes",
    });
    return yield* Docker.Image("HostedBrowserImage", {
      build: {
        context: build.outdir,
        dockerfile: new URL("../../apps/hosted-browser/deploy/Dockerfile", import.meta.url)
          .pathname,
        platform: "linux/amd64",
      },
    });
  });
}
