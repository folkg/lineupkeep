import { assert, it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit, Layer } from "effect";

import { ConnectionEncryptionKey } from "./ConnectionEncryptionKey.ts";

it.effect("imports a configured 32-byte base64 key", () =>
  Effect.gen(function* () {
    const key = yield* ConnectionEncryptionKey;

    assert.strictEqual(key.keyVersion, 1);
    assert.strictEqual(key.key.type, "secret");
    assert.strictEqual(key.key.algorithm.name, "AES-GCM");
  }).pipe(
    Effect.provide(
      ConnectionEncryptionKey.layer.pipe(
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              CONNECTION_ENCRYPTION_KEY: "NjrxUEL55AzXEec+MZlNC36QYdJ5DQAnO8iIVdY3sgo=",
            }),
          ),
        ),
      ),
    ),
  ),
);

it.effect("rejects key material that is not exactly 32 bytes without echoing it", () => {
  const configured = "c2hvcnQta2V5";
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(Effect.scoped(Layer.build(ConnectionEncryptionKey.layer)));

    assert.isTrue(Exit.isFailure(exit));
    const rendered = Exit.isFailure(exit) ? String(exit.cause) : "";
    assert.notInclude(rendered, configured);
    assert.include(rendered, "CONNECTION_ENCRYPTION_KEY");
  }).pipe(
    Effect.provide(
      ConfigProvider.layer(ConfigProvider.fromUnknown({ CONNECTION_ENCRYPTION_KEY: configured })),
    ),
  );
});

it.effect("rejects malformed base64 without echoing it", () => {
  const configured = "not base64 material";
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(Effect.scoped(Layer.build(ConnectionEncryptionKey.layer)));

    assert.isTrue(Exit.isFailure(exit));
    const rendered = Exit.isFailure(exit) ? String(exit.cause) : "";
    assert.notInclude(rendered, configured);
  }).pipe(
    Effect.provide(
      ConfigProvider.layer(ConfigProvider.fromUnknown({ CONNECTION_ENCRYPTION_KEY: configured })),
    ),
  );
});
