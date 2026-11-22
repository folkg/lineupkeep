import type { AuthenticatedAgent } from "@lineupkeep/backend/auth/Auth";
import { FantasyQueries } from "@lineupkeep/backend/connections/FantasyQueries";
import { TeamId } from "@lineupkeep/backend/connections/FantasyTeam";
import { fantasyQueryScopes } from "@lineupkeep/backend/connections/QueryScopes";
import type { PlayerRef } from "@lineupkeep/backend/connections/QueryValues";
import { TransactionOffers } from "@lineupkeep/backend/connections/TransactionOffers";
import { TransactionPlanService } from "@lineupkeep/backend/connections/TransactionPlans";
import { EffectString } from "@lineupkeep/collections";
import { Cause, Effect, Result, Schema } from "effect";
import type { Layer } from "effect";
import { Array as EffectArray } from "effect";
import { Tool, Toolkit } from "effect/ai";

import { RequiredScope } from "./toolAuthorization";

const ToolFailure = Schema.Struct({ code: Schema.String, message: Schema.String });

const SnapshotInput = Schema.Struct({
  team: TeamId.pipe(
    Schema.annotate({
      description: "The linked team whose morning state to read.",
    }),
  ),
});

const SnapshotFailure = Schema.Struct({
  section: Schema.NonEmptyString,
  code: Schema.NonEmptyString,
  message: Schema.NonEmptyString,
});

const SnapshotResult = Schema.Struct({
  status: Schema.Literal("ok"),
  team: TeamId,
  summary: Schema.optional(Schema.Unknown),
  league: Schema.optional(Schema.Unknown),
  roster: Schema.optional(Schema.Unknown),
  plan: Schema.optional(Schema.Unknown),
  transactions: Schema.optional(Schema.Unknown),
  offers: Schema.optional(Schema.Unknown),
  pool: Schema.optional(Schema.Unknown),
  playerStats: Schema.optional(Schema.Unknown),
  failures: Schema.Array(SnapshotFailure),
});

export const snapshotTools = Toolkit.make(
  Tool.make("get_team_snapshot", {
    description:
      "One read of a team's morning state: summary, league rules, full roster, queue, recent transactions, pending offers, free-agent pool, and roster-player stats. A section that fails appears in `failures`; nothing writes.",
    parameters: SnapshotInput,
    success: Schema.toCodecJson(SnapshotResult),
    failure: ToolFailure,
  })
    .annotate(RequiredScope, fantasyQueryScopes.read)
    .annotate(Tool.Title, "Get team snapshot")
    .annotate(Tool.Readonly, true)
    .annotate(Tool.Destructive, false)
    .annotate(Tool.Idempotent, true)
    .annotate(Tool.OpenWorld, false),
);

export function snapshotToolHandlers(
  agent: AuthenticatedAgent,
): Layer.Layer<
  Tool.HandlersFor<Toolkit.Tools<typeof snapshotTools>>,
  never,
  FantasyQueries | TransactionPlanService | TransactionOffers
> {
  return snapshotTools.toLayer(
    Effect.gen(function* () {
      const queries = yield* FantasyQueries;
      const plans = yield* TransactionPlanService;
      const offers = yield* TransactionOffers;

      return snapshotTools.of({
        get_team_snapshot: (input) => readSnapshot(agent.userId, input, queries, plans, offers),
      });
    }),
  );
}

function readSnapshot(
  userId: AuthenticatedAgent["userId"],
  input: typeof SnapshotInput.Type,
  queries: FantasyQueries["Service"],
  plans: TransactionPlanService["Service"],
  offers: TransactionOffers["Service"],
): Effect.Effect<typeof SnapshotResult.Type, never, never> {
  return Effect.gen(function* () {
    const failures: Array<typeof SnapshotFailure.Type> = [];
    const summary = yield* capture("summary", failures, () =>
      queries.getTeamSummary(userId, {
        team: input.team,
        groups: ["league", "standings", "categories", "matchup", "schedule", "roster"],
      }),
    );
    const league = yield* capture("league", failures, () =>
      queries.getLeague(userId, { team: input.team }),
    );
    const roster = yield* capture("roster", failures, () =>
      queries.getRosters(userId, { team: input.team, detail: "full" }),
    );
    const plan = yield* capture("plan", failures, () => plans.plan(userId, { team: input.team }));
    const transactions = yield* capture("transactions", failures, () =>
      queries.getTransactions(userId, { team: input.team, scope: "team", limit: 20 }),
    );
    const pendingOffers = yield* capture("offers", failures, () =>
      offers.readPendingOffers(userId, { team: input.team }),
    );
    const pool = yield* capture("pool", failures, () =>
      queries.searchPlayers(userId, {
        team: input.team,
        availability: "free_agent",
        sort: "ownership",
        limit: 25,
      }),
    );
    const playerStats = yield* captureRosterStats(userId, input.team, roster, queries, failures);

    return {
      status: "ok" as const,
      team: input.team,
      ...(summary === undefined ? {} : { summary }),
      ...(league === undefined ? {} : { league }),
      ...(roster === undefined ? {} : { roster }),
      ...(plan === undefined ? {} : { plan }),
      ...(transactions === undefined ? {} : { transactions }),
      ...(pendingOffers === undefined ? {} : { offers: pendingOffers }),
      ...(pool === undefined ? {} : { pool }),
      ...(playerStats === undefined ? {} : { playerStats }),
      failures,
    };
  });
}

function capture<A>(
  section: string,
  failures: Array<typeof SnapshotFailure.Type>,
  read: () => Effect.Effect<A, SectionError>,
): Effect.Effect<A | undefined, never, never> {
  return read().pipe(
    Effect.catchCause((cause) =>
      Effect.sync(() => {
        const failure = Cause.findFail(cause);
        if (Result.isSuccess(failure)) {
          failures.push(snapshotFailure(section, failure.success.error));
        } else {
          failures.push({
            section,
            code: "defect",
            message: EffectString.slice(Cause.pretty(cause), 0, 1000),
          });
        }
        return undefined;
      }),
    ),
  );
}

function captureRosterStats(
  userId: AuthenticatedAgent["userId"],
  team: TeamId,
  roster: unknown,
  queries: FantasyQueries["Service"],
  failures: Array<typeof SnapshotFailure.Type>,
): Effect.Effect<unknown, never, never> {
  if (!isRoster(roster)) {
    return Effect.undefined;
  }
  const players = EffectArray.map(roster.players, (player) => player.player);
  if (players.length === 0) {
    return Effect.undefined;
  }
  if (players.length > 25) {
    failures.push({
      section: "playerStats",
      code: "truncated",
      message: "Only the first 25 roster players were included in playerStats.",
    });
  }
  return capture("playerStats", failures, () =>
    queries.getPlayers(userId, {
      team,
      players: players.slice(0, 25),
      groups: ["identity", "availability", "actual_stats", "scoring_context"],
    }),
  );
}

function isRoster(value: unknown): value is {
  readonly status: "ok";
  readonly players: ReadonlyArray<{ readonly player: PlayerRef }>;
} {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "ok" &&
    "players" in value &&
    EffectArray.isArray(value.players)
  );
}

function snapshotFailure(section: string, error: SectionError): typeof SnapshotFailure.Type {
  return {
    section,
    code: error._tag,
    message: typeof error.detail === "string" ? error.detail : "The section could not be read.",
  };
}

type SectionError = { readonly _tag: string; readonly detail?: unknown };
