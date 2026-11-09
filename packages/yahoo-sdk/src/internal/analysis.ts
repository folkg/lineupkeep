import { Effect, Schema } from "effect";

import { Flag, IntFromStringOrNumber, decodePayload, optionalNonEmpty } from "#yahoo/decode.ts";
import { YahooParseError } from "#yahoo/errors.ts";
import type { YahooLeagueKey } from "#yahoo/keys.ts";

export function decodeFelo(
  payload: unknown,
  requestedLeagueKey: YahooLeagueKey,
): Effect.Effect<YahooFelo, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(FeloPayload, payload, "read_felo");
    if (decoded.service.league_key !== requestedLeagueKey) {
      return yield* new YahooParseError({ operation: "read_felo", field: "service.league_key" });
    }
    return {
      leagueKey: decoded.service.league_key,
      average: optionalNonEmpty(decoded.service.felo_average ?? undefined),
      weeklyChange: decoded.service.weekly_change ?? undefined,
      currentTier: optionalNonEmpty(decoded.service.current_tier ?? undefined),
      currentTierNumeric: decoded.service.current_tier_numeric ?? undefined,
      teams: Object.values(decoded.service.teams).map((team) => ({
        teamKey: team.team_key,
        feloScore: optionalNonEmpty(team.felo_score ?? undefined),
        weeklyChange: team.weekly_change ?? undefined,
        currentTier: optionalNonEmpty(team.current_tier ?? undefined),
        currentTierNumeric: team.current_tier_numeric ?? undefined,
        managers: Object.values(team.managers ?? {}).map((manager) => ({
          feloScore: optionalNonEmpty(manager.felo_score ?? undefined),
          weeklyChange: manager.weekly_change ?? undefined,
          currentTier: optionalNonEmpty(manager.current_tier ?? undefined),
          isComanager: manager.is_comanager,
        })),
      })),
    };
  });
}

export function decodeTradePartners(
  payload: unknown,
  requestedLeagueKey: YahooLeagueKey,
): Effect.Effect<ReadonlyArray<YahooTradePartner>, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(TradePartnersPayload, payload, "read_trade_partners");
    if (decoded.league.league_key !== requestedLeagueKey) {
      return yield* new YahooParseError({
        operation: "read_trade_partners",
        field: "league.league_key",
      });
    }
    return (decoded.league.recommended_trade_partners ?? []).map(
      ({ recommended_trade_partner }) => ({ teamKey: recommended_trade_partner.team_key }),
    );
  });
}

export function decodeTeamAnalysis(
  payload: unknown,
  requestedLeagueKey: YahooLeagueKey,
): Effect.Effect<ReadonlyArray<YahooTeamAnalysis>, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(TeamAnalysisPayload, payload, "read_team_analysis");
    if (decoded.league.league_key !== requestedLeagueKey) {
      return yield* new YahooParseError({
        operation: "read_team_analysis",
        field: "league.league_key",
      });
    }
    return decoded.league.teams.map(({ team }) => ({
      teamKey: team.team_key,
      name: team.name,
      availableDraftPicks: (team.available_draft_picks?.picks ?? []).map(({ pick }) => ({
        round: pick.round,
        cost: pick.cost,
        pick: pick.pick,
      })),
      positionalRanks:
        team.positional_ranks === undefined ? [] : decodePositionalRanks(team.positional_ranks),
    }));
  });
}

function decodePositionalRanks(value: ReadonlyArray<unknown>): ReadonlyArray<YahooPositionalRank> {
  return value.flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry["positional_rank"])) {
      return [];
    }
    const rank = entry["positional_rank"];
    const position = rank["position"];
    const rankValue = rank["rank"];
    return typeof position === "string" && typeof rankValue === "number"
      ? [{ position, rank: rankValue }]
      : [];
  });
}

export type YahooFelo = {
  readonly leagueKey: string;
  readonly average?: string;
  readonly weeklyChange?: number;
  readonly currentTier?: string;
  readonly currentTierNumeric?: number;
  readonly teams: ReadonlyArray<YahooFeloTeam>;
};

export type YahooFeloTeam = {
  readonly teamKey: string;
  readonly feloScore?: string;
  readonly weeklyChange?: number;
  readonly currentTier?: string;
  readonly currentTierNumeric?: number;
  readonly managers: ReadonlyArray<{
    readonly feloScore?: string;
    readonly weeklyChange?: number;
    readonly currentTier?: string;
    readonly isComanager: boolean;
  }>;
};

export type YahooTradePartner = {
  readonly teamKey: string;
};

export type YahooTeamAnalysis = {
  readonly teamKey: string;
  readonly name: string;
  readonly availableDraftPicks: ReadonlyArray<{
    readonly round: number;
    readonly cost: number;
    readonly pick: number;
  }>;
  readonly positionalRanks: ReadonlyArray<YahooPositionalRank>;
};

export type YahooPositionalRank = {
  readonly position: string;
  readonly rank: number;
};

const NullableString = Schema.optional(Schema.NullOr(Schema.String));
const NullableInt = Schema.optional(Schema.NullOr(IntFromStringOrNumber));

const FeloManagerPayload = Schema.Struct({
  felo_score: NullableString,
  weekly_change: NullableInt,
  current_tier: NullableString,
  is_comanager: Flag,
});

const FeloTeamPayload = Schema.Struct({
  team_key: Schema.String,
  felo_score: NullableString,
  weekly_change: NullableInt,
  current_tier: NullableString,
  current_tier_numeric: NullableInt,
  managers: Schema.optional(Schema.Record(Schema.String, FeloManagerPayload)),
});

const FeloPayload = Schema.Struct({
  service: Schema.Struct({
    league_key: Schema.String,
    felo_average: NullableString,
    weekly_change: NullableInt,
    current_tier: NullableString,
    current_tier_numeric: NullableInt,
    teams: Schema.Record(Schema.String, FeloTeamPayload),
  }),
});

const TradePartnersPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: Schema.String,
    recommended_trade_partners: Schema.optional(
      Schema.Array(
        Schema.Struct({
          recommended_trade_partner: Schema.Struct({ team_key: Schema.String }),
        }),
      ),
    ),
  }),
});

const DraftPickPayload = Schema.Struct({
  pick: Schema.Struct({
    round: IntFromStringOrNumber,
    cost: IntFromStringOrNumber,
    pick: IntFromStringOrNumber,
  }),
});

const TeamAnalysisPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: Schema.String,
    teams: Schema.Array(
      Schema.Struct({
        team: Schema.Struct({
          team_key: Schema.String,
          name: Schema.String,
          available_draft_picks: Schema.optional(
            Schema.Struct({ picks: Schema.Array(DraftPickPayload) }),
          ),
          positional_ranks: Schema.optional(Schema.Array(Schema.Unknown)),
        }),
      }),
    ),
  }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
