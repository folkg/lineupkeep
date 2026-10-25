import { Schema } from "effect";
import { expect, it } from "vitest";

import { ConsentRequestInput, ConsentDecisionInput } from "./authServer.ts";

it.each([{ query: 42 }, { query: "" }, { query: "x".repeat(16_385) }])(
  "rejects a malformed consent lookup: %j",
  (input) => {
    expect(Schema.decodeUnknownResult(ConsentRequestInput)(input)._tag).toBe("Failure");
  },
);

it.each([{ query: "signed", accept: "true" }, { query: "signed" }, { query: "", accept: false }])(
  "rejects a malformed consent decision: %j",
  (input) => {
    expect(Schema.decodeUnknownResult(ConsentDecisionInput)(input)._tag).toBe("Failure");
  },
);

it("preserves signed repeated parameters and encoded bytes in both consent inputs", () => {
  const query =
    "oauth_query=scope%3Dnotes%253Aread%26scope%3Doffline_access&sig=a%2Bb+%20&scope=x&scope=y";

  expect(Schema.decodeSync(ConsentRequestInput)({ query })).toEqual({ query });
  expect(Schema.decodeSync(ConsentDecisionInput)({ query, accept: true })).toEqual({
    query,
    accept: true,
  });
});
