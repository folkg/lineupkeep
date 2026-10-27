import { Schema } from "effect";

export const ProviderKey = Schema.NonEmptyString.pipe(
  Schema.check(Schema.isPattern(/^[a-z][a-z0-9]{1,23}$/u), Schema.isMaxLength(24)),
  Schema.brand("ProviderKey"),
);
export type ProviderKey = typeof ProviderKey.Type;

export const decodeProviderKey = Schema.decodeUnknownSync(ProviderKey);
