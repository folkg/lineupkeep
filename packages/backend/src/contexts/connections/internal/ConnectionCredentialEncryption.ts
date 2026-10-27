import { Config, Context, Crypto, Effect, Layer, Redacted, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { ConnectionId, ProviderKey } from "#contexts/connections/Connection.ts";

import { ConnectionEncryptionKey } from "./ConnectionEncryptionKey.ts";

export type ConnectionCredentialEncryptionShape = {
  readonly encrypt: (input: {
    readonly userId: UserId;
    readonly connectionId: ConnectionId;
    readonly provider: ProviderKey;
    readonly plaintext: Redacted.Redacted<string>;
  }) => Effect.Effect<string, CredentialEncryptionFailed>;

  readonly decrypt: (input: {
    readonly userId: UserId;
    readonly connectionId: ConnectionId;
    readonly provider: ProviderKey;
    readonly envelope: string;
  }) => Effect.Effect<Redacted.Redacted<string>, CredentialDecryptionFailed>;
};

export class ConnectionCredentialEncryption extends Context.Service<
  ConnectionCredentialEncryption,
  ConnectionCredentialEncryptionShape
>()("@lineupkeep/backend/contexts/connections/internal/ConnectionCredentialEncryption") {
  static readonly layer: Layer.Layer<
    ConnectionCredentialEncryption,
    Config.ConfigError,
    Crypto.Crypto
  > = Layer.effect(ConnectionCredentialEncryption, makeCredentialEncryption()).pipe(
    Layer.provide(ConnectionEncryptionKey.layer),
  );

  static forKey(
    key: Layer.Layer<ConnectionEncryptionKey>,
  ): Layer.Layer<ConnectionCredentialEncryption, never, Crypto.Crypto> {
    return Layer.effect(ConnectionCredentialEncryption, makeCredentialEncryption()).pipe(
      Layer.provide(key),
    );
  }
}

function makeCredentialEncryption(): Effect.Effect<
  ConnectionCredentialEncryptionShape,
  never,
  ConnectionEncryptionKey | Crypto.Crypto
> {
  return Effect.gen(function* () {
    const key = yield* ConnectionEncryptionKey;
    const crypto = yield* Crypto.Crypto;

    const encrypt = Effect.fn("ConnectionCredentialEncryption.encrypt")(function* (input: {
      readonly userId: UserId;
      readonly connectionId: ConnectionId;
      readonly provider: ProviderKey;
      readonly plaintext: Redacted.Redacted<string>;
    }) {
      const nonce = yield* crypto
        .randomBytes(nonceBytes)
        .pipe(Effect.mapError(() => CredentialEncryptionFailed.make({})));
      const aad = additionalData({
        ...input,
        keyVersion: key.keyVersion,
      });
      const ciphertext = yield* encryptBytes({
        key: key.key,
        nonce: new Uint8Array(nonce),
        aad,
        plaintext: new TextEncoder().encode(Redacted.value(input.plaintext)),
      });
      return yield* Schema.encodeEffect(Schema.fromJsonString(CredentialEnvelope))({
        version: envelopeVersion,
        keyVersion: key.keyVersion,
        nonce: new Uint8Array(nonce),
        ciphertext,
      }).pipe(Effect.mapError(() => CredentialEncryptionFailed.make({})));
    });

    const decrypt = Effect.fn("ConnectionCredentialEncryption.decrypt")(function* (input: {
      readonly userId: UserId;
      readonly connectionId: ConnectionId;
      readonly provider: ProviderKey;
      readonly envelope: string;
    }) {
      const envelope = yield* Schema.decodeEffect(Schema.fromJsonString(CredentialEnvelope))(
        input.envelope,
      ).pipe(Effect.mapError(() => CredentialDecryptionFailed.make({})));
      if (
        envelope.keyVersion !== key.keyVersion ||
        envelope.nonce.length !== nonceBytes ||
        envelope.ciphertext.length < authenticationTagBytes
      ) {
        return yield* CredentialDecryptionFailed.make({});
      }
      const plaintext = yield* decryptBytes({
        key: key.key,
        nonce: new Uint8Array(envelope.nonce),
        ciphertext: new Uint8Array(envelope.ciphertext),
        aad: additionalData({ ...input, keyVersion: envelope.keyVersion }),
      });
      return Redacted.make(new TextDecoder().decode(plaintext));
    });

    return { encrypt, decrypt };
  });
}

function encryptBytes(input: {
  readonly key: CryptoKey;
  readonly nonce: Uint8Array<ArrayBuffer>;
  readonly aad: Uint8Array<ArrayBuffer>;
  readonly plaintext: Uint8Array<ArrayBuffer>;
}): Effect.Effect<Uint8Array<ArrayBuffer>, CredentialEncryptionFailed> {
  return Effect.tryPromise({
    try: () =>
      globalThis.crypto.subtle
        .encrypt(
          { name: "AES-GCM", iv: input.nonce, additionalData: input.aad },
          input.key,
          input.plaintext,
        )
        .then((ciphertext) => new Uint8Array(ciphertext)),
    catch: () => CredentialEncryptionFailed.make({}),
  });
}

function decryptBytes(input: {
  readonly key: CryptoKey;
  readonly nonce: Uint8Array<ArrayBuffer>;
  readonly ciphertext: Uint8Array<ArrayBuffer>;
  readonly aad: Uint8Array<ArrayBuffer>;
}): Effect.Effect<Uint8Array<ArrayBuffer>, CredentialDecryptionFailed> {
  return Effect.tryPromise({
    try: () =>
      globalThis.crypto.subtle
        .decrypt(
          { name: "AES-GCM", iv: input.nonce, additionalData: input.aad },
          input.key,
          input.ciphertext,
        )
        .then((plaintext) => new Uint8Array(plaintext)),
    catch: () => CredentialDecryptionFailed.make({}),
  });
}

function additionalData(input: {
  readonly userId: UserId;
  readonly connectionId: ConnectionId;
  readonly provider: ProviderKey;
  readonly keyVersion: number;
}): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(
    [
      "lineupkeep.connection-credential",
      String(envelopeVersion),
      String(input.keyVersion),
      input.userId,
      input.connectionId,
      input.provider,
    ].join("\u0000"),
  );
}

class CredentialEncryptionFailed extends Schema.TaggedError<
  CredentialEncryptionFailed,
  { readonly brand: unique symbol }
>()("connection.credential_encryption_failed", {}) {}

class CredentialDecryptionFailed extends Schema.TaggedError<
  CredentialDecryptionFailed,
  { readonly brand: unique symbol }
>()("connection.credential_decryption_failed", {}) {}

const CredentialEnvelope = Schema.Struct({
  version: Schema.Literal(1),
  keyVersion: Schema.Int.check(Schema.isGreaterThan(0)),
  nonce: Schema.Uint8ArrayFromBase64Url,
  ciphertext: Schema.Uint8ArrayFromBase64Url,
});

const envelopeVersion = 1;

const nonceBytes = 12;

const authenticationTagBytes = 16;
