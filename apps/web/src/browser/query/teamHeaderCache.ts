import { EffectArray } from "@lineupkeep/collections";
const storageKey = "lineupkeep.team-headers.v1";

export type CachedTeamHeader = {
  readonly id: string;
  readonly name: string;
  readonly sportLabel: string;
  readonly leagueName?: string;
};

export function readCachedTeamHeaders(viewerId: string): ReadonlyArray<CachedTeamHeader> {
  if (typeof localStorage === "undefined") {
    return [];
  }
  try {
    const [cachedViewer, ...lines] = (localStorage.getItem(storageKey) ?? "").split("\n");
    if (cachedViewer !== viewerId) {
      return [];
    }
    return EffectArray.flatMap(lines, (line) => {
      const header = parseHeader(line);
      return header === undefined ? [] : [header];
    });
  } catch {
    return [];
  }
}

export function clearCachedTeamHeaders(): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.removeItem(storageKey);
  } catch {
    return;
  }
}

export function storeCachedTeamHeaders(
  viewerId: string,
  teams: ReadonlyArray<CachedTeamHeader>,
): void {
  if (typeof localStorage === "undefined") {
    return;
  }
  try {
    localStorage.setItem(
      storageKey,
      EffectArray.join([viewerId, ...EffectArray.map(teams, encodeHeader)], "\n"),
    );
  } catch {
    return;
  }
}

function encodeHeader(header: CachedTeamHeader): string {
  const params = new URLSearchParams({
    id: header.id,
    name: header.name,
    sport: header.sportLabel,
  });
  if (header.leagueName !== undefined) {
    params.set("league", header.leagueName);
  }
  return params.toString();
}

function parseHeader(line: string): CachedTeamHeader | undefined {
  const params = new URLSearchParams(line);
  const id = params.get("id");
  const name = params.get("name");
  const sportLabel = params.get("sport");
  if (id === null || name === null || sportLabel === null) {
    return undefined;
  }
  const leagueName = params.get("league");
  return {
    id,
    name,
    sportLabel,
    ...(leagueName === null ? {} : { leagueName }),
  };
}
