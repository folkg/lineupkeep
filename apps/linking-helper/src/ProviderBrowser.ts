import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";

import { Context, DateTime, Duration, Effect, Layer, Redacted, Schema } from "effect";
import { chromium } from "playwright";
import type { BrowserContext } from "playwright";

export class ProviderBrowser extends Context.Service<ProviderBrowser, ProviderBrowserShape>()(
  "@lineupkeep/linking-helper/ProviderBrowser",
) {}

type ProviderLoginOptions = {
  readonly loginUrl: URL;
  readonly sessionCookies: ReadonlyArray<string>;
  readonly headless: boolean;
  readonly timeout: Duration.Duration;
  readonly profileRoot: string;
};

export type ProviderBrowserShape = {
  readonly signIn: (
    options: ProviderLoginOptions,
  ) => Effect.Effect<Redacted.Redacted<string>, ProviderLoginFailure>;
};

export const ProviderBrowserLive = Layer.succeed(ProviderBrowser)({
  signIn: (options) => signInInTemporaryProfile(options),
});

function signInInTemporaryProfile(
  options: ProviderLoginOptions,
): Effect.Effect<Redacted.Redacted<string>, ProviderLoginFailure> {
  return Effect.scoped(
    Effect.gen(function* () {
      const profileDirectory = yield* Effect.acquireRelease(
        createProfileDirectory(options.profileRoot),
        (directory) => removeProfileDirectory(directory),
      );
      const browserContext = yield* Effect.acquireRelease(
        launchBrowser(profileDirectory, options.headless),
        (context) =>
          Effect.tryPromise({
            try: () => context.close(),
            catch: () => ProviderBrowserUnavailable.make({}),
          }).pipe(Effect.orDie),
      );
      const page =
        browserContext.pages()[0] ??
        (yield* Effect.tryPromise({
          try: () => browserContext.newPage(),
          catch: () => ProviderBrowserUnavailable.make({}),
        }));
      yield* Effect.tryPromise({
        try: () =>
          page.goto(options.loginUrl.href, {
            waitUntil: "domcontentloaded",
            timeout: Duration.toMillis(options.timeout),
          }),
        catch: () => ProviderLoginFailed.make({}),
      });
      return yield* waitForSession(browserContext, options);
    }),
  );
}

function createProfileDirectory(
  profileRoot: string,
): Effect.Effect<string, ProviderBrowserUnavailable> {
  return Effect.tryPromise({
    try: () => mkdtemp(join(profileRoot, "lineupkeep-linking-")),
    catch: () => ProviderBrowserUnavailable.make({}),
  });
}

function removeProfileDirectory(directory: string): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () => rm(directory, { recursive: true, force: true }),
    catch: (cause) => new Error("The temporary browser profile could not be removed", { cause }),
  }).pipe(Effect.orDie);
}

function launchBrowser(
  profileDirectory: string,
  headless: boolean,
): Effect.Effect<
  Awaited<ReturnType<typeof chromium.launchPersistentContext>>,
  ProviderBrowserUnavailable
> {
  return Effect.tryPromise({
    try: () => chromium.launchPersistentContext(profileDirectory, { headless }),
    catch: () => ProviderBrowserUnavailable.make({}),
  });
}

function waitForSession(
  browserContext: BrowserContext,
  options: ProviderLoginOptions,
): Effect.Effect<Redacted.Redacted<string>, ProviderLoginFailure> {
  return Effect.gen(function* () {
    const deadline =
      DateTime.toEpochMillis(yield* DateTime.now) + Duration.toMillis(options.timeout);
    let now = yield* DateTime.now;

    while (DateTime.toEpochMillis(now) < deadline) {
      const cookies = yield* Effect.tryPromise({
        try: () => browserContext.cookies([options.loginUrl.href]),
        catch: () => ProviderLoginClosed.make({}),
      }).pipe(Effect.result);
      if (cookies._tag === "Failure") {
        return yield* cookies.failure;
      }
      const session = options.sessionCookies.map((name) =>
        cookies.success.find((cookie) => cookie.name === name && cookie.value !== ""),
      );
      if (session.every((cookie) => cookie !== undefined)) {
        return Redacted.make(session.map((cookie) => `${cookie.name}=${cookie.value}`).join("; "));
      }
      if (browserContext.pages().length === 0) {
        return yield* ProviderLoginClosed.make({});
      }
      yield* Effect.sleep(Duration.seconds(1));
      now = yield* DateTime.now;
    }

    return yield* ProviderLoginTimedOut.make({});
  });
}

class ProviderBrowserUnavailable extends Schema.TaggedError<
  ProviderBrowserUnavailable,
  { readonly brand: unique symbol }
>()("linking_helper.provider_browser_unavailable", {}) {}

class ProviderLoginFailed extends Schema.TaggedError<
  ProviderLoginFailed,
  { readonly brand: unique symbol }
>()("linking_helper.provider_login_failed", {}) {}

class ProviderLoginClosed extends Schema.TaggedError<
  ProviderLoginClosed,
  { readonly brand: unique symbol }
>()("linking_helper.provider_login_closed", {}) {}

export class ProviderLoginTimedOut extends Schema.TaggedError<
  ProviderLoginTimedOut,
  { readonly brand: unique symbol }
>()("linking_helper.provider_login_timed_out", {}) {}

export type ProviderLoginFailure =
  | ProviderBrowserUnavailable
  | ProviderLoginFailed
  | ProviderLoginClosed
  | ProviderLoginTimedOut;
