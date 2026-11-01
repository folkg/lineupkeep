import { Config, Effect, Option, Redacted, Schema } from "effect";

import {
  ConnectionEncryptionKey,
  configurationRejected,
  connectionEncryptionKeyBytes,
  importConnectionEncryptionKey,
} from "./ConnectionEncryptionKey.ts";
import type { ConnectionEncryptionKeyShape } from "./ConnectionEncryptionKey.ts";

export type ConnectionEncryptionKeyring = {
  readonly current: ConnectionEncryptionKeyShape;
  readonly keysByVersion: ReadonlyMap<number, CryptoKey>;
  readonly retainedKeyVersions: ReadonlyArray<number>;
};

export const loadConnectionEncryptionKeyring: Effect.Effect<
  ConnectionEncryptionKeyring,
  Config.ConfigError,
  ConnectionEncryptionKey
> = Effect.gen(function* () {
  const current = yield* ConnectionEncryptionKey;
  const retained = yield* loadRetainedKeys(current.keyVersion);
  return keyringOf(current, retained);
});

export function keyringOf(
  current: ConnectionEncryptionKeyShape,
  retained: ReadonlyArray<ConnectionEncryptionKeyShape>,
): ConnectionEncryptionKeyring {
  return {
    current,
    keysByVersion: new Map([
      [current.keyVersion, current.key],
      ...retained.map((key) => [key.keyVersion, key.key] as const),
    ]),
    retainedKeyVersions: retained.map((key) => key.keyVersion).sort((left, right) => left - right),
  };
}

function loadRetainedKeys(
  currentKeyVersion: number,
): Effect.Effect<ReadonlyArray<ConnectionEncryptionKeyShape>, Config.ConfigError> {
  return Effect.gen(function* () {
    const configured = yield* Config.option(Config.Redacted("CONNECTION_ENCRYPTION_RETAINED_KEYS"));
    if (Option.isNone(configured)) {
      return [];
    }
    const entries = Redacted.value(configured.value)
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const seen = new Set<number>();
    const keys: Array<ConnectionEncryptionKeyShape> = [];
    for (const entry of entries) {
      const separator = entry.indexOf(":");
      const versionText = separator === -1 ? "" : entry.slice(0, separator);
      if (separator === -1 || !/^\d+$/.test(versionText)) {
        return yield* Effect.fail(
          configurationRejected(
            "CONNECTION_ENCRYPTION_RETAINED_KEYS entries must be version:base64-key pairs",
          ),
        );
      }
      const keyVersion = Number(versionText);
      if (!Number.isSafeInteger(keyVersion) || keyVersion <= 0) {
        return yield* Effect.fail(
          configurationRejected(
            "CONNECTION_ENCRYPTION_RETAINED_KEYS versions must be positive integers",
          ),
        );
      }
      if (keyVersion === currentKeyVersion) {
        return yield* Effect.fail(
          configurationRejected(
            "CONNECTION_ENCRYPTION_RETAINED_KEYS must not repeat the current key version",
          ),
        );
      }
      if (seen.has(keyVersion)) {
        return yield* Effect.fail(
          configurationRejected(
            `CONNECTION_ENCRYPTION_RETAINED_KEYS declares key version ${String(keyVersion)} more than once`,
          ),
        );
      }
      const bytes = yield* Schema.decodeEffect(Schema.Uint8ArrayFromBase64)(
        entry.slice(separator + 1),
      ).pipe(
        Effect.mapError(() =>
          configurationRejected(
            `CONNECTION_ENCRYPTION_RETAINED_KEYS key version ${String(keyVersion)} is not base64-encoded`,
          ),
        ),
      );
      if (bytes.length !== connectionEncryptionKeyBytes) {
        return yield* Effect.fail(
          configurationRejected(
            `CONNECTION_ENCRYPTION_RETAINED_KEYS key version ${String(keyVersion)} must be a 32-byte key`,
          ),
        );
      }
      const key = yield* importConnectionEncryptionKey(bytes, keyVersion);
      keys.push(key);
      seen.add(keyVersion);
    }
    return keys;
  });
}
