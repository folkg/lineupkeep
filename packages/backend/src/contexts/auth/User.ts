import { Schema } from "effect";

export const UserId = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.brand("UserId"),
);
export type UserId = typeof UserId.Type;

export const decodeUserId = Schema.decodeUnknownSync(UserId);
