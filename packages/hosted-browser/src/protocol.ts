export const hostedBrowserViewports = {
  desktop: { width: 1100, height: 720 },
  phone: { width: 390, height: 844 },
} as const;

export type HostedBrowserViewportProfile = keyof typeof hostedBrowserViewports;

export const maximumHostedBrowserTextLength = 2_048;

export function viewportSize(profile: HostedBrowserViewportProfile): {
  readonly width: number;
  readonly height: number;
} {
  return hostedBrowserViewports[profile];
}

export function viewportProfileForClientWidth(width: number): HostedBrowserViewportProfile {
  return width >= 768 ? "desktop" : "phone";
}

export function isHostedBrowserViewportProfile(
  value: unknown,
): value is HostedBrowserViewportProfile {
  return value === "desktop" || value === "phone";
}

export type HostedBrowserInput =
  | { readonly _tag: "Click"; readonly x: number; readonly y: number }
  | { readonly _tag: "Text"; readonly text: string }
  | { readonly _tag: "Key"; readonly key: HostedBrowserKey }
  | { readonly _tag: "Scroll"; readonly deltaY: number };

export type HostedBrowserKey =
  | "Enter"
  | "Tab"
  | "Backspace"
  | "Delete"
  | "Escape"
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown";

export type HostedBrowserStatus = "starting" | "loading" | "waiting" | "two-factor" | "blocked";

export type HostedBrowserRefusalReason =
  | "non_public_address"
  | "unresolvable"
  | "invalid_destination";

export type HostedBrowserRefusal = {
  readonly host: string;
  readonly reason: HostedBrowserRefusalReason;
};

export type HostedBrowserFailure =
  | "browser_unavailable"
  | "page_unavailable"
  | "provider_unavailable"
  | "session_rejected"
  | "completion_failed"
  | "expired";

export type HostedBrowserMessage =
  | { readonly _tag: "Status"; readonly status: HostedBrowserStatus }
  | { readonly _tag: "AcceptsInput" }
  | { readonly _tag: "Refused"; readonly host: string; readonly reason: HostedBrowserRefusalReason }
  | { readonly _tag: "Ready"; readonly connectionId: string; readonly teamsDiscovered: number }
  | { readonly _tag: "Failed"; readonly reason: HostedBrowserFailure }
  | { readonly _tag: "Expired" };

export type HostedBrowserTransportMessage =
  | { readonly _tag: "Status"; readonly status: HostedBrowserStatus }
  | { readonly _tag: "AcceptsInput" }
  | { readonly _tag: "Refused"; readonly host: string; readonly reason: HostedBrowserRefusalReason }
  | { readonly _tag: "Captured"; readonly session: string }
  | { readonly _tag: "Failed"; readonly reason: HostedBrowserFailure }
  | { readonly _tag: "Expired" };

export function encodeHostedBrowserInput(input: HostedBrowserInput): string {
  return JSON.stringify(input);
}

export function parseHostedBrowserInput(value: string): HostedBrowserInput | undefined {
  const decoded = parseJson(value);
  if (!isRecord(decoded) || typeof decoded["_tag"] !== "string") {
    return undefined;
  }
  switch (decoded["_tag"]) {
    case "Click": {
      const x = decoded["x"];
      const y = decoded["y"];
      return isUnit(x) && isUnit(y) ? { _tag: "Click", x, y } : undefined;
    }
    case "Text": {
      const text = decoded["text"];
      return typeof text === "string" &&
        text.length >= 1 &&
        text.length <= maximumHostedBrowserTextLength
        ? { _tag: "Text", text }
        : undefined;
    }
    case "Key": {
      const key = decoded["key"];
      return isHostedBrowserKey(key) ? { _tag: "Key", key } : undefined;
    }
    case "Scroll": {
      const deltaY = decoded["deltaY"];
      return typeof deltaY === "number" && deltaY >= -2_000 && deltaY <= 2_000
        ? { _tag: "Scroll", deltaY }
        : undefined;
    }
    default:
      return undefined;
  }
}

export function encodeHostedBrowserMessage(message: HostedBrowserMessage): string {
  return JSON.stringify(message);
}

