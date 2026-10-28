import { hostedBrowserProvider } from "@lineupkeep/hosted-browser/provider";

export type ProviderLoginConfig = {
  readonly loginUrl: URL;
  readonly fixtureOrigin?: string;
};

export function providerLoginConfig(
  environment: "development" | "production" | "test",
  requestUrl: string,
  providerKey: string,
): ProviderLoginConfig {
  const provider = hostedBrowserProvider(providerKey);
  if (environment === "production") {
    if (provider === undefined) {
      throw new Error(`No hosted browser login is configured for provider "${providerKey}"`);
    }
    return {
      loginUrl: new URL(provider.loginUrl),
    };
  }
  const origin = new URL(requestUrl).origin;
  return {
    loginUrl: new URL("/api/dev/provider-login", origin),
    fixtureOrigin: origin,
  };
}
