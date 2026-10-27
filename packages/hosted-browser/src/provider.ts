export type HostedBrowserProvider = {
  readonly loginUrl: string;
  readonly allowedOrigins: ReadonlyArray<string>;
};

export const hostedBrowserProviders: ReadonlyMap<string, HostedBrowserProvider> = new Map([
  [
    "yahoo",
    {
      loginUrl: "https://login.yahoo.com/",
      allowedOrigins: [
        "https://login.yahoo.com",
        "https://www.yahoo.com",
        "https://guce.yahoo.com",
        "https://s.yimg.com",
        "https://geo.yahoo.com",
        "https://api.login.yahoo.com",
        "https://football.fantasysports.yahoo.com",
        "https://hockey.fantasysports.yahoo.com",
      ],
    },
  ],
]);

export const hostedBrowserOrigins: ReadonlyArray<string> = [
  ...new Set([...hostedBrowserProviders.values()].flatMap((provider) => provider.allowedOrigins)),
];

export function hostedBrowserProvider(key: string): HostedBrowserProvider | undefined {
  return hostedBrowserProviders.get(key);
}
