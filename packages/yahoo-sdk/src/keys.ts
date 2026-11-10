import { Schema } from "effect";

export const YahooLeagueKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u)),
);
export type YahooLeagueKey = typeof YahooLeagueKey.Type;

export const YahooTeamKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u)),
);
export type YahooTeamKey = typeof YahooTeamKey.Type;

export const YahooPlayerKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9]+\.p\.[0-9]+$/u)),
);
export type YahooPlayerKey = typeof YahooPlayerKey.Type;

export const YahooTransactionKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.(?:tr|pt)\.[0-9]+$/u)),
);
export type YahooTransactionKey = typeof YahooTransactionKey.Type;

export const YahooPendingTradeKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.pt\.[0-9]+$/u)),
);
export type YahooPendingTradeKey = typeof YahooPendingTradeKey.Type;

export const YahooGameKey = Schema.Literals(["nfl", "nhl", "nba", "mlb"]);
export type YahooGameKey = typeof YahooGameKey.Type;

export const allYahooGameKeys = ["nfl", "nhl", "nba", "mlb"] as const;

export const YahooGameKeys = Schema.Array(YahooGameKey).pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(4)),
  Schema.check(
    Schema.makeFilter(
      (gameKeys: ReadonlyArray<YahooGameKey>) => new Set(gameKeys).size === gameKeys.length,
    ),
  ),
);
export type YahooGameKeys = typeof YahooGameKeys.Type;

export const YahooDate = Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)));
export type YahooDate = typeof YahooDate.Type;

export const YahooWeek = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(99),
);
export type YahooWeek = typeof YahooWeek.Type;

export const YahooDraftPickRound = Schema.Struct({
  round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(99)),
});
export type YahooDraftPickRound = typeof YahooDraftPickRound.Type;

export const YahooCoverage = Schema.Union([
  Schema.Struct({ type: Schema.Literal("week"), week: YahooWeek }),
  Schema.Struct({ type: Schema.Literal("date"), date: YahooDate }),
]);
export type YahooCoverage = typeof YahooCoverage.Type;

export const YahooLineupSlot = Schema.String.pipe(
  Schema.check(Schema.isMaxLength(16)),
  Schema.check(Schema.isPattern(/^[A-Za-z0-9/+_-]+$/u)),
);
export type YahooLineupSlot = typeof YahooLineupSlot.Type;

export function leagueKeyOfTeam(teamKey: YahooTeamKey): YahooLeagueKey {
  return teamKey.slice(0, teamKey.lastIndexOf(".t."));
}

export function sameCoverage(left: YahooCoverage, right: YahooCoverage): boolean {
  return left.type === "week" && right.type === "week"
    ? left.week === right.week
    : left.type === "date" && right.type === "date"
      ? left.date === right.date
      : false;
}

export const yahooPlayerKeyPattern = /^[0-9]+\.p\.[0-9]+$/u;

export const yahooTransactionKeyPattern = /^[0-9]+\.l\.[0-9]+\.(?:tr|pt)\.[0-9]+$/u;

export const yahooPendingTradeKeyPattern = /^[0-9]+\.l\.[0-9]+\.pt\.[0-9]+$/u;

export const yahooLineupSlotPattern = /^[A-Za-z0-9/+_-]{1,16}$/u;
