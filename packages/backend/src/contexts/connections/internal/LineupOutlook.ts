import { projectLineupOutlook } from "@lineupkeep/lineup-solver";
import type {
  OutlookMove,
  OutlookPlayer,
  OutlookResult,
  OutlookWindowPeriod,
} from "@lineupkeep/lineup-solver";
import { Array as EffectArray, Effect, Option } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { TeamId } from "#contexts/connections/FantasyTeam.ts";
import type { ProfessionalGame } from "#contexts/connections/ProfessionalGame.ts";
import type {
  ProviderLeagueSettings,
  ProviderRoster,
  ProviderRosterSchedule,
} from "#contexts/connections/Provider.ts";
import { isOpenMove } from "#contexts/connections/TransactionPlans.ts";
import type { TransactionPlanPersistenceFailed } from "#contexts/connections/TransactionPlans.ts";

import { gameCanBePlayed } from "./LeagueSchedule.ts";
import type { TransactionMoveRecord } from "./TransactionPlanRecord.ts";
import type { TransactionPlanRepository } from "./TransactionPlanRepository.ts";

export function readOpenOutlookPlan(input: {
  readonly repository: TransactionPlanRepository["Service"];
  readonly userId: UserId;
  readonly team: TeamId;
}): Effect.Effect<ReadonlyArray<TransactionMoveRecord>, TransactionPlanPersistenceFailed> {
  return input.repository
    .readPlanMoves({ userId: input.userId, team: input.team })
    .pipe(Effect.map((moves) => EffectArray.filter(moves, isOpenMove)));
}

export function buildOutlook(input: {
  readonly roster: ProviderRoster;
  readonly league: ProviderLeagueSettings;
  readonly periods: ReadonlyArray<OutlookWindowPeriod>;
  readonly moves: ReadonlyArray<TransactionMoveRecord>;
  readonly professionalGames?: ReadonlyArray<ProfessionalGame>;
  readonly providerSchedule?: ProviderRosterSchedule;
  readonly teamKeysByAbbreviation: ReadonlyMap<string, string>;
}): OutlookResult {
  const gamesByTeam = new Map<
    string,
    Map<string, ReadonlyArray<{ opponent?: string; home?: boolean }> | null>
  >();
  if (input.professionalGames !== undefined) {
    const dates = EffectArray.map(
      input.periods,
      (period) => period.date ?? `week:${String(period.week)}`,
    );
    const knownTeamKeys = new Set([
      ...EffectArray.flatMap(input.roster.players, (player) =>
        player.proTeamKey === undefined ? [] : [player.proTeamKey],
      ),
      ...input.teamKeysByAbbreviation.values(),
    ]);
    for (const key of knownTeamKeys) {
      gamesByTeam.set(key, new Map(EffectArray.map(dates, (date) => [date, null] as const)));
    }
    for (const game of input.professionalGames) {
      if (!gameCanBePlayed(game)) {
        continue;
      }
      for (const [team, opponent, home] of [
        [game.home, game.away, true],
        [game.away, game.home, false],
      ] as const) {
        if (team.providerTeamKey !== null) {
          const byDate =
            gamesByTeam.get(team.providerTeamKey) ??
            new Map<string, ReadonlyArray<{ opponent?: string; home?: boolean }> | null>();
          byDate.set(game.date, [
            ...(byDate.get(game.date) ?? []),
            { opponent: opponent.sourceTeamAbbreviation, home },
          ]);
          gamesByTeam.set(team.providerTeamKey, byDate);
        }
      }
    }
  }
  const gamesByPlayer = new Map<
    string,
    Map<string, ReadonlyArray<{ opponent?: string; home?: boolean }> | null>
  >();
  if (input.providerSchedule !== undefined) {
    for (const player of input.providerSchedule.players) {
      const byDate = new Map<string, ReadonlyArray<{ opponent?: string; home?: boolean }> | null>();
      for (const date of input.providerSchedule.dates) {
        byDate.set(date, null);
      }
      for (const game of player.games) {
        if (game.date !== undefined) {
          byDate.set(game.date, [
            ...(byDate.get(game.date) ?? []),
            { opponent: game.opponent, home: game.home },
          ]);
        }
      }
      gamesByPlayer.set(player.providerPlayerKey, byDate);
    }
  }
  const players = EffectArray.map(input.roster.players, (player): OutlookPlayer => ({
    key: player.providerPlayerKey,
    name: player.name,
    ...(player.proTeamAbbreviation === undefined ? {} : { proTeam: player.proTeamAbbreviation }),
    positions: player.eligiblePositions,
    slot: player.slot.status === "verified" ? player.slot.slot : "unverified",
    games:
      gamesByTeam.get(
        player.proTeamKey ??
          input.teamKeysByAbbreviation.get(player.proTeamAbbreviation ?? "") ??
          "",
      ) ??
      gamesByPlayer.get(player.providerPlayerKey) ??
      (input.league.rosterCoverage === "week" &&
      input.roster.coverage.type === "week" &&
      input.periods[0]?.week === input.roster.coverage.week
        ? new Map([
            [
              `week:${String(input.roster.coverage.week)}`,
              player.scheduled ? [player.opponent ?? {}] : null,
            ],
          ])
        : new Map()),
  }));
  const moves = EffectArray.map(input.moves, (move, order): OutlookMove => ({
    id: move.id,
    kind: move.kind,
    ...(move.effectiveDate === undefined ? {} : { effectiveDate: move.effectiveDate }),
    ...(move.runDay === undefined ? {} : { runDay: move.runDay }),
    order,
    adds: EffectArray.map(move.adds, (player): OutlookPlayer => ({
      key: player.key,
      name: player.name ?? "Unknown player",
      ...(player.proTeam === undefined ? {} : { proTeam: player.proTeam }),
      positions: player.position === undefined ? [] : [player.position],
      slot: move.placement?.playerKey === player.key ? move.placement.toSlot : "BN",
      games:
        gamesByTeam.get(
          input.teamKeysByAbbreviation.get(player.proTeam ?? "") ?? player.proTeam ?? "",
        ) ??
        gamesByPlayer.get(player.key) ??
        new Map(),
    })),
    fallbacks: EffectArray.map(move.fallbacks, (player) => ({
      key: player.key,
      name: player.name ?? "Unknown player",
    })),
    drops: EffectArray.map(move.drops, (player) => player.key),
    dropNames: new Map(
      EffectArray.map(
        move.drops,
        (player) =>
          [
            player.key,
            player.name ??
              Option.getOrUndefined(
                EffectArray.findFirst(
                  input.roster.players,
                  (held) => held.providerPlayerKey === player.key,
                ),
              )?.name ??
              "Unknown player",
          ] as const,
      ),
    ),
    ...(move.slotMove !== undefined
      ? { slotMove: { key: move.slotMove.playerKey, to: move.slotMove.toSlot } }
      : move.placement !== undefined
        ? { slotMove: { key: move.placement.playerKey, to: move.placement.toSlot } }
        : {}),
    validation: move.validation.status,
    certainty: move.decision === "confirmed" ? "confirmed" : "saved",
    dependsOn: [],
    fallback: false,
  }));
  return projectLineupOutlook({
    periods: input.periods,
    players,
    slots: EffectArray.map(input.league.rosterPositions, (slot) => ({
      position: slot.position,
      kind: slot.kind,
      count: slot.count,
      eligibility: slot.eligibility,
    })),
    moves,
  });
}
