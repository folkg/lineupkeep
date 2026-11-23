import { assert, it } from "@effect/vitest";

import { canonicalHostRedirect } from "./canonicalHost.ts";

const canonical = "https://lineupgrade.example.test";

it("moves an old Cloud Run address to the current address", () => {
  const response = canonicalHostRedirect(
    new Request("https://old-service-hash-ue.a.run.app/teams?view=all"),
    canonical,
  );

  assert.instanceOf(response, Response);
  assert.isDefined(response);
  assert.strictEqual(response.status, 308);
  assert.strictEqual(
    response.headers.get("location"),
    "https://lineupgrade.example.test/teams?view=all",
  );
});

it("leaves the current address and local requests alone", () => {
  assert.isUndefined(
    canonicalHostRedirect(new Request("https://lineupgrade.example.test/teams"), canonical),
  );
  assert.isUndefined(
    canonicalHostRedirect(new Request("http://lineupgrade.example.test/teams"), canonical),
  );
  assert.isUndefined(canonicalHostRedirect(new Request("http://127.0.0.1:3000/teams"), canonical));
});

it("does not redirect the health check", () => {
  assert.isUndefined(
    canonicalHostRedirect(new Request("https://old-service-hash-ue.a.run.app/healthz"), canonical),
  );
});
