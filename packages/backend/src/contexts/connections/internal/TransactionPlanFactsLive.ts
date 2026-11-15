import { DateTime, Effect, Layer } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import { fantasyDayLabel } from "#contexts/connections/FantasyDay.ts";
import type { TeamId } from "#contexts/connections/FantasyTeam.ts";
import { rosterChangeDate } from "#contexts/connections/ProposalOrder.ts";
import type {
  ProviderLeagueSettings,
  ProviderPlayerDetail,
  ProviderReadFailure,
  ProviderRoster,
  ProviderRosterCoverage,
} from "#contexts/connections/Provider.ts";
import { sessionEvidenceOf } from "#contexts/connections/Provider.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";
import { rosterPlayerInjured } from "#contexts/connections/RosterSlots.ts";
import { TransactionPlanFactsUnavailable } from "#contexts/connections/TransactionPlans.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import { loadTeamContext, providerIdentity } from "./QueryContext.ts";
import type { TeamContext } from "./QueryContext.ts";
import { QueryRepository } from "./QueryRepository.ts";
import { TransactionPlanFacts } from "./TransactionPlanService.ts";

export const TransactionPlanFactsLive = Layer.effect(
  TransactionPlanFacts,
  Effect.gen(function* () {
    const queries = yield* QueryRepository;
    const encryption = yield* ConnectionCredentialEncryption;
    const registry = yield* ProviderRegistry;

    const read = Effect.fn("TransactionPlanFacts.read")(function* (input: {
      readonly userId: UserId;
      readonly team: TeamId;
      readonly at: DateTime.Utc;
      readonly players: ReadonlyArray<string>;
      readonly needsBudget: boolean;
    }) {
      const context = yield* loadTeamContext(
        queries,
        encryption,
        registry,
        input.userId,
        input.team,
      ).pipe(
        Effect.mapError(() =>
          TransactionPlanFactsUnavailable.make({
            team: input.team,
            detail: "This team's connection could not be read.",
          }),
        ),
      );
      const league = yield* providerRead({
        queries,
        context,
        team: input.team,
        operation: "the league rules",
        read: context.provider.readLeague({
          ...providerIdentity(context),
          providerLeagueKey: context.owned.team.providerLeagueKey,
          sport: context.owned.team.sport,
        }),
      });
      const coverage = coverageOf(league);
      if (coverage === undefined) {
        return yield* unavailable(
          input.team,
          "The league publishes no current date or scoring week, so the roster could not be read.",
        );
      }
      const roster = yield* providerRead({
        queries,
        context,
        team: input.team,
        operation: "the roster",
        read: context.provider.readRoster({
          ...providerIdentity(context),
          providerTeamKey: context.owned.team.providerTeamKey,
          period: coverage,
        }),
      });
      const details = yield* playerDetails({
        context,
        team: input.team,
        queries,
        league,
        players: input.players,
      });
      const budget = yield* budgetOf({
        context,
        team: input.team,
        queries,
        enabled: input.needsBudget,
      });
      const periodStart = yield* publishedPeriodStart({ context, league });
      return {
        roster: rosterPlayers(roster),
        pool: poolPlayers(details),
        slots: league.rosterPositions.map((slot) => ({
          position: slot.position,
          kind: slot.kind,
          count: slot.count,
          eligibility: slot.eligibility,
        })),
        constraints: league.rosterConstraints,
        today: fantasyDayLabel(input.at, context.provider.capabilities.fantasyDay),
        timing: {
          rule: league.rosterChange?.rule,
          currentDate: league.currentDate,
          periodStart,
        },
        budget,
      };
    });

    return { read };
  }),
);

function providerRead<A>(input: {
  readonly queries: QueryRepository["Service"];
  readonly context: TeamContext;
  readonly team: TeamId;
  readonly operation: string;
  readonly read: Effect.Effect<A, ProviderReadFailure>;
}): Effect.Effect<A, TransactionPlanFactsUnavailable> {
  return Effect.result(input.read).pipe(
    Effect.flatMap((result) => {
      if (result._tag === "Success") {
        return Effect.succeed(result.success);
      }
      const failure = unavailable(
        input.team,
        `Current state could not be read: ${input.operation} failed.`,
      );
      return result.failure._tag === "provider.session_rejected"
        ? input.queries
            .recordSessionRejected(
              input.context.userId,
              input.context.owned,
              sessionEvidenceOf(result.failure),
            )
            .pipe(Effect.andThen(failure))
        : failure;
    }),
  );
}

