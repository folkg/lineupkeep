export type HostedBrowserProvider = {
  readonly loginUrl: string;
};

export const hostedBrowserProviders: ReadonlyMap<string, HostedBrowserProvider> = new Map([
  ["yahoo", { loginUrl: "https://login.yahoo.com/" }],
]);

export function hostedBrowserProvider(key: string): HostedBrowserProvider | undefined {
  return hostedBrowserProviders.get(key);
}
