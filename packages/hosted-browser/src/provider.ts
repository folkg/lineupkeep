export const providerOrigins: ReadonlyArray<string> = [
  "https://login.yahoo.com",
  "https://www.yahoo.com",
  "https://guce.yahoo.com",
  "https://s.yimg.com",
  "https://geo.yahoo.com",
  "https://api.login.yahoo.com",
  "https://football.fantasysports.yahoo.com",
  "https://hockey.fantasysports.yahoo.com",
];

export function isProviderOrigin(origin: string): boolean {
  return providerOrigins.includes(origin);
}
