import { readFile } from "node:fs/promises";

import { Schema } from "effect";

import { assertDeployableComposition } from "#deploy/verifyComposition.ts";

import { assertPublicRouting } from "./settings.ts";

if (import.meta.main) {
  await assertDeployableComposition(new URL("../../dist/server/", import.meta.url));
  const configuration = Schema.decodeSync(
    Schema.fromJsonString(
      Schema.Struct({
        main: Schema.Literal("server.js"),
        bundle: Schema.Literal(false),
        compatibility: Schema.Struct({ date: Schema.String, flags: Schema.Array(Schema.String) }),
      }),
    ),
  )(await readFile("dist/server/worker-configuration.json", "utf8"));
  assertPublicRouting(configuration);
  await readFile(new URL(`../../dist/server/${configuration.main}`, import.meta.url));
}
