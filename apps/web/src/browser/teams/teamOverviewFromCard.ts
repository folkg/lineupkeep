import type { TeamCardView, TeamOverviewView } from "#contracts/connections/teamContract.ts";

export function toTeamOverviewFromCard(
  card: TeamCardView,
  overview?: Pick<TeamOverviewView, "categoryPoints" | "gamesUsage">,
): TeamOverviewView {
  const season = card.season;
  if (season === undefined) {
    return { reason: card.reason ?? "Season facts were not published." };
  }
  const standing = season.standing;
  const league =
    season.teamCount === undefined
      ? undefined
      : {
          teamCount: season.teamCount,
          scoringType: season.scoringType,
          ...(season.scoringLabel === undefined ? {} : { scoringLabel: season.scoringLabel }),
          ...(season.weeklyDeadline === undefined ? {} : { weeklyDeadline: season.weeklyDeadline }),
          ...(season.startDate === undefined ? {} : { startDate: season.startDate }),
          ...(season.endDate === undefined ? {} : { endDate: season.endDate }),
          gamesCaps: {
            ...(season.maxGamesPlayed === undefined ? {} : { gamesPlayed: season.maxGamesPlayed }),
            ...(season.maxInningsPitched === undefined
              ? {}
              : { inningsPitched: season.maxInningsPitched }),
          },
        };
  return {
    ...(card.reason === undefined ? {} : { reason: card.reason }),
    seasonOver: season.seasonOver,
    format: season.format,
    ...(league === undefined
      ? { leagueReason: "League settings were not published." }
      : { league }),
    ...(season.currentWeek === undefined &&
    season.endWeek === undefined &&
    season.endDate === undefined &&
    season.usesPlayoffs === undefined &&
    season.playoffStartWeek === undefined
      ? {}
      : {
          seasonProgress: {
            ...(season.currentWeek === undefined ? {} : { currentPeriod: season.currentWeek }),
            ...(season.endWeek === undefined ? {} : { lastPeriod: season.endWeek }),
            ...(season.usesPlayoffs === undefined ? {} : { usesPlayoffs: season.usesPlayoffs }),
            ...(season.playoffStartWeek === undefined
              ? {}
              : { playoffStartWeek: season.playoffStartWeek }),
            ...(season.endDate === undefined ? {} : { endDate: season.endDate }),
          },
        }),
    ...(standing === undefined
      ? { standingReason: "Standings were not published." }
      : {
          standing: {
            rank: standing.rank,
            points: standing.points,
            pointsFor: standing.pointsFor,
            pointsAgainst: standing.pointsAgainst,
            pointsBack: standing.pointsBack,
          },
        }),
    ...(standing?.record === undefined
      ? { recordReason: "Record not published." }
      : { record: standing.record }),
    ...(season.matchup === undefined
      ? { matchupReason: "Matchup was not published." }
      : { matchup: season.matchup }),
    ...(overview?.categoryPoints !== undefined && overview.categoryPoints.length > 0
      ? { categoryPoints: overview.categoryPoints }
      : season.categoryPoints === undefined
        ? { categoryReason: "Season category points were not published." }
        : { categoryPoints: season.categoryPoints }),
    ...(overview?.gamesUsage === undefined ? {} : { gamesUsage: overview.gamesUsage }),
  };
}
