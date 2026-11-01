import { assert, it } from "@effect/vitest";
import { ConfigProvider, Config, Effect, Exit, Layer } from "effect";

import { ConnectionEncryptionKey } from "./ConnectionEncryptionKey.ts";

it.effect("imports a configured 32-byte base64 key", () =>
  Effect.gen(function* () {
    const key = yield* ConnectionEncryptionKey;

    assert.strictEqual(key.keyVersion, 1);
    assert.strictEqual(key.key.type, "secret");
    assert.strictEqual(key.key.algorithm.name, "AES-GCM");
  }).pipe(Effect.provide(KeyLayer({ CONNECTION_ENCRYPTION_KEY: configuredKey }))),
);

it.effect("reads the configured key version", () =>
  Effect.gen(function* () {
    const key = yield* ConnectionEncryptionKey;

    assert.strictEqual(key.keyVersion, 3);
  }).pipe(
    Effect.provide(
      KeyLayer({
        CONNECTION_ENCRYPTION_KEY: configuredKey,
        CONNECTION_ENCRYPTION_KEY_VERSION: "3",
      }),
    ),
  ),
);

it.effect("rejects a key version that is not a positive integer", () =>
  Effect.gen(function* () {
    for (const configured of ["0", "-1", "two"]) {
      const exit = yield* Effect.exit(
        Effect.scoped(
          Layer.build(
            KeyLayer({
              CONNECTION_ENCRYPTION_KEY: configuredKey,
              CONNECTION_ENCRYPTION_KEY_VERSION: configured,
            }),
          ),
        ),
      );

      assert.isTrue(Exit.isFailure(exit));
      const rendered = Exit.isFailure(exit) ? String(exit.cause) : "";
      assert.include(rendered, "CONNECTION_ENCRYPTION_KEY_VERSION");
    }
  }),
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

const configuredKey = Buffer.from("abcdefghijklmnopqrstuvwxyz012345").toString("base64");

function KeyLayer(
  configuration: Record<string, string>,
): Layer.Layer<ConnectionEncryptionKey, Config.ConfigError> {
  return ConnectionEncryptionKey.layer.pipe(
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(configuration))),
  );
}
