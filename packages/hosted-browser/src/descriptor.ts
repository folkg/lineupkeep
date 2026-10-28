import { createHmac, timingSafeEqual } from "node:crypto";

export type HostedBrowserDescriptor = {
  readonly sessionId: string;
  readonly expiresAt: number;
  readonly loginUrl: string;
};

const maximumDescriptorLifetimeMillis = 15 * 60 * 1_000;

export function signHostedBrowserDescriptor(
  key: string,
  descriptor: HostedBrowserDescriptor,
): string {
  const payload = Buffer.from(JSON.stringify(descriptor), "utf8").toString("base64url");
  return JSON.stringify({ payload, signature: signature(key, payload) });
}

export function verifyHostedBrowserDescriptor(
  key: string,
  envelope: string,
  now: number,
): HostedBrowserDescriptor | undefined {
  const decoded = parseJson(envelope);
  if (!isRecord(decoded)) {
    return undefined;
  }
  const payload = decoded["payload"];
  const provided = decoded["signature"];
  if (typeof payload !== "string" || typeof provided !== "string") {
    return undefined;
  }
  if (!signaturesMatch(signature(key, payload), provided)) {
    return undefined;
  }
  const descriptor = decodeDescriptor(Buffer.from(payload, "base64url").toString("utf8"));
  if (descriptor === undefined) {
    return undefined;
  }
  const remaining = descriptor.expiresAt - now;
  if (remaining <= 0 || remaining > maximumDescriptorLifetimeMillis) {
    return undefined;
  }
  return descriptor;
}

function decodeDescriptor(payload: string): HostedBrowserDescriptor | undefined {
  const decoded = parseJson(payload);
  if (!isRecord(decoded)) {
    return undefined;
  }
  const sessionId = decoded["sessionId"];
  const expiresAt = decoded["expiresAt"];
  const loginUrl = decoded["loginUrl"];
  if (typeof sessionId !== "string" || sessionId.length < 1 || sessionId.length > 100) {
    return undefined;
  }
  if (typeof expiresAt !== "number" || !Number.isSafeInteger(expiresAt)) {
    return undefined;
  }
  if (typeof loginUrl !== "string" || !isHttpUrl(loginUrl)) {
    return undefined;
  }
  return { sessionId, expiresAt, loginUrl };
}

function isHttpUrl(value: string): boolean {
  const url = parseUrl(value);
  return url !== undefined && (url.protocol === "https:" || url.protocol === "http:");
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

function signature(key: string, payload: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

function signaturesMatch(expected: string, provided: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  return (
    expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes)
  );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
