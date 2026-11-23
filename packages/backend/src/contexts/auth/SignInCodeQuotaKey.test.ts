import { assert, it } from "@effect/vitest";

import { signInCodeOriginAllowed } from "./SignInCodeQuotaKey.ts";

it("spends the address limit only for the current origin or a request without one", () => {
  assert.isTrue(signInCodeOriginAllowed(null, "https://lineupgrade.example.test"));
  assert.isTrue(
    signInCodeOriginAllowed("https://lineupgrade.example.test", "https://lineupgrade.example.test"),
  );
  assert.isFalse(
    signInCodeOriginAllowed("https://old-service.a.run.app", "https://lineupgrade.example.test"),
  );
});
