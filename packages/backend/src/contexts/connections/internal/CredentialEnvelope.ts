import { Effect, Schema } from "effect";

export const credentialEnvelopeVersion = 1;

export const credentialNonceBytes = 12;

export const credentialAuthenticationTagBytes = 16;

export const CredentialEnvelope = Schema.Struct({
  version: Schema.Literal(credentialEnvelopeVersion),
  keyVersion: Schema.Int.check(Schema.isGreaterThan(0)),
  nonce: Schema.Uint8ArrayFromBase64Url,
  ciphertext: Schema.Uint8ArrayFromBase64Url,
});

export type CredentialEnvelope = typeof CredentialEnvelope.Type;

export function decodeCredentialEnvelope(
  envelope: string,
): Effect.Effect<CredentialEnvelope, Schema.SchemaError> {
  return Schema.decodeEffect(Schema.fromJsonString(CredentialEnvelope))(envelope);
}

export function encodeCredentialEnvelope(
  envelope: CredentialEnvelope,
): Effect.Effect<string, Schema.SchemaError> {
  return Schema.encodeEffect(Schema.fromJsonString(CredentialEnvelope))(envelope);
}
