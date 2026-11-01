import { Config, Context, Crypto, Effect, Layer, Redacted, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { ConnectionId, ProviderKey } from "#contexts/connections/Connection.ts";

import { ConnectionCredentialRepository } from "./ConnectionCredentialRepository.ts";
import {
  ConnectionEncryptionKey,
  importConnectionEncryptionKey,
} from "./ConnectionEncryptionKey.ts";
import {
  keyringOf,
  loadConnectionEncryptionKeyring,
  type ConnectionEncryptionKeyring,
} from "./ConnectionEncryptionKeyring.ts";
import {
  credentialAuthenticationTagBytes,
  credentialEnvelopeVersion,
  credentialNonceBytes,
  decodeCredentialEnvelope,
  encodeCredentialEnvelope,
} from "./CredentialEnvelope.ts";

export type ConnectionCredentialEncryptionShape = {
  readonly currentKeyVersion: number;
  readonly retainedKeyVersions: ReadonlyArray<number>;
  readonly encrypt: (
    input: SealCredentialInput,
  ) => Effect.Effect<string, CredentialEncryptionFailed>;

  readonly open: (
    input: OpenCredentialInput,
  ) => Effect.Effect<Redacted.Redacted<string>, CredentialOpenFailed>;
};

type SealCredentialInput = {
  readonly userId: UserId;
  readonly connectionId: ConnectionId;
  readonly provider: ProviderKey;
  readonly plaintext: Redacted.Redacted<string>;
};

type OpenCredentialInput = {
  readonly userId: UserId;
  readonly connectionId: ConnectionId;
  readonly provider: ProviderKey;
  readonly envelope: string;
};

export class ConnectionCredentialEncryption extends Context.Service<
  ConnectionCredentialEncryption,
  ConnectionCredentialEncryptionShape
>()("@lineupkeep/backend/contexts/connections/internal/ConnectionCredentialEncryption") {
  static readonly layer = Layer.effect(
    ConnectionCredentialEncryption,
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto;
      const keyring = yield* loadConnectionEncryptionKeyring;
      const credentials = yield* ConnectionCredentialRepository;
      return convergingEncryption(credentialCipher(keyring, crypto), credentials);
    }),
  ).pipe(
    Layer.provide(ConnectionEncryptionKey.layer),
    Layer.provide(ConnectionCredentialRepository.layer),
  );

  static forKey(
    key: Layer.Layer<ConnectionEncryptionKey>,
  ): Layer.Layer<ConnectionCredentialEncryption, never, Crypto.Crypto> {
    return Layer.effect(
      ConnectionCredentialEncryption,
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const current = yield* ConnectionEncryptionKey;
        return plainEncryption(credentialCipher(keyringOf(current, []), crypto));
      }),
    ).pipe(Layer.provide(key));
  }

  static forKeyring(input: {
    readonly current: { readonly bytes: Uint8Array; readonly keyVersion: number };
    readonly retained?: ReadonlyArray<{ readonly bytes: Uint8Array; readonly keyVersion: number }>;
  }): Layer.Layer<ConnectionCredentialEncryption, Config.ConfigError, Crypto.Crypto> {
    return Layer.effect(
      ConnectionCredentialEncryption,
      Effect.gen(function* () {
        const crypto = yield* Crypto.Crypto;
        const current = yield* importConnectionEncryptionKey(
          input.current.bytes,
          input.current.keyVersion,
        );
        const retained = yield* Effect.forEach(input.retained ?? [], (entry) =>
          importConnectionEncryptionKey(entry.bytes, entry.keyVersion),
        );
        return plainEncryption(credentialCipher(keyringOf(current, retained), crypto));
      }),
    );
  }
}

function convergingEncryption(
  cipher: CredentialCipher,
  credentials: ConnectionCredentialRepository["Service"],
): ConnectionCredentialEncryptionShape {
  return {
    ...plainEncryption(cipher),
    open: (input) =>
      cipher.openEnvelope(input).pipe(
        Effect.tap((opened) =>
          opened.keyVersion === cipher.currentKeyVersion
            ? Effect.void
            : converge(cipher, credentials, input, opened),
        ),
        Effect.map((opened) => opened.plaintext),
      ),
  };
}

function converge(
  cipher: CredentialCipher,
  credentials: ConnectionCredentialRepository["Service"],
  input: OpenCredentialInput,
  opened: OpenedCredential,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const rewrapped = yield* cipher.encrypt({
      userId: input.userId,
      connectionId: input.connectionId,
      provider: input.provider,
      plaintext: opened.plaintext,
    });
    const replaced = yield* credentials.rewrap({
      userId: input.userId,
      connectionId: input.connectionId,
      previousEnvelope: input.envelope,
      rewrappedEnvelope: rewrapped,
    });
    yield* Effect.annotateCurrentSpan("connection.credential_rewrapped", replaced);
  }).pipe(
    Effect.catchTags({
      "connection.persistence_failed": () =>
        Effect.annotateCurrentSpan("connection.credential_rewrap_failed", true),
      "connection.credential_encryption_failed": () =>
        Effect.annotateCurrentSpan("connection.credential_rewrap_failed", true),
    }),
  );
}

