import { providerOrigins } from "@lineupkeep/hosted-browser/provider";

export type ProviderLoginConfig = {
  readonly loginUrl: URL;
  readonly allowedOrigins: ReadonlyArray<string>;
};

export function providerLoginConfig(
  environment: "development" | "production" | "test",
  requestUrl: string,
): ProviderLoginConfig {
  if (environment === "production") {
    return {
      loginUrl: new URL("https://login.yahoo.com/"),
      allowedOrigins: providerOrigins,
    };
  }
  const origin = new URL(requestUrl).origin;
  return {
    loginUrl: new URL("/api/dev/provider-login", origin),
    allowedOrigins: [origin],
  };
}
