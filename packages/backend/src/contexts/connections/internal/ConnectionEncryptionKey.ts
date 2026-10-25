import { Config, ConfigProvider, Context, Effect, Layer, Redacted, Schema } from "effect";

import { connectionEncryptionKeyVersion } from "#contexts/connections/ConnectionLimits.ts";

export type ConnectionEncryptionKeyShape = {
  readonly key: CryptoKey;
  readonly keyVersion: number;
};

export class ConnectionEncryptionKey extends Context.Service<
  ConnectionEncryptionKey,
  ConnectionEncryptionKeyShape
>()("@lineupkeep/backend/contexts/connections/internal/ConnectionEncryptionKey") {
  static readonly layer: Layer.Layer<ConnectionEncryptionKey, Config.ConfigError> = Layer.effect(
    ConnectionEncryptionKey,
    Effect.gen(function* () {
      const configured = yield* Config.Redacted("CONNECTION_ENCRYPTION_KEY");
      const bytes = yield* Schema.decodeEffect(Schema.Uint8ArrayFromBase64)(
        Redacted.value(configured),
      ).pipe(Effect.mapError((cause) => new Config.ConfigError(cause)));
      if (bytes.length !== 32) {
        return yield* Effect.fail(
          new Config.ConfigError(
            new ConfigProvider.SourceError({
              message: "CONNECTION_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
            }),
          ),
        );
      }
      return yield* importKey(bytes, connectionEncryptionKeyVersion);
    }),
  );

  static fromBytes(input: {
    readonly bytes: Uint8Array;
    readonly keyVersion: number;
  }): Layer.Layer<ConnectionEncryptionKey> {
    return Layer.effect(
      ConnectionEncryptionKey,
      importKey(input.bytes, input.keyVersion).pipe(Effect.orDie),
    );
  }
}

function importKey(
  bytes: Uint8Array,
  keyVersion: number,
): Effect.Effect<ConnectionEncryptionKeyShape, Config.ConfigError> {
  const raw = new Uint8Array(bytes);
  return Effect.tryPromise({
    try: () =>
      globalThis.crypto.subtle
        .importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
        .then((key) => ({ key, keyVersion })),
    catch: () =>
      new Config.ConfigError(
        new ConfigProvider.SourceError({
          message: "CONNECTION_ENCRYPTION_KEY could not be imported",
        }),
      ),
  });
}
