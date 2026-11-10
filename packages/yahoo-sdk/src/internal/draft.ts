import { Effect, Schema } from "effect";

import { IntFromStringOrNumber, decodePayload, optionalNonEmpty } from "#yahoo/decode.ts";
import { YahooParseError } from "#yahoo/errors.ts";
import type { YahooLeagueKey, YahooTeamKey } from "#yahoo/keys.ts";

export function decodeAvailableDraftPicks(
  payload: unknown,
  requestedLeagueKey: YahooLeagueKey,
  requestedTeamKeys: ReadonlyArray<YahooTeamKey>,
): Effect.Effect<ReadonlyArray<YahooAvailableDraftPick>, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(
      AvailableDraftPicksPayload,
      payload,
      "read_available_draft_picks",
    );
    if (decoded.league.league_key !== requestedLeagueKey) {
      return yield* new YahooParseError({
        operation: "read_available_draft_picks",
        field: "league.league_key",
      });
    }
    const requested = new Set(requestedTeamKeys);
    if (
      decoded.league.teams.length !== requestedTeamKeys.length ||
      decoded.league.teams.some((team) => !requested.has(team.team_key))
    ) {
      return yield* new YahooParseError({
        operation: "read_available_draft_picks",
        field: "league.teams",
      });
    }
    return decoded.league.teams.map((team) => ({
      teamKey: team.team_key,
      picks: team.available_draft_picks.picks.map(({ pick }) => ({ round: pick.round })),
    }));
  });
}

export function decodeDraftResults(
  payload: unknown,
  requestedLeagueKey: YahooLeagueKey,
): Effect.Effect<ReadonlyArray<YahooDraftPick>, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(DraftResultsPayload, payload, "read_draft_results");
    if (
      decoded.league.league_key !== requestedLeagueKey ||
      decoded.league.draft_results.some(
        ({ draft_result }) =>
          draft_result.team_key.slice(0, draft_result.team_key.lastIndexOf(".t.")) !==
          requestedLeagueKey,
      )
    ) {
      return yield* new YahooParseError({
        operation: "read_draft_results",
        field: "league.draft_results.team_key",
      });
    }
    return decoded.league.draft_results.map(({ draft_result }) => {
      const name = optionalNonEmpty(draft_result.entries?.[0]?.players?.[0]?.name?.full ?? "");
      return {
        round: draft_result.round,
        pick: draft_result.pick,
        teamKey: draft_result.team_key,
        playerKey: draft_result.player_key,
        ...(name === undefined ? {} : { name }),
      };
    });
  });
}

export type YahooDraftPick = {
  readonly round: number;
  readonly pick: number;
  readonly teamKey: string;
  readonly playerKey: string;
  readonly name?: string;
};

export type YahooAvailableDraftPick = {
  readonly teamKey: string;
  readonly picks: ReadonlyArray<{ readonly round: number }>;
};

const AvailableDraftPicksPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u))),
    teams: Schema.Array(
      Schema.Struct({
        team_key: Schema.String.pipe(
          Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u)),
        ),
        available_draft_picks: Schema.Struct({
          picks: Schema.Array(
            Schema.Struct({ pick: Schema.Struct({ round: IntFromStringOrNumber }) }),
          ),
        }),
      }),
    ),
  }),
});

const DraftResultPlayerPayload = Schema.Struct({
  name: Schema.optional(Schema.Struct({ full: Schema.optional(Schema.String) })),
});

const DraftResultPayload = Schema.Struct({
  draft_result: Schema.Struct({
    round: IntFromStringOrNumber,
    pick: IntFromStringOrNumber,
    team_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u))),
    player_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.p\.[0-9]+$/u))),
    entries: Schema.optional(
      Schema.Array(
        Schema.Struct({
          players: Schema.optional(Schema.Array(DraftResultPlayerPayload)),
        }),
      ),
    ),
  }),
});

const DraftResultsPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u))),
    draft_results: Schema.Array(DraftResultPayload),
  }),
});
