import { EffectArray } from "@lineupkeep/collections";
import type { Cookie } from "playwright";
import { describe, expect, it } from "vitest";

import {
  hasSessionCookies,
  trustedDeviceCookieSummaries,
  trustedDeviceCookies,
} from "./trustedDevice.ts";

const cookie = (overrides: Partial<Cookie>): Cookie => ({
  name: "A1",
  value: "value",
  domain: ".yahoo.com",
  path: "/",
  expires: 1_800_000_000,
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  ...overrides,
});

describe("trusted-device cookies", () => {
  it("keeps Yahoo cookies except the session pair", () => {
    const kept = trustedDeviceCookies(
      [
        cookie({}),
        cookie({ name: "T" }),
        cookie({ name: "Y" }),
        cookie({ name: "SID", domain: ".google.com" }),
        cookie({ name: "EMPTY", value: "" }),
      ],
      "football.fantasysports.yahoo.com",
    );
    expect(EffectArray.map(kept, (entry) => entry.name)).toEqual(["A1"]);
  });

  it("summarizes names, domains, and expiry without values", () => {
    expect(
      trustedDeviceCookieSummaries([cookie({}), cookie({ name: "SESSION", expires: -1 })]),
    ).toEqual([
      { name: "A1", domain: ".yahoo.com", expiresAt: "2027-01-15T08:00:00.000Z" },
      { name: "SESSION", domain: ".yahoo.com" },
    ]);
  });

  it("requires both session cookies", () => {
    expect(hasSessionCookies([cookie({ name: "T" }), cookie({ name: "Y" })])).toBe(true);
    expect(hasSessionCookies([cookie({ name: "T" })])).toBe(false);
  });
});
