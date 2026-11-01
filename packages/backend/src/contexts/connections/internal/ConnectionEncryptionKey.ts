import { Config, ConfigProvider, Context, Effect, Layer, Redacted, Schema } from "effect";

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
      const keyVersion = yield* Config.Int("CONNECTION_ENCRYPTION_KEY_VERSION").pipe(
        Config.withDefault(defaultKeyVersion),
      );
      if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0) {
        return yield* Effect.fail(
          configurationRejected("CONNECTION_ENCRYPTION_KEY_VERSION must be a positive integer"),
        );
      }
      const bytes = yield* Schema.decodeEffect(Schema.Uint8ArrayFromBase64)(
        Redacted.value(configured),
      ).pipe(Effect.mapError((cause) => new Config.ConfigError(cause)));
      if (bytes.length !== connectionEncryptionKeyBytes) {
        return yield* Effect.fail(
          configurationRejected("CONNECTION_ENCRYPTION_KEY must be a base64-encoded 32-byte key"),
        );
      }
      return yield* importConnectionEncryptionKey(bytes, keyVersion);
    }),
  );

  static fromBytes(input: {
    readonly bytes: Uint8Array;
    readonly keyVersion: number;
  }): Layer.Layer<ConnectionEncryptionKey> {
    return Layer.effect(
      ConnectionEncryptionKey,
      importConnectionEncryptionKey(input.bytes, input.keyVersion).pipe(Effect.orDie),
    );
  }
}

export const connectionEncryptionKeyBytes = 32;

export function importConnectionEncryptionKey(
  bytes: Uint8Array,
  keyVersion: number,
): Effect.Effect<ConnectionEncryptionKeyShape, Config.ConfigError> {
  const raw = new Uint8Array(bytes);
  return Effect.tryPromise({
    try: () =>
      globalThis.crypto.subtle
        .importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"])
        .then((key) => ({ key, keyVersion })),
    catch: () => configurationRejected("Connection encryption key material could not be imported"),
  });
}

export function configurationRejected(message: string): Config.ConfigError {
  return new Config.ConfigError(new ConfigProvider.SourceError({ message }));
}

const defaultKeyVersion = 1;
