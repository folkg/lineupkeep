import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { Context, Effect, Layer, Redacted, Schema } from "effect";

import { decodeUserId } from "#contexts/auth/User.ts";
import { decodeConnectionId } from "#contexts/connections/Connection.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./ConnectionEncryptionKey.ts";

it.effect("round-trips a provider session through a versioned AES-GCM envelope", () =>
  Effect.gen(function* () {
    const encryption = yield* ConnectionCredentialEncryption;
    const plaintext = Redacted.make("A1=canary-cookie-value; A3=another-cookie-value");

    const envelope = yield* encryption.encrypt({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      plaintext,
    });
    const decrypted = yield* encryption.decrypt({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      envelope,
    });

    assert.strictEqual(Redacted.value(decrypted), Redacted.value(plaintext));
    assert.notInclude(envelope, Redacted.value(plaintext));
    const decoded = yield* Schema.decodeEffect(Schema.fromJsonString(EnvelopeView))(envelope);
    assert.strictEqual(decoded.version, 1);
  }).pipe(Effect.provide(EncryptionTestLayer)),
);

it.effect("uses a unique nonce for every encryption", () =>
  Effect.gen(function* () {
    const encryption = yield* ConnectionCredentialEncryption;
    const plaintext = Redacted.make("same-provider-session");

    const first = yield* encryption.encrypt({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      plaintext,
    });
    const second = yield* encryption.encrypt({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      plaintext,
    });
    const firstEnvelope = yield* Schema.decodeEffect(Schema.fromJsonString(EnvelopeView))(first);
    const secondEnvelope = yield* Schema.decodeEffect(Schema.fromJsonString(EnvelopeView))(second);

    assert.notStrictEqual(firstEnvelope.nonce, secondEnvelope.nonce);
    assert.notStrictEqual(firstEnvelope.ciphertext, secondEnvelope.ciphertext);
  }).pipe(Effect.provide(EncryptionTestLayer)),
);

it.effect("rejects tampered ciphertext, nonce, key version, and envelope version", () =>
  Effect.gen(function* () {
    const encryption = yield* ConnectionCredentialEncryption;
    const envelope = yield* encryption.encrypt({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      plaintext: Redacted.make("canary-cookie-value"),
    });
    const decoded = yield* Schema.decodeEffect(Schema.fromJsonString(EnvelopeView))(envelope);

    const tampered = [
      yield* Schema.encodeEffect(Schema.fromJsonString(EnvelopeView))({
        ...decoded,
        ciphertext: flipFirst(decoded.ciphertext),
      }),
      yield* Schema.encodeEffect(Schema.fromJsonString(EnvelopeView))({
        ...decoded,
        nonce: flipFirst(decoded.nonce),
      }),
      yield* Schema.encodeEffect(Schema.fromJsonString(EnvelopeView))({
        ...decoded,
        keyVersion: 2,
      }),
      yield* Schema.encodeEffect(Schema.fromJsonString(TamperVersionView))({
        version: 2,
        keyVersion: decoded.keyVersion,
        nonce: decoded.nonce,
        ciphertext: decoded.ciphertext,
      }),
    ];

    yield* Effect.forEach(tampered, (value) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          encryption.decrypt({
            userId: owner,
            connectionId,
            provider: decodeProviderKey("yahoo"),
            envelope: value,
          }),
        );
        assert.strictEqual(error._tag, "connection.credential_decryption_failed");
        assert.notInclude(String(error), "canary-cookie-value");
      }),
    );
  }).pipe(Effect.provide(EncryptionTestLayer)),
);

it.effect("rejects cross-owner and cross-connection decryption", () =>
  Effect.gen(function* () {
    const encryption = yield* ConnectionCredentialEncryption;
    const envelope = yield* encryption.encrypt({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      plaintext: Redacted.make("canary-cookie-value"),
    });

    const wrongOwner = yield* Effect.flip(
      encryption.decrypt({
        userId: other,
        connectionId,
        provider: decodeProviderKey("yahoo"),
        envelope,
      }),
    );
    const wrongConnection = yield* Effect.flip(
      encryption.decrypt({
        userId: owner,
        connectionId: otherConnection,
        provider: decodeProviderKey("yahoo"),
        envelope,
      }),
    );

    assert.strictEqual(wrongOwner._tag, "connection.credential_decryption_failed");
    assert.strictEqual(wrongConnection._tag, "connection.credential_decryption_failed");
  }).pipe(Effect.provide(EncryptionTestLayer)),
);

it.effect("rejects a different key and a different key version", () => {
  const otherKey = ConnectionEncryptionKey.fromBytes({
    bytes: new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
    keyVersion: 1,
  });
  const otherVersion = ConnectionEncryptionKey.fromBytes({
    bytes: new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
    keyVersion: 2,
  });
  return Effect.gen(function* () {
    const encryption = yield* ConnectionCredentialEncryption;
    const envelope = yield* encryption.encrypt({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      plaintext: Redacted.make("canary-cookie-value"),
    });
    const wrongKeyContext = yield* Effect.scoped(Layer.build(EncryptionLayerFor(otherKey)));
    const wrongKeyEncryption = Context.get(wrongKeyContext, ConnectionCredentialEncryption);
    const wrongKey = yield* Effect.flip(
      wrongKeyEncryption.decrypt({
        userId: owner,
        connectionId,
        provider: decodeProviderKey("yahoo"),
        envelope,
      }),
    );
    const wrongVersionContext = yield* Effect.scoped(Layer.build(EncryptionLayerFor(otherVersion)));
    const wrongVersionEncryption = Context.get(wrongVersionContext, ConnectionCredentialEncryption);
    const wrongVersion = yield* Effect.flip(
      wrongVersionEncryption.decrypt({
        userId: owner,
        connectionId,
        provider: decodeProviderKey("yahoo"),
        envelope,
      }),
    );

    assert.strictEqual(wrongKey._tag, "connection.credential_decryption_failed");
    assert.strictEqual(wrongVersion._tag, "connection.credential_decryption_failed");
  }).pipe(Effect.provide(EncryptionTestLayer));
});

it.effect("rejects malformed envelopes", () =>
  Effect.gen(function* () {
    const encryption = yield* ConnectionCredentialEncryption;

    yield* Effect.forEach(["not-json", "{}", "null"], (envelope) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          encryption.decrypt({
            userId: owner,
            connectionId,
            provider: decodeProviderKey("yahoo"),
            envelope,
          }),
        );
        assert.strictEqual(error._tag, "connection.credential_decryption_failed");
      }),
    );
  }).pipe(Effect.provide(EncryptionTestLayer)),
);

function flipFirst(value: string): string {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}

const owner = decodeUserId("owner");
const other = decodeUserId("other");
const connectionId = decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2");
const otherConnection = decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a3");

const EnvelopeView = Schema.Struct({
  version: Schema.Literal(1),
  keyVersion: Schema.Int,
  nonce: Schema.String,
  ciphertext: Schema.String,
});

const TamperVersionView = Schema.Struct({
  version: Schema.Int,
  keyVersion: Schema.Int,
  nonce: Schema.String,
  ciphertext: Schema.String,
});

const EncryptionTestLayer = EncryptionLayerFor(
  ConnectionEncryptionKey.fromBytes({
    bytes: new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz012345"),
    keyVersion: 1,
  }),
);

function EncryptionLayerFor(
  key: Layer.Layer<ConnectionEncryptionKey>,
): Layer.Layer<ConnectionCredentialEncryption> {
  return ConnectionCredentialEncryption.forKey(key).pipe(Layer.provide(NodeCrypto.layer));
}
