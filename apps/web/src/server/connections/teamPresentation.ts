import type { ConnectionError } from "@lineupkeep/backend/connections/Connection";
import type { TeamCardRead } from "@lineupkeep/backend/connections/Connections";
import type { LineupRun } from "@lineupkeep/backend/connections/LineupRun";
import type { LineupError } from "@lineupkeep/backend/connections/LineupRun";
import type { LineupRunOutcome } from "@lineupkeep/backend/connections/LineupRun";
import type { ProviderTeamCard } from "@lineupkeep/backend/connections/Provider";
import { teamNoteLimit } from "@lineupkeep/backend/connections/TeamNote";
import type { TeamSummary } from "@lineupkeep/backend/connections/Teams";
import type {
  TeamError,
  TeamNoteError,
  TeamNoteSaved,
} from "@lineupkeep/backend/connections/Teams";
import { DateTime, Option as EffectOption, Schema } from "effect";
import { Array as EffectArray } from "effect";

import type {
  LineupRunView,
  TeamMutationError,
  TeamNoteSaveResult,
  TeamSummaryView,
  TeamCardView,
  TeamView,
} from "#contracts/connections/teamContract.ts";
import type { ExpectedFailure } from "#server/backendEntry.ts";

export function toTeamSummaryView(summary: TeamSummary): TeamSummaryView {
  return {
    team: toTeamView(summary.team),
    connectionStatus: summary.connectionStatus,
    connectionCount: summary.connectionCount,
    ...(summary.lastRun === undefined ? {} : { lastRun: toLineupRunView(summary.lastRun) }),
    recentRuns: EffectArray.map(summary.recentRuns, toLineupRunView),
  };
}

export const toTeamCardViews =
  (read: TeamCardRead): ((summaries: ReadonlyArray<TeamSummary>) => ReadonlyArray<TeamCardView>) =>
  (summaries: ReadonlyArray<TeamSummary>): ReadonlyArray<TeamCardView> => {
    const cards = new Map(
      EffectArray.map(
        read.cards,
        (card) => [`${card.connectionId}:${card.providerTeamKey}`, card] as const,
      ),
    );
    const failures = new Map(
      EffectArray.map(read.failures, (failure) => [failure.connectionId, failure.reason] as const),
    );
    const leagueCards = new Map<string, ReadonlyArray<ProviderTeamCard>>();
    for (const card of read.cards) {
      const key = `${card.connectionId}:${card.providerLeagueKey}`;
      const existing = leagueCards.get(key);
      leagueCards.set(key, existing === undefined ? [card] : [...existing, card]);
    }
    return EffectArray.map(summaries, (summary) => {
      const card = cards.get(`${summary.team.connectionId}:${summary.team.providerTeamKey}`);
      const reason =
        failures.get(summary.team.connectionId) ?? "Season facts were not published for this team.";
      return {
        summary: toTeamSummaryView(summary),
        ...(card === undefined
          ? {
              reason:
                summary.connectionStatus === "ready" ? reason : "Reconnect to load season facts.",
            }
          : {
              season: {
                seasonOver: card.seasonOver,
                format: card.format,
                scoringLabel: card.scoringLabel,
                scoringType: card.scoringType,
                teamCount: card.teamCount,
                weeklyDeadline: card.weeklyDeadline,
                startDate: card.startDate,
                endDate: card.endDate,
                currentWeek: card.currentWeek,
                endWeek: card.endWeek,
                maxGamesPlayed: card.maxGamesPlayed,
                maxInningsPitched: card.maxInningsPitched,
                standing:
                  card.standing === undefined
                    ? undefined
                    : {
                        rank: card.standing.rank,
                        record: card.standing.record,
                        points: card.standing.points,
                        pointsFor: card.standing.pointsFor,
                        pointsAgainst: card.standing.pointsAgainst,
                        pointsBack: card.standing.pointsBack,
                      },
                ...(categoryPointsOf(
                  card,
                  leagueCards.get(`${card.connectionId}:${card.providerLeagueKey}`) ?? [card],
                ) === undefined
                  ? {}
                  : {
                      categoryPoints: categoryPointsOf(
                        card,
                        leagueCards.get(`${card.connectionId}:${card.providerLeagueKey}`) ?? [card],
                      ),
                    }),
                ...(card.matchup === undefined
                  ? {}
                  : {
                      matchup: {
                        week: card.matchup.week,
                        opponent: card.matchup.opponent,
                        points: card.matchup.points,
                        opponentPoints: card.matchup.opponentPoints,
                        projectedPoints: card.matchup.projectedPoints,
                        opponentProjectedPoints: card.matchup.opponentProjectedPoints,
                        ...(card.matchup.remainingGames === undefined
                          ? {}
                          : { remainingGames: card.matchup.remainingGames }),
                        ...(card.matchup.opponentRemainingGames === undefined
                          ? {}
                          : { opponentRemainingGames: card.matchup.opponentRemainingGames }),
                        categories: EffectArray.map(card.matchup.categories, (row) => ({
                          name: row.name,
                          scoring: row.informational ? ("informational" as const) : undefined,
                          own: row.own,
                          opponent: row.opponent,
                          ...(row.result === undefined ? {} : { result: row.result }),
                        })),
                      },
                    }),
              },
            }),
      };
    });
  };

