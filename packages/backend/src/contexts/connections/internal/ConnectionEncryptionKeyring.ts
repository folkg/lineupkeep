import { EffectString } from "@lineupkeep/collections";
import { Config, Effect, Option, Redacted, Schema } from "effect";
import { Array as EffectArray } from "effect";
import { dual } from "effect/Function";

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

export const keyringOf: {
  (
    retained: ReadonlyArray<ConnectionEncryptionKeyShape>,
  ): (current: ConnectionEncryptionKeyShape) => ConnectionEncryptionKeyring;
  (
    current: ConnectionEncryptionKeyShape,
    retained: ReadonlyArray<ConnectionEncryptionKeyShape>,
  ): ConnectionEncryptionKeyring;
} = dual(
  2,
  (
    current: ConnectionEncryptionKeyShape,
    retained: ReadonlyArray<ConnectionEncryptionKeyShape>,
  ): ConnectionEncryptionKeyring => ({
    current,
    keysByVersion: new Map([
      [current.keyVersion, current.key],
      ...EffectArray.map(retained, (key) => [key.keyVersion, key.key] as const),
    ]),
    retainedKeyVersions: EffectArray.map(retained, (key) => key.keyVersion).sort(
      (left, right) => left - right,
    ),
  }),
);

function loadRetainedKeys(
  currentKeyVersion: number,
): Effect.Effect<ReadonlyArray<ConnectionEncryptionKeyShape>, Config.ConfigError> {
  return Effect.gen(function* () {
    const configured = yield* Config.option(Config.Redacted("CONNECTION_ENCRYPTION_RETAINED_KEYS"));
    if (Option.isNone(configured)) {
      return [];
    }
    const entries = EffectArray.filter(
      EffectArray.map(EffectString.split(Redacted.value(configured.value), ","), (entry) =>
        EffectString.trim(entry),
      ),
      (entry) => entry.length > 0,
    );
    const seen = new Set<number>();
    const keys: Array<ConnectionEncryptionKeyShape> = [];
    for (const entry of entries) {
      const separator = EffectString.indexOf(entry, ":");
      const versionText = separator === -1 ? "" : EffectString.slice(entry, 0, separator);
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
        EffectString.slice(entry, separator + 1),
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
