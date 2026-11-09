import { Effect, Schema } from "effect";

import {
  IntFromStringOrNumber,
  decodePayload,
  optionalNonEmpty,
  timestampIso,
} from "#yahoo/decode.ts";
import { YahooParseError } from "#yahoo/errors.ts";
import type { YahooLeagueKey } from "#yahoo/keys.ts";

export function decodeTransactions(
  payload: unknown,
  requestedLeagueKey: YahooLeagueKey,
): Effect.Effect<ReadonlyArray<YahooTransaction>, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(TransactionsPayload, payload, "read_transactions");
    if (decoded.league.league_key !== requestedLeagueKey) {
      return yield* new YahooParseError({
        operation: "read_transactions",
        field: "league.league_key",
      });
    }
    const transactions: Array<YahooTransaction> = [];
    for (const transaction of decoded.league.transactions) {
      transactions.push({
        transactionKey: optionalNonEmpty(transaction.transaction_key),
        occurredAt: yield* timestampIso(
          transaction.timestamp,
          "read_transactions",
          "transactions.timestamp",
        ),
        type: transactionTypeOf(transaction.type),
        status: optionalNonEmpty(transaction.status),
        proposer: teamOf(transaction.trader_team_key, transaction.trader_team_name),
        receiver: teamOf(transaction.tradee_team_key, transaction.tradee_team_name),
        players: (transaction.players ?? []).map(playerOf),
        picks: (transaction.picks ?? []).map(pickOf),
      });
    }
    return transactions;
  });
}

export function decodePendingTrades(
  payload: unknown,
  requestedLeagueKey: YahooLeagueKey,
): Effect.Effect<ReadonlyArray<YahooPendingTrade>, YahooParseError> {
  return Effect.gen(function* () {
    const decoded = yield* decodePayload(PendingTradesPayload, payload, "read_pending_trades");
    if (decoded.league.league_key !== requestedLeagueKey) {
      return yield* new YahooParseError({
        operation: "read_pending_trades",
        field: "league.league_key",
      });
    }
    const offers: Array<YahooPendingTrade> = [];
    for (const transaction of decoded.league.transactions) {
      if (transaction.type !== "pending_trade") {
        return yield* new YahooParseError({
          operation: "read_pending_trades",
          field: "transactions.type",
        });
      }
      const proposer = teamOf(transaction.trader_team_key, transaction.trader_team_name);
      const receiver = teamOf(transaction.tradee_team_key, transaction.tradee_team_name);
      for (const team of [proposer, receiver]) {
        if (
          team !== undefined &&
          team.teamKey.slice(0, team.teamKey.lastIndexOf(".t.")) !== requestedLeagueKey
        ) {
          return yield* new YahooParseError({
            operation: "read_pending_trades",
            field: "transactions.team_key",
          });
        }
      }
      offers.push({
        transactionKey: transaction.transaction_key,
        proposedAt: yield* timestampIso(
          transaction.trade_proposed_time,
          "read_pending_trades",
          "transactions.trade_proposed_time",
        ),
        note: optionalNonEmpty(transaction.trade_note),
        canRespond: transaction.current_login_can_respond,
        proposer,
        receiver,
        unusedRosterSpots: transaction.tradee_unused_roster_spots,
        players: (transaction.players ?? []).map(playerOf),
        picks: (transaction.picks ?? []).map(pickOf),
      });
    }
    return offers;
  });
}

function playerOf(player: typeof TransactionPlayerPayload.Type): YahooTransactionPlayer {
  return {
    playerKey: player.player_key,
    name: optionalNonEmpty(player.name?.full),
    primaryPosition: optionalNonEmpty(player.primary_position),
    displayPosition: optionalNonEmpty(player.display_position),
    proTeamAbbreviation: optionalNonEmpty(player.editorial_team_abbr),
    eligiblePositions:
      player.eligible_positions === undefined
        ? undefined
        : player.eligible_positions.map(({ position }) => position),
    movement: {
      kind: movementKindOf(player.transaction_data.type),
      from: teamOf(
        player.transaction_data.source_team_key,
        player.transaction_data.source_team_name,
      ),
      to: teamOf(
        player.transaction_data.destination_team_key,
        player.transaction_data.destination_team_name,
      ),
    },
  };
}

function pickOf(pick: typeof TransactionPickPayload.Type): YahooTransactionPick {
  return {
    round: pick.pick.round,
    from: teamOf(pick.pick.source_team_key, pick.pick.source_team_name),
    to: teamOf(pick.pick.destination_team_key, pick.pick.destination_team_name),
    original: teamOf(pick.pick.original_team_key, pick.pick.original_team_name),
  };
}

function teamOf(
  teamKey: string | undefined,
  name: string | undefined,
): YahooTransactionTeam | undefined {
  return teamKey === undefined ? undefined : { teamKey, name: optionalNonEmpty(name) };
}

function transactionTypeOf(type: string): YahooTransactionType {
  switch (type) {
    case "add":
      return "add";
    case "drop":
      return "drop";
    case "add/drop":
      return "add_drop";
    case "trade":
      return "trade";
    default:
      return type.startsWith("commish") ? "commissioner" : "other";
  }
}

