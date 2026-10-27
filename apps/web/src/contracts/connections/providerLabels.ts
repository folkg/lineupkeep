const providerNames: ReadonlyMap<string, string> = new Map([["yahoo", "Yahoo"]]);

export const defaultProviderKey = "yahoo";

export function providerDisplayName(provider: string): string {
  const name = providerNames.get(provider);
  return name ?? provider;
}

export function defaultProviderName(): string {
  return providerDisplayName(defaultProviderKey);
}
