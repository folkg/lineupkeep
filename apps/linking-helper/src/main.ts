#!/usr/bin/env node
import { runMain } from "@effect/platform-node-shared/NodeRuntime";
import { Effect } from "effect";

import { runCli } from "./Cli.ts";

runMain(
  runCli(process.argv.slice(2), process.env).pipe(
    Effect.tap((code) =>
      Effect.sync(() => {
        process.exitCode = code;
      }),
    ),
  ),
);
