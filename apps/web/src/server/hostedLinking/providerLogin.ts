export type ProviderLoginConfig = {
  readonly loginUrl: URL;
  readonly allowedOrigins: ReadonlyArray<string>;
};

const yahooOrigins = [
  "https://login.yahoo.com",
  "https://www.yahoo.com",
  "https://guce.yahoo.com",
  "https://s.yimg.com",
  "https://geo.yahoo.com",
  "https://api.login.yahoo.com",
  "https://football.fantasysports.yahoo.com",
  "https://hockey.fantasysports.yahoo.com",
] as const;

export function providerLoginConfig(
  environment: "development" | "production" | "test",
  requestUrl: string,
): ProviderLoginConfig {
  if (environment === "production") {
    return {
      loginUrl: new URL("https://login.yahoo.com/"),
      allowedOrigins: yahooOrigins,
    };
  }
  const origin = new URL(requestUrl).origin;
  return {
    loginUrl: new URL("/api/dev/provider-login", origin),
    allowedOrigins: [origin],
  };
}
