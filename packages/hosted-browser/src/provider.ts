export type HostedBrowserProvider = {
  readonly loginUrl: string;
  readonly refusedIdentifier?: {
    readonly text: string;
  };
  readonly staySignedIn?: {
    readonly selector: string;
  };
};

export const hostedBrowserProviders: ReadonlyMap<string, HostedBrowserProvider> = new Map([
  [
    "yahoo",
    {
      loginUrl: "https://login.yahoo.com/",
      refusedIdentifier: { text: "To use a Gmail address" },
      staySignedIn: { selector: "#persistent" },
    },
  ],
]);

export function hostedBrowserProvider(key: string): HostedBrowserProvider | undefined {
  return hostedBrowserProviders.get(key);
}