type TeamCategoryPoint = {
  readonly name: string;
  readonly scoring: "informational" | undefined;
  readonly value: number | null;
  readonly total: number | null;
  readonly place: number | null;
};

function categoryPointsOf(
  card: ProviderTeamCard,
  leagueCards: ReadonlyArray<ProviderTeamCard>,
): ReadonlyArray<TeamCategoryPoint> | undefined {
  const settings: ReadonlyArray<NonNullable<ProviderTeamCard["categorySettings"]>[number]> =
    card.categorySettings ?? [];
  if (settings.length === 0) {
    return undefined;
  }
  const points = new Map(
    EffectArray.map(card.standing?.categoryPoints ?? [], (entry) => [entry.statId, entry.value]),
  );
  const totals = new Map(
    EffectArray.map(card.standing?.categoryTotals ?? [], (entry) => [entry.statId, entry.value]),
  );
  const scored: ReadonlyArray<NonNullable<ProviderTeamCard["categorySettings"]>[number]> =
    EffectArray.filter(settings, (setting) => !setting.displayOnly);
  const rows = EffectArray.flatMap(scored, (setting) => {
    const value = points.get(setting.statId) ?? null;
    const place = categoryPlace(leagueCards, setting.statId, value);
    return [
      {
        name: setting.name,
        scoring: undefined,
        value,
        total: totals.get(setting.statId) ?? null,
        place,
      },
    ];
  });
  return rows.length === 0 ? undefined : rows;
}

function categoryPlace(
  leagueCards: ReadonlyArray<ProviderTeamCard>,
  statId: number,
  value: number | null,
): number | null {
  if (value === null) {
    return null;
  }
  let higher = 0;
  for (const card of leagueCards) {
    const other = EffectOption.getOrUndefined(
      EffectArray.findFirst(
        card.standing?.categoryPoints ?? [],
        (entry) => entry.statId === statId,
      ),
    );
    if (other === undefined || other.value === null) {
      return null;
    }
    if (other.value > value) {
      higher += 1;
    }
  }
  return higher + 1;
}

export function toLineupRunView(run: LineupRun): LineupRunView {
  return {
    run: run.run,
    request: run.request,
    team: run.team,
    target: run.target,
    trigger: run.trigger,
    implementation: run.implementation,
    implementationVersion: run.implementationVersion,
    status: run.status,
    attempts: run.attempts,
    createdAt: DateTime.formatIso(run.createdAt),
    updatedAt: DateTime.formatIso(run.updatedAt),
    ...(run.outcome === undefined ? {} : { outcome: toLineupOutcomeView(run.outcome) }),
    ...(run.pending === undefined
      ? {}
      : {
          pending: {
            reason: run.pending.reason,
            detail: run.pending.detail,
            ...(run.pending.retryAt === undefined
              ? {}
              : { retryAt: DateTime.formatIso(run.pending.retryAt) }),
          },
        }),
  };
}

function toLineupOutcomeView(outcome: LineupRunOutcome): NonNullable<LineupRunView["outcome"]> {
  const { nextGameAt, nextTickAt, ...rest } = outcome;
  return {
    ...rest,
    observedAt: DateTime.formatIso(outcome.observedAt),
    ...(nextGameAt === undefined ? {} : { nextGameAt: DateTime.formatIso(nextGameAt) }),
    ...(nextTickAt === undefined ? {} : { nextTickAt: DateTime.formatIso(nextTickAt) }),
  };
}

