import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { parseCliArguments, runCliCommand } from "./Cli.ts";
import { DeviceAuthorization } from "./DeviceAuthorization.ts";
import { LinkingUpload } from "./LinkingUpload.ts";
import { ProviderBrowser } from "./ProviderBrowser.ts";
import { Terminal } from "./Terminal.ts";

it("defaults to linking Yahoo against the local app", () => {
  const command = parseCliArguments([], {});

  assert.strictEqual(command._tag, "Link");
  if (command._tag !== "Link") {
    return;
  }
  assert.strictEqual(command.options.appUrl.href, "http://localhost:5173/");
  assert.strictEqual(command.options.provider, "yahoo");
  assert.strictEqual(command.options.headless, false);
});

it("accepts the link command, provider, and app origin in either form", () => {
  const spaced = parseCliArguments(
    ["link", "--provider", "yahoo", "--app-url", "https://lineupkeep.example"],
    {},
  );
  const assigned = parseCliArguments(["--provider=yahoo", "--app-url=http://127.0.0.1:3000"], {});
  const environment = parseCliArguments([], {
    LINEUPKEEP_APP_URL: "http://localhost:4000",
  });

  assert.strictEqual(spaced._tag, "Link");
  assert.strictEqual(assigned._tag, "Link");
  assert.strictEqual(environment._tag, "Link");
  if (spaced._tag !== "Link" || assigned._tag !== "Link" || environment._tag !== "Link") {
    return;
  }
  assert.strictEqual(spaced.options.appUrl.href, "https://lineupkeep.example/");
  assert.strictEqual(assigned.options.appUrl.href, "http://127.0.0.1:3000/");
  assert.strictEqual(environment.options.appUrl.href, "http://localhost:4000/");
});

it("shows help without requiring any service", () => {
  assert.strictEqual(parseCliArguments(["--help"], {})._tag, "Help");
  assert.strictEqual(parseCliArguments(["link", "-h"], {})._tag, "Help");
});

it("rejects unsupported providers and unsafe app origins", () => {
  assert.strictEqual(parseCliArguments(["--provider", "espn"], {})._tag, "Invalid");
  assert.strictEqual(
    parseCliArguments(["--app-url", "http://lineupkeep.example"], {})._tag,
    "Invalid",
  );
  assert.strictEqual(
    parseCliArguments(["--app-url", "https://lineupkeep.example/app"], {})._tag,
    "Invalid",
  );
  assert.strictEqual(
    parseCliArguments(["--app-url", "https://user:pass@lineupkeep.example"], {})._tag,
    "Invalid",
  );
  assert.strictEqual(
    parseCliArguments(["--app-url", "https://lineupkeep.example?x=1"], {})._tag,
    "Invalid",
  );
  assert.strictEqual(parseCliArguments(["--app-url", "file:///tmp/app"], {})._tag, "Invalid");
});

it("rejects missing values, unknown options, and unknown commands", () => {
  assert.strictEqual(parseCliArguments(["--app-url"], {})._tag, "Invalid");
  assert.strictEqual(parseCliArguments(["--provider"], {})._tag, "Invalid");
  assert.strictEqual(parseCliArguments(["--verbose"], {})._tag, "Invalid");
  assert.strictEqual(parseCliArguments(["link", "extra"], {})._tag, "Invalid");
  assert.strictEqual(parseCliArguments(["pair"], {})._tag, "Invalid");
});

it.effect(
  "prints help to stdout and reports invalid arguments on stderr",
  () =>
    Effect.gen(function* () {
      const writes: Array<string> = [];
      const errors: Array<string> = [];
      const layers = Layer.mergeAll(
        Layer.succeed(Terminal)({
          write: (message) => Effect.sync(() => writes.push(message)),
          error: (message) => Effect.sync(() => errors.push(message)),
        }),
        Layer.succeed(DeviceAuthorization)(unusedDevice),
        Layer.succeed(ProviderBrowser)(unusedBrowser),
        Layer.succeed(LinkingUpload)(unusedUpload),
      );

      const helpCode = yield* runCliCommand({ _tag: "Help", text: "usage" }).pipe(
        Effect.provide(layers),
      );
      const invalidCode = yield* runCliCommand({ _tag: "Invalid", message: "bad option" }).pipe(
        Effect.provide(layers),
      );

      assert.strictEqual(helpCode, 0);
      assert.strictEqual(invalidCode, 2);
      assert.deepStrictEqual(writes, ["usage"]);
      assert.deepStrictEqual(errors, ["bad option"]);
    }),
  30_000,
);

const unusedDevice: DeviceAuthorization["Service"] = {
  start: () => Effect.die("unused"),
  awaitApproval: () => Effect.die("unused"),
};

const unusedBrowser: ProviderBrowser["Service"] = {
  signIn: () => Effect.die("unused"),
};

const unusedUpload: LinkingUpload["Service"] = {
  upload: () => Effect.die("unused"),
};