function movementKindOf(type: string): YahooTransactionMovement["kind"] {
  switch (type) {
    case "add":
      return "add";
    case "drop":
      return "drop";
    case "trade":
    case "pending_trade":
      return "trade";
    default:
      return "other";
  }
}

export type YahooTransaction = {
  readonly transactionKey?: string;
  readonly occurredAt: string;
  readonly type: YahooTransactionType;
  readonly status?: string;
  readonly proposer?: YahooTransactionTeam;
  readonly receiver?: YahooTransactionTeam;
  readonly players: ReadonlyArray<YahooTransactionPlayer>;
  readonly picks: ReadonlyArray<YahooTransactionPick>;
};

export type YahooPendingTrade = {
  readonly transactionKey: string;
  readonly proposedAt: string;
  readonly note?: string;
  readonly canRespond?: number;
  readonly proposer?: YahooTransactionTeam;
  readonly receiver?: YahooTransactionTeam;
  readonly unusedRosterSpots?: number;
  readonly players: ReadonlyArray<YahooTransactionPlayer>;
  readonly picks: ReadonlyArray<YahooTransactionPick>;
};

export type YahooTransactionType = "add" | "drop" | "add_drop" | "trade" | "commissioner" | "other";

export type YahooTransactionTeam = {
  readonly teamKey: string;
  readonly name?: string;
};

export type YahooTransactionMovement = {
  readonly kind: "add" | "drop" | "trade" | "other";
  readonly from?: YahooTransactionTeam;
  readonly to?: YahooTransactionTeam;
};

export type YahooTransactionPlayer = {
  readonly playerKey: string;
  readonly name?: string;
  readonly primaryPosition?: string;
  readonly displayPosition?: string;
  readonly proTeamAbbreviation?: string;
  readonly eligiblePositions?: ReadonlyArray<string>;
  readonly movement: YahooTransactionMovement;
};

export type YahooTransactionPick = {
  readonly round: number;
  readonly from?: YahooTransactionTeam;
  readonly to?: YahooTransactionTeam;
  readonly original?: YahooTransactionTeam;
};

const TeamKey = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u)),
);

const PlayerKey = Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.p\.[0-9]+$/u)));

const TransactionPlayerPayload = Schema.Struct({
  player_key: PlayerKey,
  name: Schema.optional(Schema.Struct({ full: Schema.optional(Schema.String) })),
  editorial_team_abbr: Schema.optional(Schema.String),
  display_position: Schema.optional(Schema.String),
  primary_position: Schema.optional(Schema.String),
  eligible_positions: Schema.optional(Schema.Array(Schema.Struct({ position: Schema.String }))),
  transaction_data: Schema.Struct({
    type: Schema.NonEmptyString,
    source_type: Schema.optional(Schema.String),
    source_team_key: Schema.optional(TeamKey),
    source_team_name: Schema.optional(Schema.String),
    destination_type: Schema.optional(Schema.String),
    destination_team_key: Schema.optional(TeamKey),
    destination_team_name: Schema.optional(Schema.String),
  }),
});

const TransactionPickPayload = Schema.Struct({
  pick: Schema.Struct({
    round: IntFromStringOrNumber,
    source_team_key: Schema.optional(TeamKey),
    source_team_name: Schema.optional(Schema.String),
    destination_team_key: Schema.optional(TeamKey),
    destination_team_name: Schema.optional(Schema.String),
    original_team_key: Schema.optional(TeamKey),
    original_team_name: Schema.optional(Schema.String),
  }),
});

const TransactionPayload = Schema.Struct({
  transaction_key: Schema.optional(Schema.NonEmptyString),
  type: Schema.NonEmptyString,
  status: Schema.optional(Schema.String),
  timestamp: IntFromStringOrNumber,
  trader_team_key: Schema.optional(TeamKey),
  trader_team_name: Schema.optional(Schema.String),
  tradee_team_key: Schema.optional(TeamKey),
  tradee_team_name: Schema.optional(Schema.String),
  picks: Schema.optional(Schema.Array(TransactionPickPayload)),
  players: Schema.optional(Schema.Array(TransactionPlayerPayload)),
});

const PendingTradePayload = Schema.Struct({
  transaction_key: Schema.String.pipe(
    Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+\.pt\.[0-9]+$/u)),
  ),
  type: Schema.NonEmptyString,
  status: Schema.optional(Schema.String),
  trader_team_key: Schema.optional(TeamKey),
  trader_team_name: Schema.optional(Schema.String),
  tradee_team_key: Schema.optional(TeamKey),
  tradee_team_name: Schema.optional(Schema.String),
  trade_proposed_time: IntFromStringOrNumber,
  tradee_unused_roster_spots: Schema.optional(IntFromStringOrNumber),
  current_login_can_respond: Schema.optional(IntFromStringOrNumber),
  trade_note: Schema.optional(Schema.String),
  picks: Schema.optional(Schema.Array(TransactionPickPayload)),
  players: Schema.optional(Schema.Array(TransactionPlayerPayload)),
});

const TransactionsPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u))),
    transactions: Schema.Array(TransactionPayload),
  }),
});

const PendingTradesPayload = Schema.Struct({
  league: Schema.Struct({
    league_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u))),
    transactions: Schema.Array(PendingTradePayload),
  }),
});