export function parseHostedBrowserMessage(value: string): HostedBrowserMessage | undefined {
  const decoded = parseJson(value);
  if (!isRecord(decoded) || typeof decoded["_tag"] !== "string") {
    return undefined;
  }
  switch (decoded["_tag"]) {
    case "Status":
      return isHostedBrowserStatus(decoded["status"])
        ? { _tag: "Status", status: decoded["status"] }
        : undefined;
    case "AcceptsInput":
      return { _tag: "AcceptsInput" };
    case "Refused": {
      const host = decoded["host"];
      const reason = decoded["reason"];
      return typeof host === "string" &&
        host.length >= 1 &&
        host.length <= 253 &&
        isHostedBrowserRefusalReason(reason)
        ? { _tag: "Refused", host, reason }
        : undefined;
    }
    case "Ready": {
      const connectionId = decoded["connectionId"];
      const teamsDiscovered = decoded["teamsDiscovered"];
      return typeof connectionId === "string" &&
        typeof teamsDiscovered === "number" &&
        Number.isInteger(teamsDiscovered) &&
        teamsDiscovered >= 0
        ? { _tag: "Ready", connectionId, teamsDiscovered }
        : undefined;
    }
    case "Failed":
      return isHostedBrowserFailure(decoded["reason"])
        ? { _tag: "Failed", reason: decoded["reason"] }
        : undefined;
    case "Expired":
      return { _tag: "Expired" };
    default:
      return undefined;
  }
}

export function encodeTransportMessage(message: HostedBrowserTransportMessage): string {
  return JSON.stringify(message);
}

export function parseTransportMessage(value: string): HostedBrowserTransportMessage | undefined {
  const decoded = parseJson(value);
  if (!isRecord(decoded) || typeof decoded["_tag"] !== "string") {
    return undefined;
  }
  switch (decoded["_tag"]) {
    case "Status":
      return isHostedBrowserStatus(decoded["status"])
        ? { _tag: "Status", status: decoded["status"] }
        : undefined;
    case "AcceptsInput":
      return { _tag: "AcceptsInput" };
    case "Refused": {
      const host = decoded["host"];
      const reason = decoded["reason"];
      return typeof host === "string" &&
        host.length >= 1 &&
        host.length <= 253 &&
        isHostedBrowserRefusalReason(reason)
        ? { _tag: "Refused", host, reason }
        : undefined;
    }
    case "Captured": {
      const session = decoded["session"];
      return typeof session === "string" && session.length >= 1 && session.length <= 8_192
        ? { _tag: "Captured", session }
        : undefined;
    }
    case "Failed":
      return isHostedBrowserFailure(decoded["reason"])
        ? { _tag: "Failed", reason: decoded["reason"] }
        : undefined;
    case "Expired":
      return { _tag: "Expired" };
    default:
      return undefined;
  }
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isUnit(value: unknown): value is number {
  return typeof value === "number" && value >= 0 && value <= 1;
}

function isHostedBrowserKey(value: unknown): value is HostedBrowserKey {
  return (
    value === "Enter" ||
    value === "Tab" ||
    value === "Backspace" ||
    value === "Delete" ||
    value === "Escape" ||
    value === "ArrowUp" ||
    value === "ArrowDown" ||
    value === "ArrowLeft" ||
    value === "ArrowRight" ||
    value === "Home" ||
    value === "End" ||
    value === "PageUp" ||
    value === "PageDown"
  );
}

function isHostedBrowserRefusalReason(value: unknown): value is HostedBrowserRefusalReason {
  return (
    value === "non_public_address" || value === "unresolvable" || value === "invalid_destination"
  );
}

function isHostedBrowserStatus(value: unknown): value is HostedBrowserStatus {
  return (
    value === "starting" ||
    value === "loading" ||
    value === "waiting" ||
    value === "two-factor" ||
    value === "blocked"
  );
}

function isHostedBrowserFailure(value: unknown): value is HostedBrowserFailure {
  return (
    value === "browser_unavailable" ||
    value === "page_unavailable" ||
    value === "provider_unavailable" ||
    value === "session_rejected" ||
    value === "completion_failed" ||
    value === "expired"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
