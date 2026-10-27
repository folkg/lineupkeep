import type { ProviderKey } from "@lineupkeep/backend/connections/Connection";
import { decodeProviderKey } from "@lineupkeep/backend/connections/ProviderKey";

export type HelperProvider = {
  readonly key: ProviderKey;
  readonly label: string;
  readonly loginUrl: URL;
  readonly sessionCookies: ReadonlyArray<string>;
};

const helperProviders: ReadonlyArray<HelperProvider> = [
  {
    key: decodeProviderKey("yahoo"),
    label: "Yahoo",
    loginUrl: new URL("https://football.fantasysports.yahoo.com/"),
    sessionCookies: ["T", "Y"],
  },
];

export function helperProvider(key: string): HelperProvider | undefined {
  return helperProviders.find((provider) => provider.key === key);
}

export function helperProviderList(): string {
  return helperProviders.map((provider) => provider.key).join(", ");
}

export function helperDefaultProvider(): HelperProvider {
  const [defaultProvider] = helperProviders;
  if (defaultProvider === undefined) {
    throw new Error("The helper declares no provider.");
  }
  return defaultProvider;
}