function plainEncryption(cipher: CredentialCipher): ConnectionCredentialEncryptionShape {
  return {
    currentKeyVersion: cipher.currentKeyVersion,
    retainedKeyVersions: cipher.retainedKeyVersions,
    encrypt: cipher.encrypt,
    open: (input) => cipher.openEnvelope(input).pipe(Effect.map((opened) => opened.plaintext)),
  };
}

function credentialCipher(
  keyring: ConnectionEncryptionKeyring,
  crypto: Crypto.Crypto,
): CredentialCipher {
  const encrypt = Effect.fn("ConnectionCredentialEncryption.encrypt")(function* (
    input: SealCredentialInput,
  ) {
    const nonce = yield* crypto
      .randomBytes(credentialNonceBytes)
      .pipe(Effect.mapError(() => CredentialEncryptionFailed.make({})));
    const keyVersion = keyring.current.keyVersion;
    const ciphertext = yield* encryptBytes({
      key: keyring.current.key,
      nonce: new Uint8Array(nonce),
      aad: additionalData({ ...input, keyVersion }),
      plaintext: new TextEncoder().encode(Redacted.value(input.plaintext)),
    });
    return yield* encodeCredentialEnvelope({
      version: credentialEnvelopeVersion,
      keyVersion,
      nonce: new Uint8Array(nonce),
      ciphertext,
    }).pipe(Effect.mapError(() => CredentialEncryptionFailed.make({})));
  });

  const openEnvelope = Effect.fn("ConnectionCredentialEncryption.open")(function* (
    input: OpenCredentialInput,
  ) {
    const envelope = yield* decodeCredentialEnvelope(input.envelope).pipe(
      Effect.mapError(() => CredentialDecryptionFailed.make({})),
    );
    yield* Effect.annotateCurrentSpan("connection.credential_key_version", envelope.keyVersion);
    const key = keyring.keysByVersion.get(envelope.keyVersion);
    if (key === undefined) {
      yield* Effect.annotateCurrentSpan("connection.credential_failure", "key_version_unavailable");
      return yield* CredentialKeyVersionUnavailable.make({
        keyVersion: envelope.keyVersion,
        message: keyVersionUnavailableMessage(envelope.keyVersion),
      });
    }
    if (
      envelope.nonce.length !== credentialNonceBytes ||
      envelope.ciphertext.length < credentialAuthenticationTagBytes
    ) {
      return yield* CredentialDecryptionFailed.make({});
    }
    const plaintext = yield* decryptBytes({
      key,
      nonce: new Uint8Array(envelope.nonce),
      ciphertext: new Uint8Array(envelope.ciphertext),
      aad: additionalData({ ...input, keyVersion: envelope.keyVersion }),
    });
    return {
      plaintext: Redacted.make(new TextDecoder().decode(plaintext)),
      keyVersion: envelope.keyVersion,
    };
  });

  return {
    currentKeyVersion: keyring.current.keyVersion,
    retainedKeyVersions: keyring.retainedKeyVersions,
    encrypt,
    openEnvelope,
  };
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
      String(credentialEnvelopeVersion),
      String(input.keyVersion),
      input.userId,
      input.connectionId,
      input.provider,
    ].join("\u0000"),
  );
}

function keyVersionUnavailableMessage(keyVersion: number): string {
  return [
    `Connection credential key version ${String(keyVersion)} is not in this deployment's keyring.`,
    "Add its material to CONNECTION_ENCRYPTION_RETAINED_KEYS under that version and redeploy,",
    "or have the owner disconnect and re-link the connection.",
  ].join(" ");
}

type CredentialCipher = {
  readonly currentKeyVersion: number;
  readonly retainedKeyVersions: ReadonlyArray<number>;
  readonly encrypt: (
    input: SealCredentialInput,
  ) => Effect.Effect<string, CredentialEncryptionFailed>;
  readonly openEnvelope: (
    input: OpenCredentialInput,
  ) => Effect.Effect<OpenedCredential, CredentialOpenFailed>;
};

type OpenedCredential = {
  readonly plaintext: Redacted.Redacted<string>;
  readonly keyVersion: number;
};

type CredentialOpenFailed = CredentialDecryptionFailed | CredentialKeyVersionUnavailable;

class CredentialEncryptionFailed extends Schema.TaggedError<
  CredentialEncryptionFailed,
  { readonly brand: unique symbol }
>()("connection.credential_encryption_failed", {}) {}

class CredentialDecryptionFailed extends Schema.TaggedError<
  CredentialDecryptionFailed,
  { readonly brand: unique symbol }
>()("connection.credential_decryption_failed", {}) {}

class CredentialKeyVersionUnavailable extends Schema.TaggedError<
  CredentialKeyVersionUnavailable,
  { readonly brand: unique symbol }
>()("connection.credential_key_version_unavailable", {
  keyVersion: Schema.Int.check(Schema.isGreaterThan(0)),
  message: Schema.NonEmptyString,
}) {}
