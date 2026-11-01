import { it, assert } from "@effect/vitest";

import { deviceHint } from "./DeviceHint";

it.each([
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    "Chrome on macOS",
  ],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
    "Safari on iOS",
  ],
  [
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
    "Chrome on Android",
  ],
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0",
    "Firefox on Windows",
  ],
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
    "Edge on Windows",
  ],
  [
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 OPR/126.0.0.0",
    "Opera on Linux",
  ],
  [
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
    "Chrome on ChromeOS",
  ],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "A browser on macOS"],
  ["Mozilla/5.0 (X11; Linux x86_64)", "A browser on Linux"],
  ["Chrome/141.0.0.0", "Chrome on an unknown system"],
  ["SomeAgent/1.0", "An unrecognised client"],
  ["", "An unrecognised client"],
] as const)("describes a stored client as %s", (userAgent, expected) => {
  assert.strictEqual(deviceHint(userAgent), expected);
});

it("describes a session that recorded no client", () => {
  assert.strictEqual(deviceHint(null), "An unrecognised client");
});