function playerDetails(input: {
  readonly context: TeamContext;
  readonly team: TeamId;
  readonly queries: QueryRepository["Service"];
  readonly league: ProviderLeagueSettings;
  readonly players: ReadonlyArray<string>;
}): Effect.Effect<ReadonlyArray<ProviderPlayerDetail>, TransactionPlanFactsUnavailable> {
  if (input.players.length === 0) {
    return Effect.succeed([]);
  }
  return providerRead({
    queries: input.queries,
    context: input.context,
    team: input.team,
    operation: "the available players",
    read: input.context.provider.readPlayerDetails({
      ...providerIdentity(input.context),
      providerLeagueKey: input.context.owned.team.providerLeagueKey,
      providerPlayerKeys: [...new Set(input.players)],
      sport: input.context.owned.team.sport,
      period: { kind: "season" },
      currentPeriod: input.league.periodWindow?.current,
      seasonStart: input.league.startDate,
      seasonEnd: input.league.endDate,
    }),
  });
}

function budgetOf(input: {
  readonly context: TeamContext;
  readonly team: TeamId;
  readonly queries: QueryRepository["Service"];
  readonly enabled: boolean;
}): Effect.Effect<number | undefined, TransactionPlanFactsUnavailable> {
  if (!input.enabled) {
    return Effect.void.pipe(Effect.as(undefined));
  }
  return providerRead({
    queries: input.queries,
    context: input.context,
    team: input.team,
    operation: "the league's teams",
    read: input.context.provider.readLeagueTeams({
      ...providerIdentity(input.context),
      providerLeagueKey: input.context.owned.team.providerLeagueKey,
    }),
  }).pipe(
    Effect.map(
      (teams) =>
        teams.find((team) => team.providerTeamKey === input.context.owned.team.providerTeamKey)
          ?.remainingBudget,
    ),
  );
}

function rosterPlayers(roster: ProviderRoster): ReadonlyArray<{
  readonly key: string;
  readonly name: string;
  readonly positions: ReadonlyArray<string>;
  readonly slot: string | undefined;
  readonly injured: boolean;
  readonly editable: boolean;
}> {
  return roster.players.map((player) => ({
    key: player.providerPlayerKey,
    name: player.name,
    positions: player.eligiblePositions,
    slot: player.slot.status === "verified" ? player.slot.slot : undefined,
    injured: rosterPlayerInjured(player),
    editable: player.isEditable === true,
  }));
}

function poolPlayers(details: ReadonlyArray<ProviderPlayerDetail>): ReadonlyMap<
  string,
  {
    readonly key: string;
    readonly name: string;
    readonly positions: ReadonlyArray<string>;
    readonly availability: "free_agent" | "waiver";
  }
> {
  const pool = new Map<
    string,
    {
      readonly key: string;
      readonly name: string;
      readonly positions: ReadonlyArray<string>;
      readonly availability: "free_agent" | "waiver";
    }
  >();
  for (const detail of details) {
    const availability =
      detail.rosterStatus === "free_agent"
        ? "free_agent"
        : detail.rosterStatus === "waiver"
          ? "waiver"
          : undefined;
    if (availability === undefined) {
      continue;
    }
    pool.set(detail.providerPlayerKey, {
      key: detail.providerPlayerKey,
      name: detail.name ?? detail.providerPlayerKey,
      positions:
        detail.eligiblePositions ??
        (detail.primaryPosition === undefined ? [] : [detail.primaryPosition]),
      availability,
    });
  }
  return pool;
}

function publishedPeriodStart(input: {
  readonly context: TeamContext;
  readonly league: ProviderLeagueSettings;
}): Effect.Effect<string | undefined> {
  if (input.league.rosterChange?.rule !== "weekly_lock") {
    return Effect.void.pipe(Effect.as(undefined));
  }
  const week = input.league.periodWindow?.current;
  if (week === undefined) {
    return Effect.void.pipe(Effect.as(undefined));
  }
  return Effect.result(
    input.context.provider.readMatchups({
      ...providerIdentity(input.context),
      providerLeagueKey: input.context.owned.team.providerLeagueKey,
      period: { week },
    }),
  ).pipe(
    Effect.map((result) => {
      if (result._tag !== "Success") {
        return undefined;
      }
      const weekStart = result.success.find(
        (matchup) => matchup.weekStart !== undefined,
      )?.weekStart;
      return weekStart !== undefined && /^\d{4}-\d{2}-\d{2}$/u.test(weekStart)
        ? weekStart
        : undefined;
    }),
  );
}

function coverageOf(league: ProviderLeagueSettings): ProviderRosterCoverage | undefined {
  if (league.rosterCoverage === "week") {
    const week = league.periodWindow?.current;
    return week === undefined ? undefined : { type: "week", week };
  }
  const date = rosterChangeDate({
    rule: league.rosterChange?.rule,
    currentDate: league.currentDate,
  });
  return date === undefined ? undefined : { type: "date", date };
}

function unavailable(
  team: TeamId,
  detail: string,
): Effect.Effect<never, TransactionPlanFactsUnavailable> {
  return Effect.fail(TransactionPlanFactsUnavailable.make({ team, detail }));
}
