import type { FantasyLeague } from "#contexts/connections/FantasyTeam.ts";

export const hockeyProfessionalTeamMap: ReadonlyArray<ProfessionalTeamMapEntry> = [
  {
    league: "nhl",
    providerTeamKey: "nhl.t.1",
    sourceIdentifier: "6",
    sourceAbbreviation: "BOS",
    displayName: "Boston Bruins",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.2",
    sourceIdentifier: "7",
    sourceAbbreviation: "BUF",
    displayName: "Buffalo Sabres",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.3",
    sourceIdentifier: "20",
    sourceAbbreviation: "CGY",
    displayName: "Calgary Flames",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.4",
    sourceIdentifier: "16",
    sourceAbbreviation: "CHI",
    displayName: "Chicago Blackhawks",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.5",
    sourceIdentifier: "17",
    sourceAbbreviation: "DET",
    displayName: "Detroit Red Wings",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.6",
    sourceIdentifier: "22",
    sourceAbbreviation: "EDM",
    displayName: "Edmonton Oilers",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.7",
    sourceIdentifier: "12",
    sourceAbbreviation: "CAR",
    displayName: "Carolina Hurricanes",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.8",
    sourceIdentifier: "26",
    sourceAbbreviation: "LAK",
    displayName: "Los Angeles Kings",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.9",
    sourceIdentifier: "25",
    sourceAbbreviation: "DAL",
    displayName: "Dallas Stars",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.10",
    sourceIdentifier: "8",
    sourceAbbreviation: "MTL",
    displayName: "Montréal Canadiens",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.11",
    sourceIdentifier: "1",
    sourceAbbreviation: "NJD",
    displayName: "New Jersey Devils",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.12",
    sourceIdentifier: "2",
    sourceAbbreviation: "NYI",
    displayName: "New York Islanders",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.13",
    sourceIdentifier: "3",
    sourceAbbreviation: "NYR",
    displayName: "New York Rangers",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.14",
    sourceIdentifier: "9",
    sourceAbbreviation: "OTT",
    displayName: "Ottawa Senators",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.15",
    sourceIdentifier: "4",
    sourceAbbreviation: "PHI",
    displayName: "Philadelphia Flyers",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.16",
    sourceIdentifier: "5",
    sourceAbbreviation: "PIT",
    displayName: "Pittsburgh Penguins",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.17",
    sourceIdentifier: "21",
    sourceAbbreviation: "COL",
    displayName: "Colorado Avalanche",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.18",
    sourceIdentifier: "28",
    sourceAbbreviation: "SJS",
    displayName: "San Jose Sharks",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.19",
    sourceIdentifier: "19",
    sourceAbbreviation: "STL",
    displayName: "St. Louis Blues",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.20",
    sourceIdentifier: "14",
    sourceAbbreviation: "TBL",
    displayName: "Tampa Bay Lightning",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.21",
    sourceIdentifier: "10",
    sourceAbbreviation: "TOR",
    displayName: "Toronto Maple Leafs",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.22",
    sourceIdentifier: "23",
    sourceAbbreviation: "VAN",
    displayName: "Vancouver Canucks",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.23",
    sourceIdentifier: "15",
    sourceAbbreviation: "WSH",
    displayName: "Washington Capitals",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.25",
    sourceIdentifier: "24",
    sourceAbbreviation: "ANA",
    displayName: "Anaheim Ducks",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.26",
    sourceIdentifier: "13",
    sourceAbbreviation: "FLA",
    displayName: "Florida Panthers",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.27",
    sourceIdentifier: "18",
    sourceAbbreviation: "NSH",
    displayName: "Nashville Predators",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.28",
    sourceIdentifier: "52",
    sourceAbbreviation: "WPG",
    displayName: "Winnipeg Jets",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.29",
    sourceIdentifier: "29",
    sourceAbbreviation: "CBJ",
    displayName: "Columbus Blue Jackets",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.30",
    sourceIdentifier: "30",
    sourceAbbreviation: "MIN",
    displayName: "Minnesota Wild",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.58",
    sourceIdentifier: "54",
    sourceAbbreviation: "VGK",
    displayName: "Vegas Golden Knights",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.59",
    sourceIdentifier: "55",
    sourceAbbreviation: "SEA",
    displayName: "Seattle Kraken",
  },
  {
    league: "nhl",
    providerTeamKey: "nhl.t.60",
    sourceIdentifier: "68",
    sourceAbbreviation: "UTA",
    displayName: "Utah Mammoth",
  },
];

export function matchProfessionalTeam(input: {
  readonly league: FantasyLeague;
  readonly identifier: string;
  readonly abbreviation: string;
  readonly name: string;
}): ProfessionalTeamMatch {
  const entry = hockeyProfessionalTeamMap.find(
    (candidate) =>
      candidate.league === input.league && candidate.sourceIdentifier === input.identifier,
  );
  if (entry === undefined) {
    return { kind: "not_mapped" };
  }
  if (entry.sourceAbbreviation !== input.abbreviation || entry.displayName !== input.name) {
    return { kind: "disagrees" };
  }
  return { kind: "mapped", providerTeamKey: entry.providerTeamKey };
}

type ProfessionalTeamMapEntry = {
  readonly league: FantasyLeague;
  readonly providerTeamKey: string;
  readonly sourceIdentifier: string;
  readonly sourceAbbreviation: string;
  readonly displayName: string;
};

export type ProfessionalTeamMatch =
  | { readonly kind: "mapped"; readonly providerTeamKey: string }
  | { readonly kind: "not_mapped" }
  | { readonly kind: "disagrees" };
