import { Exit, Schema } from "effect";
import { expect, it } from "vitest";

import {
  serviceCallEvidence as encodeServiceCall,
  serviceCallName,
  isServiceCallAttachment,
  ServiceCallJson,
  type ServicePhase,
} from "#e2e/verify/serviceEvidence.ts";

it("retains a JSON result and identifies its service-call attachment", () => {
  const name = serviceCallName(1, "create a Note");

  const call = Schema.decodeUnknownSync(ServiceCallJson)(
    JSON.stringify(
      serviceCallEvidence(
        "Action",
        "create a Note",
        "trace-1",
        Exit.succeed({ title: "Saved" }),
        "",
      ),
    ),
  );

  expect(name).toBe("Service call 1: create a Note");
  expect(isServiceCallAttachment({ name })).toBe(true);
  expect(isServiceCallAttachment({ name: "MCP exchange 1: tools/call" })).toBe(false);
  expect(call).toMatchObject({
    persona: "owner",
    execution: "application",
    phase: "Action",
    description: "create a Note",
    traceId: "trace-1",
    outcome: { status: "succeeded", result: { title: "Saved" } },
  });
});

it.each([undefined, 1n, { callback: () => 1 }])(
  "explains a non-JSON result without losing the call",
  (value) => {
    const call = serviceCallEvidence("Read", "read", "trace-2", Exit.succeed(value), "");

    expect(call).toMatchObject({
      outcome: { status: "succeeded", note: "Result is not JSON-encodable." },
    });
  },
);

it.each([
  { value: { _tag: "Rejected", message: "No" }, expected: { tag: "Rejected", message: "No" } },
  { value: new Error("Unavailable"), expected: { tag: "Error", message: "Unavailable" } },
  { value: "failure", expected: { tag: "Error", message: "failure" } },
  { value: null, expected: { tag: "Error", message: "null" } },
  { value: { _tag: 1, message: false }, expected: { tag: "Error", message: "[object Object]" } },
])("preserves failure descriptions for $value", ({ value, expected }) => {
  const call = serviceCallEvidence("Action", "reject", "trace-3", Exit.fail(value), "");

  expect(call).toMatchObject({ outcome: { status: "failed", failure: expected } });
});

it("retains failure details while redacting known session values and sensitive fields", () => {
  const cookie = "better-auth.session_token=private-session";

  const failure = serviceCallEvidence(
    "Action",
    "reject",
    "trace-3",
    Exit.fail({ _tag: "Rejected", message: "private-session cannot act" }),
    cookie,
  );
  const success = serviceCallEvidence(
    "Setup",
    "arrange",
    "trace-4",
    Exit.succeed({ cookie, access_token: "secret-token", echoed: "secret-token private-session" }),
    cookie,
  );

  expect(failure).toMatchObject({
    outcome: { status: "failed", failure: { tag: "Rejected", message: "[REDACTED] cannot act" } },
  });
  expect(JSON.stringify(success)).not.toContain("secret-token");
  expect(JSON.stringify(success)).not.toContain("private-session");
});

function serviceCallEvidence(
  phase: ServicePhase,
  description: string,
  traceId: string,
  exit: Exit.Exit<unknown, unknown>,
  cookie: string,
): unknown {
  return encodeServiceCall(phase, description, traceId, exit, cookie, {
    persona: "owner",
    program: "example",
    arguments: {},
  });
}
