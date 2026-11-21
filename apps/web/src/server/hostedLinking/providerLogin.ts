import { hostedBrowserProvider } from "@lineupkeep/hosted-browser/provider";
import { dual } from "effect/Function";

export type ProviderLoginConfig = {
  readonly loginUrl: URL;
  readonly fixtureOrigin?: string;
};

export const providerLoginConfig: {
  (
    requestUrl: string,
    providerKey: string,
  ): (environment: "development" | "production" | "test") => ProviderLoginConfig;
  (
    environment: "development" | "production" | "test",
    requestUrl: string,
    providerKey: string,
  ): ProviderLoginConfig;
} = dual(
  3,
  (
    environment: "development" | "production" | "test",
    requestUrl: string,
    providerKey: string,
  ): ProviderLoginConfig => {
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
  },
);
