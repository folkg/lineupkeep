import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import type { Tracer } from "effect";
import { Context, Effect, Layer, Redacted, Schema, Tracer as EffectTracer } from "effect";

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
    const opened = yield* encryption.open({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      envelope,
    });

    assert.strictEqual(Redacted.value(opened), Redacted.value(plaintext));
    assert.notInclude(envelope, Redacted.value(plaintext));
    const decoded = yield* Schema.decodeEffect(Schema.fromJsonString(EnvelopeView))(envelope);
    assert.strictEqual(decoded.version, 1);
    assert.strictEqual(decoded.keyVersion, 1);
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

it.effect("rejects tampered ciphertext, nonce, and envelope version", () =>
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
          encryption.open({
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
      encryption.open({
        userId: other,
        connectionId,
        provider: decodeProviderKey("yahoo"),
        envelope,
      }),
    );
    const wrongConnection = yield* Effect.flip(
      encryption.open({
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

it.effect("rejects different key material under the same version", () => {
  const otherKey = ConnectionEncryptionKey.fromBytes({
    bytes: new TextEncoder().encode("0123456789abcdef0123456789abcdef"),
    keyVersion: 1,
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
      wrongKeyEncryption.open({
        userId: owner,
        connectionId,
        provider: decodeProviderKey("yahoo"),
        envelope,
      }),
    );

    assert.strictEqual(wrongKey._tag, "connection.credential_decryption_failed");
  }).pipe(Effect.provide(EncryptionTestLayer));
});

it.effect("rejects malformed envelopes", () =>
  Effect.gen(function* () {
    const encryption = yield* ConnectionCredentialEncryption;

    yield* Effect.forEach(["not-json", "{}", "null"], (envelope) =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          encryption.open({
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

it.effect("opens an envelope retained from an older key version", () => {
  const retainedKey = ConnectionEncryptionKey.fromBytes({
    bytes: retainedBytes,
    keyVersion: 1,
  });
  return Effect.gen(function* () {
    const old = Context.get(
      yield* Effect.scoped(Layer.build(EncryptionLayerFor(retainedKey))),
      ConnectionCredentialEncryption,
    );
    const envelope = yield* old.encrypt({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      plaintext: Redacted.make("retained-cookie-value"),
    });
    const encryption = yield* ConnectionCredentialEncryption;

    const opened = yield* encryption.open({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      envelope,
    });

    assert.strictEqual(Redacted.value(opened), "retained-cookie-value");
    assert.strictEqual(encryption.currentKeyVersion, 2);
    assert.deepStrictEqual(encryption.retainedKeyVersions, [1]);
  }).pipe(Effect.provide(RotatedKeyringLayer));
});

it.effect("refuses a key version the ring does not hold by name", () => {
  const spans: Array<Tracer.NativeSpan> = [];
  const tracer = EffectTracer.make({
    span(options) {
      const span = new EffectTracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  return Effect.gen(function* () {
    const encryption = yield* ConnectionCredentialEncryption;
    const envelope = yield* Schema.encodeEffect(Schema.fromJsonString(EnvelopeView))({
      version: 1,
      keyVersion: 7,
      nonce: Buffer.from(new Uint8Array(12)).toString("base64url"),
      ciphertext: Buffer.from(new Uint8Array(17)).toString("base64url"),
    });

    const error = yield* Effect.flip(
      encryption.open({
        userId: owner,
        connectionId,
        provider: decodeProviderKey("yahoo"),
        envelope,
      }),
    );

    assert.strictEqual(error._tag, "connection.credential_key_version_unavailable");
    if (error._tag !== "connection.credential_key_version_unavailable") {
      assert.fail(`expected a named key version refusal, received ${error._tag}`);
    }
    assert.strictEqual(error.keyVersion, 7);
    assert.include(error.message, "CONNECTION_ENCRYPTION_RETAINED_KEYS");
    const refusals = spans.filter(
      (span) => span.attributes.get("connection.credential_failure") === "key_version_unavailable",
    );
    assert.isNotEmpty(refusals);
    assert.strictEqual(refusals[0]?.attributes.get("connection.credential_key_version"), 7);
  }).pipe(Effect.provide(EncryptionTestLayer), Effect.withTracer(tracer));
});

it.effect("binds a retained key version as authenticated data", () => {
  const retainedKey = ConnectionEncryptionKey.fromBytes({
    bytes: retainedBytes,
    keyVersion: 1,
  });
  return Effect.gen(function* () {
    const old = Context.get(
      yield* Effect.scoped(Layer.build(EncryptionLayerFor(retainedKey))),
      ConnectionCredentialEncryption,
    );
    const envelope = yield* old.encrypt({
      userId: owner,
      connectionId,
      provider: decodeProviderKey("yahoo"),
      plaintext: Redacted.make("retained-cookie-value"),
    });
    const decoded = yield* Schema.decodeEffect(Schema.fromJsonString(EnvelopeView))(envelope);
    const moved = yield* Schema.encodeEffect(Schema.fromJsonString(EnvelopeView))({
      ...decoded,
      keyVersion: 2,
    });
    const encryption = yield* ConnectionCredentialEncryption;

    const error = yield* Effect.flip(
      encryption.open({
        userId: owner,
        connectionId,
        provider: decodeProviderKey("yahoo"),
        envelope: moved,
      }),
    );

    assert.strictEqual(error._tag, "connection.credential_decryption_failed");
  }).pipe(Effect.provide(RotatedKeyringLayer));
});

function flipFirst(value: string): string {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}

const owner = decodeUserId("owner");
const other = decodeUserId("other");
const connectionId = decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2");
const otherConnection = decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c9164a3");

const retainedBytes = new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz012345");
const currentBytes = new TextEncoder().encode("ABCDEFGHIJKLMNOPQRSTUVWXYZ987654");

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
    bytes: retainedBytes,
    keyVersion: 1,
  }),
);

const RotatedKeyringLayer = ConnectionCredentialEncryption.forKeyring({
  current: { bytes: currentBytes, keyVersion: 2 },
  retained: [{ bytes: retainedBytes, keyVersion: 1 }],
}).pipe(Layer.provide(NodeCrypto.layer));

function EncryptionLayerFor(
  key: Layer.Layer<ConnectionEncryptionKey>,
): Layer.Layer<ConnectionCredentialEncryption> {
  return ConnectionCredentialEncryption.forKey(key).pipe(Layer.provide(NodeCrypto.layer));
}
