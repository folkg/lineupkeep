import { EffectArray, EffectString } from "@lineupkeep/collections";
import type { Cookie } from "playwright";

export type TrustedDeviceCookieSummary = {
  readonly name: string;
  readonly domain: string;
  readonly expiresAt?: string;
};

export type TrustedDeviceProbeResult = {
  readonly cookieSummaries: ReadonlyArray<TrustedDeviceCookieSummary>;
  readonly signedIn: boolean;
  readonly issuedSession: boolean;
  readonly error?: "probe_failed";
};

export function trustedDeviceCookies(
  cookies: ReadonlyArray<Cookie>,
  host: string,
): ReadonlyArray<Cookie> {
  return EffectArray.filter(
    cookies,
    (cookie) =>
      cookieMatchesHost(cookie.domain, host) &&
      cookie.name !== "T" &&
      cookie.name !== "Y" &&
      cookie.value !== "",
  );
}

function cookieMatchesHost(domain: string, host: string): boolean {
  const normalized = EffectString.startsWith(domain, ".") ? EffectString.slice(domain, 1) : domain;
  return host === normalized || EffectString.endsWith(host, `.${normalized}`);
}

export function trustedDeviceCookieSummaries(
  cookies: ReadonlyArray<Cookie>,
): ReadonlyArray<TrustedDeviceCookieSummary> {
  return EffectArray.map(cookies, (cookie) => ({
    name: cookie.name,
    domain: cookie.domain,
    ...(cookie.expires <= 0 ? {} : { expiresAt: new Date(cookie.expires * 1_000).toISOString() }),
  }));
}

export function hasSessionCookies(cookies: ReadonlyArray<Cookie>): boolean {
  return (
    EffectArray.some(cookies, (cookie) => cookie.name === "T" && cookie.value !== "") &&
    EffectArray.some(cookies, (cookie) => cookie.name === "Y" && cookie.value !== "")
  );
}
