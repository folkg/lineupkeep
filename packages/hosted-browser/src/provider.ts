export type HostedBrowserProvider = {
  readonly loginUrl: string;
  readonly refusedIdentifier?: {
    readonly text: string;
  };
};

export const hostedBrowserProviders: ReadonlyMap<string, HostedBrowserProvider> = new Map([
  [
    "yahoo",
    {
      loginUrl: "https://login.yahoo.com/",
      refusedIdentifier: { text: "To use a Gmail address" },
    },
  ],
]);

export function hostedBrowserProvider(key: string): HostedBrowserProvider | undefined {
  return hostedBrowserProviders.get(key);
}
