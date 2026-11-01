const browsers: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEdg(?:iOS|A)?\//u, "Edge"],
  [/\bOPR\//u, "Opera"],
  [/\bFxiOS\//u, "Firefox"],
  [/\bFirefox\//u, "Firefox"],
  [/\bCriOS\//u, "Chrome"],
  [/\bChrome\//u, "Chrome"],
  [/\bSafari\//u, "Safari"],
];

const systems: ReadonlyArray<readonly [RegExp, string]> = [
  [/\biPhone\b|\biPad\b|\biPod\b/u, "iOS"],
  [/\bAndroid\b/u, "Android"],
  [/\bCrOS\b/u, "ChromeOS"],
  [/\bWindows NT\b/u, "Windows"],
  [/\bMacintosh\b|\bMac OS X\b/u, "macOS"],
  [/\bLinux\b/u, "Linux"],
];

export function deviceHint(userAgent: string | null): string {
  if (userAgent === null || userAgent.trim() === "") {
    return unknownClient;
  }
  const browser = match(browsers, userAgent);
  const system = match(systems, userAgent);
  if (browser === undefined && system === undefined) {
    return unknownClient;
  }
  if (system === undefined) {
    return `${browser} on an unknown system`;
  }
  return `${browser ?? "A browser"} on ${system}`;
}

function match(
  candidates: ReadonlyArray<readonly [RegExp, string]>,
  userAgent: string,
): string | undefined {
  return candidates.find(([pattern]) => pattern.test(userAgent))?.[1];
}

const unknownClient = "An unrecognised client";
