import { assert, it } from "@effect/vitest";
import { ConfigProvider, Config, Effect, Exit, Layer } from "effect";

import { ConnectionEncryptionKey } from "./ConnectionEncryptionKey.ts";
import { loadConnectionEncryptionKeyring } from "./ConnectionEncryptionKeyring.ts";

it.effect("loads the current key and every retained key version", () =>
  Effect.gen(function* () {
    const keyring = yield* loadConnectionEncryptionKeyring;

    assert.strictEqual(keyring.current.keyVersion, 2);
    assert.deepStrictEqual(keyring.retainedKeyVersions, [1]);
    assert.strictEqual(keyring.keysByVersion.size, 2);
    assert.isDefined(keyring.keysByVersion.get(1));
    assert.isDefined(keyring.keysByVersion.get(2));
  }).pipe(Effect.provide(KeyringLayer(`1:${oldKey}`))),
);

it.effect("treats a blank retained list as a single-key ring", () =>
  Effect.gen(function* () {
    const keyring = yield* loadConnectionEncryptionKeyring;

    assert.deepStrictEqual(keyring.retainedKeyVersions, []);
    assert.strictEqual(keyring.keysByVersion.size, 1);
  }).pipe(Effect.provide(KeyringLayer(""))),
);

it.effect("refuses a retained entry that repeats the current key version", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(loadConnectionEncryptionKeyring);

    assert.isTrue(Exit.isFailure(exit));
    const rendered = Exit.isFailure(exit) ? String(exit.cause) : "";
    assert.include(rendered, "must not repeat the current key version");
    assert.notInclude(rendered, oldKey);
  }).pipe(Effect.provide(KeyringLayer(`2:${oldKey}`))),
);

it.effect("refuses a retained entry that declares the same version twice", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(loadConnectionEncryptionKeyring);

    assert.isTrue(Exit.isFailure(exit));
    const rendered = Exit.isFailure(exit) ? String(exit.cause) : "";
    assert.include(rendered, "declares key version 1 more than once");
    assert.notInclude(rendered, oldKey);
  }).pipe(Effect.provide(KeyringLayer(`1:${oldKey},1:${otherKey}`))),
);

it.effect("refuses retained entries that are not version:key pairs", () =>
  Effect.gen(function* () {
    const missingSeparator = yield* Effect.exit(
      loadConnectionEncryptionKeyring.pipe(Effect.provide(KeyringLayer(oldKey))),
    );
    const invalidVersion = yield* Effect.exit(
      loadConnectionEncryptionKeyring.pipe(Effect.provide(KeyringLayer(`0:${oldKey}`))),
    );

    assert.isTrue(Exit.isFailure(missingSeparator));
    assert.include(
      Exit.isFailure(missingSeparator) ? String(missingSeparator.cause) : "",
      "must be version:base64-key pairs",
    );
    assert.isTrue(Exit.isFailure(invalidVersion));
    assert.include(
      Exit.isFailure(invalidVersion) ? String(invalidVersion.cause) : "",
      "versions must be positive integers",
    );
  }),
);

it.effect("refuses retained material that is not a 32-byte base64 key without echoing it", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(loadConnectionEncryptionKeyring);
    const rendered = Exit.isFailure(exit) ? String(exit.cause) : "";

    assert.isTrue(Exit.isFailure(exit));
    assert.include(rendered, "must be a 32-byte key");
    assert.notInclude(rendered, shortKey);
  }).pipe(Effect.provide(KeyringLayer(`1:${shortKey}`))),
);

it.effect("refuses retained material that is not base64 without echoing it", () =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(loadConnectionEncryptionKeyring);
    const rendered = Exit.isFailure(exit) ? String(exit.cause) : "";

    assert.isTrue(Exit.isFailure(exit));
    assert.include(rendered, "is not base64-encoded");
    assert.notInclude(rendered, "not base64 material");
  }).pipe(Effect.provide(KeyringLayer("1:not base64 material"))),
);

const currentKey = Buffer.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ987654").toString("base64");
const oldKey = Buffer.from("abcdefghijklmnopqrstuvwxyz012345").toString("base64");
const otherKey = Buffer.from("0123456789abcdef0123456789abcdef").toString("base64");
const shortKey = Buffer.from("short-key").toString("base64");

function KeyringLayer(retained: string): Layer.Layer<ConnectionEncryptionKey, Config.ConfigError> {
  const configuration = {
    CONNECTION_ENCRYPTION_KEY: currentKey,
    CONNECTION_ENCRYPTION_KEY_VERSION: "2",
    CONNECTION_ENCRYPTION_RETAINED_KEYS: retained,
  };
  return Layer.merge(
    ConnectionEncryptionKey.layer.pipe(
      Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(configuration))),
    ),
    ConfigProvider.layer(ConfigProvider.fromUnknown(configuration)),
  );
}