function toTeamView(summary: TeamSummary["team"]): TeamView {
  return {
    id: summary.id,
    connectionId: summary.connectionId,
    provider: summary.provider,
    providerTeamKey: summary.providerTeamKey,
    providerLeagueKey: summary.providerLeagueKey,
    league: summary.league,
    sport: summary.sport,
    season: summary.season,
    name: summary.name,
    ...(summary.leagueName === undefined ? {} : { leagueName: summary.leagueName }),
    ...(summary.providerUrl === undefined ? {} : { providerUrl: summary.providerUrl }),
    availability: summary.availability,
    automation: {
      status: summary.automation.status,
      changedAt: DateTime.formatIso(summary.automation.changedAt),
      ...(summary.automation.pausedAt === undefined
        ? {}
        : { pausedAt: DateTime.formatIso(summary.automation.pausedAt) }),
      ...(summary.automation.resumesAt === undefined
        ? {}
        : { resumesAt: DateTime.formatIso(summary.automation.resumesAt) }),
      ...(summary.automation.timeZone === undefined
        ? {}
        : { timeZone: summary.automation.timeZone }),
      ...(summary.automation.fantasyDay === undefined
        ? {}
        : { fantasyDay: summary.automation.fantasyDay }),
      ...(summary.automation.fantasyDayVersion === undefined
        ? {}
        : { fantasyDayVersion: summary.automation.fantasyDayVersion }),
    },
    ownerNote: summary.ownerNote,
    ownerNoteUpdatedAt:
      summary.ownerNoteUpdatedAt === null ? null : DateTime.formatIso(summary.ownerNoteUpdatedAt),
    ownerNoteLimit: teamNoteLimit,
    lastSeenAt: DateTime.formatIso(summary.lastSeenAt),
    createdAt: DateTime.formatIso(summary.createdAt),
    updatedAt: DateTime.formatIso(summary.updatedAt),
  };
}

export function mapTeamError(error: TeamError): ExpectedFailure<TeamMutationError["type"]> {
  switch (error._tag) {
    case "team.not_found":
      return { type: "team.not_found", outcome: "rejected" };
    case "team.control_rejected":
      return { type: "team.control_rejected", outcome: "conflict" };
    case "team.persistence_failed":
      return { type: "team.persistence_failed", outcome: "failure" };
  }
}

export function mapTeamRefreshError(
  error: ConnectionError | TeamError,
): ExpectedFailure<TeamMutationError["type"]> {
  if (error._tag === "team.not_found") {
    return { type: "team.not_found", outcome: "rejected" };
  }
  if (error._tag === "team.control_rejected") {
    return { type: "team.control_rejected", outcome: "conflict" };
  }
  if (error._tag === "team.persistence_failed") {
    return { type: "team.persistence_failed", outcome: "failure" };
  }
  return { type: "team.refresh_failed", outcome: "failure" };
}

export function mapLineupError(
  error: LineupError,
): ExpectedFailure<
  | "lineup.run_not_found"
  | "lineup.team_not_found"
  | "lineup.connection_not_ready"
  | "lineup.selection_invalid"
  | "lineup.request_conflict"
  | "lineup.persistence_failed"
> {
  switch (error._tag) {
    case "lineup.run_not_found":
    case "lineup.team_not_found":
    case "lineup.connection_not_ready":
    case "lineup.selection_invalid":
      return { type: error._tag, outcome: "rejected" };
    case "lineup.request_conflict":
      return { type: error._tag, outcome: "conflict" };
    case "lineup.persistence_failed":
      return { type: error._tag, outcome: "failure" };
  }
}

export class TeamInputInvalid extends Schema.TaggedError<
  TeamInputInvalid,
  { readonly brand: unique symbol }
>()("TeamInputInvalid", {}) {}

export function toTeamNoteSaveResult(note: TeamNoteSaved): TeamNoteSaveResult {
  return {
    outcome: "saved",
    note: note.note,
    updatedAt: note.updatedAt === null ? null : DateTime.formatIso(note.updatedAt),
  };
}

export function mapTeamNoteError(error: TeamNoteError): ExpectedFailure<TeamNoteErrorCode> {
  switch (error._tag) {
    case "team.not_found":
      return { type: "team.not_found", outcome: "rejected" };
    case "team.note_rejected":
      return { type: "team.input_invalid", outcome: "rejected" };
    case "team.persistence_failed":
      return { type: "team.persistence_failed", outcome: "failure" };
  }
}

type TeamNoteErrorCode = "team.not_found" | "team.persistence_failed" | "team.input_invalid";

export class LineupRunInputInvalid extends Schema.TaggedError<
  LineupRunInputInvalid,
  { readonly brand: unique symbol }
>()("LineupRunInputInvalid", {}) {}
