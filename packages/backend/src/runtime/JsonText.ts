import { Effect, Schema } from "effect";

const jsonSchema = Schema.fromJsonString(Schema.Unknown);

const jsonString = (value: unknown, _replacer?: unknown, _space?: unknown): string =>
  Effect.runSync(Schema.encodeEffect(jsonSchema)(value));

const jsonValue = (text: string): unknown => Effect.runSync(Schema.decodeEffect(jsonSchema)(text));

export default { jsonString, jsonValue };
