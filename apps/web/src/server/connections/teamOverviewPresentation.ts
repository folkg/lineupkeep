import type { TeamSummaryResult } from "@lineupkeep/backend/connections/QueryResults";
import { EffectArray } from "@lineupkeep/collections";

import type { TeamOverviewView } from "#contracts/connections/teamContract.ts";

export function seasonFactsUnavailableReason(
  status: "linking" | "ready" | "reconnect-required" | "disconnected" | "missing",
): string {
  switch (status) {
    case "reconnect-required":
      return "Reconnect this league to load season facts.";
    case "linking":
      return "Season facts appear after the connection finishes setting up.";
    case "disconnected":
      return "Connect this league again to load season facts.";
    case "missing":
      return "Season facts are unavailable because the connection is missing.";
    case "ready":
      return "Season facts could not be loaded.";
  }
}

export function toTeamOverviewView(summary: TeamSummaryResult): TeamOverviewView {
  if (summary.status === "narrowing_required") {
    return { reason: "The season overview is too large to display." };
  }
  const league = summary.league;
  const standing = summary.standing;
  const record = summary.record;
  const matchup = summary.matchup;
  const categories = summary.categoryPoints;
  const totals = summary.categoryTotals;
  const usage = summary.acquisitionUsage;
  const totalsByStat = new Map(
    EffectArray.map(
      totals?.status === "available" ? totals.values : [],
      (entry) => [entry.stat, entry.value] as const,
    ),
  );
  return {
    ...(summary.standings?.status === "available" ? { format: summary.standings.format } : {}),
    ...(league?.status === "available"
      ? {
          league: {
            teamCount: league.teamCount,
            scoringType: league.scoringType,
            ...(league.scoringLabel === undefined ? {} : { scoringLabel: league.scoringLabel }),
            ...(league.transactionTiming.weeklyDeadline === undefined
              ? {}
              : { weeklyDeadline: league.transactionTiming.weeklyDeadline }),
            ...(league.startDate === undefined ? {} : { startDate: league.startDate }),
            ...(league.endDate === undefined ? {} : { endDate: league.endDate }),
            gamesCaps: {
              ...(league.gamesCaps.gamesPlayed.status === "published" &&
              league.gamesCaps.gamesPlayed.value > 0
                ? { gamesPlayed: league.gamesCaps.gamesPlayed.value }
                : {}),
              ...(league.gamesCaps.inningsPitched.status === "published" &&
              league.gamesCaps.inningsPitched.value > 0
                ? { inningsPitched: league.gamesCaps.inningsPitched.value }
                : {}),
            },
          },
        }
      : { leagueReason: league?.detail ?? "League settings were not published." }),
    ...(summary.seasonProgress === undefined
      ? {}
      : {
          seasonProgress: {
            ...(summary.seasonProgress.currentPeriod === undefined
              ? {}
              : { currentPeriod: summary.seasonProgress.currentPeriod }),
            ...(summary.seasonProgress.lastPeriod === undefined
              ? {}
              : { lastPeriod: summary.seasonProgress.lastPeriod }),
            ...(summary.seasonProgress.endDate === undefined
              ? {}
              : { endDate: summary.seasonProgress.endDate }),
          },
        }),
    ...(standing?.status === "available"
      ? {
          standing: {
            rank: standing.rank,
            points: standing.points,
            pointsFor: standing.pointsFor,
            pointsAgainst: standing.pointsAgainst,
            pointsBack: standing.pointsBack,
          },
        }
      : { standingReason: standing?.detail ?? "Standings were not published." }),
    ...(record?.status === "available"
      ? {
          record: {
            wins: record.wins,
            losses: record.losses,
            ties: record.ties,
            percentage: record.percentage,
          },
        }
      : { recordReason: record?.detail ?? "Record not published." }),
    ...(matchup?.status === "available"
      ? {
          matchup: {
            week: matchup.period.week,
            opponent: matchup.opponent.name,
            points: matchup.points,
            opponentPoints: matchup.opponentPoints,
            projectedPoints: matchup.projectedPoints,
            opponentProjectedPoints: matchup.opponentProjectedPoints,
            ...(matchup.remainingGames === undefined
              ? {}
              : { remainingGames: matchup.remainingGames.remaining }),
            ...(matchup.opponentRemainingGames === undefined
              ? {}
              : { opponentRemainingGames: matchup.opponentRemainingGames.remaining }),
            ...(matchup.statusLabel === undefined ? {} : { statusLabel: matchup.statusLabel }),
            categories: EffectArray.map(matchup.categories ?? [], (row) => ({
              name: row.name,
              scoring: row.scoring,
              own: row.own,
              opponent: row.opponent,
            })),
          },
        }
      : { matchupReason: matchup?.detail ?? "No current matchup was published." }),
    ...(categories?.status === "available"
      ? {
          categoryPoints: EffectArray.map(categories.values, (row) => ({
            name: row.name,
            scoring: row.scoring,
            value: row.value,
            total: totalsByStat.get(row.stat) ?? null,
            place: row.place ?? null,
          })),
        }
      : { categoryReason: categories?.detail ?? "Season category points were not published." }),
    ...(usage?.status === "available"
      ? {
          gamesUsage:
            usage.gamesPlayedUsage.status === "available"
              ? {
                  status: "available" as const,
                  games: EffectArray.map(usage.gamesPlayedUsage.games, (game) => ({
                    position: game.position,
                    played: game.played,
                    projected: game.projected,
                  })),
                  ...(usage.gamesPlayedUsage.innings === undefined
                    ? {}
                    : {
                        innings: {
                          pitched: usage.gamesPlayedUsage.innings.pitched,
                          projected: usage.gamesPlayedUsage.innings.projected,
                        },
                      }),
                }
              : usage.gamesPlayedUsage,
        }
      : {}),
  };
}
