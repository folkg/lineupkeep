import { expect, it } from "vitest";

import { redactEvidence } from "#e2e/verify/redaction.ts";

it("redacts OAuth credentials, cookies and echoed secrets without losing tool evidence", () => {
  const exchange = {
    method: "POST",
    url: "https://app.test/token?code=authorization-secret",
    request: {
      headers: {
        Authorization: "Bearer bearer-secret",
        Cookie: "session=cookie-secret",
        DPoP: "proof-secret",
      },
      body: "code_verifier=verifier-secret&refresh_token=refresh-secret&client_secret=form-client-secret",
    },
    response: {
      headers: { "set-cookie": "session=another-secret" },
      body: {
        access_token: "access-secret",
        client_secret: "client-secret",
        echoedProof: "proof-secret",
        refresh_token: "refresh-secret",
        echo: "Bearer bearer-secret",
        echoCookie: "cookie-secret",
        echoSetCookie: "another-secret",
        nested: { code: "authorization-secret" },
      },
    },
    tool: "create_note",
    arguments: { title: "Retained title" },
  };

  const result = JSON.stringify(redactEvidence(exchange));

  for (const secret of [
    "authorization-secret",
    "bearer-secret",
    "cookie-secret",
    "verifier-secret",
    "refresh-secret",
    "another-secret",
    "access-secret",
    "client-secret",
    "form-client-secret",
    "proof-secret",
  ]) {
    expect(result).not.toContain(secret);
  }
  expect(result).toContain("Retained title");
  expect(result).toContain("create_note");
});
