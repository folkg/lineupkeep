import { assert, it } from "@effect/vitest";
import { linkingHelperClient } from "@lineupkeep/backend/auth/AuthorizationScopes";
import { decodeProviderKey } from "@lineupkeep/backend/connections/ProviderKey";
import { Array, Duration, Effect, Layer, Redacted } from "effect";

import type { DeviceFlowFailure } from "./DeviceAuthorization.ts";
import { DeviceAuthorization, DeviceAuthorizationDenied } from "./DeviceAuthorization.ts";
import type { DeviceGrant } from "./DeviceAuthorization.ts";
import { runLinkCommand } from "./LinkCommand.ts";
import type { LinkCommandOptions } from "./LinkCommand.ts";
import { LinkingUpload, LinkingUploadRejected } from "./LinkingUpload.ts";
import type { LinkingUploadFailure, LinkingUploadInput } from "./LinkingUpload.ts";
import {
  ProviderBrowser,
  ProviderLoginTimedOut as ProviderLoginTimedOutFailure,
} from "./ProviderBrowser.ts";
import type { ProviderLoginFailure } from "./ProviderBrowser.ts";
import { Terminal } from "./Terminal.ts";

it.effect(
  "prints only the public pairing code and never the device code, token, or provider session",
  () =>
    Effect.gen(function* () {
      const observation = yield* runWith({});

      assert.strictEqual(observation.exitCode, 0);
      const output = observation.writes.join("\n");
      assert.include(output, "http://localhost:5173/connections");
      assert.include(output, userCode);
      assert.include(output, "Yahoo is linked.");
      assert.notInclude(output, deviceCodeValue);
      assert.notInclude(output, tokenValue);
      assert.notInclude(output, sessionValue);
      assert.deepStrictEqual(observation.errors, []);
      assert.strictEqual(observation.uploaded.length, 1);
      const uploaded = Array.getUnsafe(observation.uploaded, 0);
      assert.strictEqual(uploaded.userCode, userCode);
      assert.strictEqual(uploaded.appUrl.href, options.appUrl.href);
      assert.strictEqual(Redacted.value(uploaded.token), tokenValue);
      assert.strictEqual(Redacted.value(uploaded.session), sessionValue);
      assert.strictEqual(uploaded.provider, "yahoo");
    }),
  30_000,
);

it.effect(
  "reports a denied pairing without revealing the device code",
  () =>
    Effect.gen(function* () {
      const observation = yield* runWith({
        deviceFailure: deniedFailure,
      });

      assert.strictEqual(observation.exitCode, 1);
      assert.include(observation.errors.join("\n"), "denied the helper request");
      assert.notInclude(observation.errors.join("\n"), deviceCodeValue);
      assert.deepStrictEqual(observation.uploaded, []);
    }),
  30_000,
);

it.effect(
  "reports a failed provider sign-in without revealing the session",
  () =>
    Effect.gen(function* () {
      const observation = yield* runWith({
        browserFailure: ProviderLoginTimedOutFailure.make({}),
      });

      assert.strictEqual(observation.exitCode, 1);
      assert.include(observation.errors.join("\n"), "sign-in was not completed in time");
      assert.notInclude(observation.errors.join("\n"), sessionValue);
    }),
  30_000,
);

it.effect(
  "reports a rejected upload with the recovery step",
  () =>
    Effect.gen(function* () {
      const observation = yield* runWith({
        uploadFailure: uploadRejected,
      });

      assert.strictEqual(observation.exitCode, 1);
      assert.include(observation.errors.join("\n"), "Start again from the Connections page");
      assert.notInclude(observation.errors.join("\n"), tokenValue);
      assert.notInclude(observation.errors.join("\n"), sessionValue);
    }),
  30_000,
);

function runWith(scenario: {
  readonly deviceFailure?: DeviceFlowFailure;
  readonly browserFailure?: ProviderLoginFailure;
  readonly uploadFailure?: LinkingUploadFailure;
}): Effect.Effect<Observation> {
  return Effect.gen(function* () {
    const writes: Array<string> = [];
    const errors: Array<string> = [];
    const uploaded: Array<LinkingUploadInput> = [];
    const layers = Layer.mergeAll(
      Layer.succeed(Terminal)({
        write: (message) => Effect.sync(() => writes.push(message)),
        error: (message) => Effect.sync(() => errors.push(message)),
      }),
      Layer.succeed(DeviceAuthorization)({
        start: () => Effect.succeed(grant),
        awaitApproval: () =>
          scenario.deviceFailure === undefined
            ? Effect.succeed(Redacted.make(tokenValue))
            : Effect.fail(scenario.deviceFailure),
      }),
      Layer.succeed(ProviderBrowser)({
        signIn: () =>
          scenario.browserFailure === undefined
            ? Effect.succeed(Redacted.make(sessionValue))
            : Effect.fail(scenario.browserFailure),
      }),
      Layer.succeed(LinkingUpload)({
        upload: (input) =>
          scenario.uploadFailure === undefined
            ? Effect.sync(() => {
                uploaded.push(input);
              })
            : Effect.fail(scenario.uploadFailure),
      }),
    );
    const exitCode = yield* runLinkCommand(options).pipe(Effect.provide(layers));
    return { writes, errors, uploaded, exitCode };
  });
}

const options: LinkCommandOptions = {
  appUrl: new URL("http://localhost:5173"),
  provider: decodeProviderKey("yahoo"),
  providerLabel: "Yahoo",
  providerLoginUrl: new URL("https://football.fantasysports.yahoo.com/"),
  sessionCookies: ["T", "Y"],
  headless: false,
  loginTimeout: Duration.minutes(10),
  profileRoot: "/tmp",
};

const userCode = "ABCD2345";
const deviceCodeValue = "device-code-canary-value";
const tokenValue = "access-token-canary-value";
const sessionValue = "T=session-canary; Y=user-canary";

const grant: DeviceGrant = {
  appUrl: options.appUrl,
  clientId: linkingHelperClient.clientId,
  deviceCode: Redacted.make(deviceCodeValue),
  userCode,
  verificationUri: new URL(`${options.appUrl.origin}/connections`),
  expiresInSeconds: 600,
  expiresAtMillis: Number.MAX_SAFE_INTEGER,
  intervalSeconds: 5,
};

const deniedFailure: DeviceFlowFailure = DeviceAuthorizationDenied.make({});
const uploadRejected: LinkingUploadFailure = LinkingUploadRejected.make({});

type Observation = {
  readonly writes: ReadonlyArray<string>;
  readonly errors: ReadonlyArray<string>;
  readonly uploaded: ReadonlyArray<LinkingUploadInput>;
  readonly exitCode: number;
};
