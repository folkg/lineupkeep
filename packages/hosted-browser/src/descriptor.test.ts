import { describe, expect, it } from "vitest";

import {
  signHostedBrowserDescriptor,
  verifyHostedBrowserDescriptor,
  type HostedBrowserDescriptor,
} from "./descriptor.ts";

const key = "descriptor-test-key";
const now = Date.now();

describe("hosted browser session descriptors", () => {
  it("round-trips a signed descriptor for its signer only", () => {
    const envelope = signHostedBrowserDescriptor(key, descriptor());

    expect(verifyHostedBrowserDescriptor(key, envelope, now)).toEqual(descriptor());
    expect(verifyHostedBrowserDescriptor("another-key", envelope, now)).toBeUndefined();
  });

  it("rejects a tampered payload", () => {
    const envelope = JSON.parse(signedEnvelope()) as unknown;
    if (
      typeof envelope !== "object" ||
      envelope === null ||
      !("payload" in envelope) ||
      !("signature" in envelope) ||
      typeof envelope.payload !== "string" ||
      typeof envelope.signature !== "string"
    ) {
      throw new Error("The test envelope is not a signed descriptor");
    }
    const payload = Buffer.from(envelope.payload, "base64url")
      .toString("utf8")
      .replace("login.yahoo.com", "attacker.example");
    const tampered = JSON.stringify({
      payload: Buffer.from(payload).toString("base64url"),
      signature: envelope.signature,
    });

    expect(verifyHostedBrowserDescriptor(key, tampered, now)).toBeUndefined();
  });

  it("rejects descriptors outside the bounded session lifetime", () => {
    const expired = signHostedBrowserDescriptor(key, descriptor({ expiresAt: now - 1 }));
    const overlong = signHostedBrowserDescriptor(
      key,
      descriptor({ expiresAt: now + 16 * 60 * 1_000 }),
    );

    expect(verifyHostedBrowserDescriptor(key, expired, now)).toBeUndefined();
    expect(verifyHostedBrowserDescriptor(key, overlong, now)).toBeUndefined();
  });

  it("rejects a login URL that is not an absolute HTTP destination", () => {
    const relativeLogin = signHostedBrowserDescriptor(key, descriptor({ loginUrl: "/login" }));
    const scriptLogin = signHostedBrowserDescriptor(
      key,
      descriptor({ loginUrl: "javascript:alert(1)" }),
    );

    expect(verifyHostedBrowserDescriptor(key, relativeLogin, now)).toBeUndefined();
    expect(verifyHostedBrowserDescriptor(key, scriptLogin, now)).toBeUndefined();
  });

  it("rejects something that is not a signed envelope", () => {
    expect(verifyHostedBrowserDescriptor(key, "not-json", now)).toBeUndefined();
    expect(
      verifyHostedBrowserDescriptor(key, JSON.stringify({ payload: "x" }), now),
    ).toBeUndefined();
  });
});

function descriptor(overrides: Partial<HostedBrowserDescriptor> = {}): HostedBrowserDescriptor {
  return {
    sessionId: "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2",
    expiresAt: now + 10 * 60 * 1_000,
    loginUrl: "https://login.yahoo.com/",
    ...overrides,
  };
}

function signedEnvelope(): string {
  return signHostedBrowserDescriptor(key, descriptor());
}
