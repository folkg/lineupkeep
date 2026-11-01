import type { FantasyLeague, FantasySport } from "@lineupkeep/backend/connections/FantasyTeam";

const sportNames: Readonly<Record<FantasySport, string>> = {
  baseball: "Baseball",
  basketball: "Basketball",
  football: "Football",
  hockey: "Hockey",
};

const leagueNames: Readonly<Record<FantasyLeague, string>> = {
  mlb: "MLB",
  nba: "NBA",
  nfl: "NFL",
  nhl: "NHL",
};

export function sportDisplayName(sport: FantasySport): string {
  return sportNames[sport];
}

export function leagueDisplayName(league: FantasyLeague): string {
  return leagueNames[league];
}
