import type {
  YahooCoverage,
  YahooDraftPickRound,
  YahooLineupSlot,
  YahooPendingTradeKey,
  YahooPlayerKey,
  YahooTeamKey,
} from "./keys.ts";

export function nativeActionBody(coverage: YahooCoverage): string {
  return xml(`<roster>${coverageBody(coverage)}<action>start_active_players</action></roster>`);
}

export function assignmentsBody(
  coverage: YahooCoverage,
  assignments: ReadonlyArray<YahooLineupAssignment>,
): string {
  const players = assignments
    .map(
      (assignment) =>
        `<player><player_key>${assignment.playerKey}</player_key><position>${assignment.slot}</position></player>`,
    )
    .join("");
  return xml(`<roster>${coverageBody(coverage)}<players>${players}</players></roster>`);
}

export function reserveMoveBody(
  coverage: YahooCoverage,
  playerKey: YahooPlayerKey,
  slot: YahooLineupSlot,
): string {
  return xml(
    `<roster>${coverageBody(coverage)}<players><player><player_key>${playerKey}</player_key><position>${slot}</position></player></players></roster>`,
  );
}

export function transactionBody(input: {
  readonly teamKey: YahooTeamKey;
  readonly add: YahooPlayerKey | undefined;
  readonly drop: YahooPlayerKey | undefined;
  readonly faabBid: number | undefined;
}): string {
  const players = [
    ...(input.add === undefined ? [] : [transactionPlayerBody(input.add, "add", input.teamKey)]),
    ...(input.drop === undefined ? [] : [transactionPlayerBody(input.drop, "drop", input.teamKey)]),
  ];
  const type =
    input.add !== undefined && input.drop !== undefined
      ? "add/drop"
      : input.add !== undefined
        ? "add"
        : "drop";
  const bid = input.faabBid === undefined ? "" : `<faab_bid>${String(input.faabBid)}</faab_bid>`;
  const roster =
    players.length === 1 ? (players[0] ?? "") : `<players>${players.join("")}</players>`;
  return xml(`<transaction><type>${type}</type>${bid}${roster}</transaction>`);
}

export function tradeProposalBody(input: {
  readonly traderTeamKey: YahooTeamKey;
  readonly tradeeTeamKey: YahooTeamKey;
  readonly send?: ReadonlyArray<YahooPlayerKey>;
  readonly receive?: ReadonlyArray<YahooPlayerKey>;
  readonly sendPicks?: ReadonlyArray<YahooDraftPickRound>;
  readonly receivePicks?: ReadonlyArray<YahooDraftPickRound>;
  readonly note: string;
}): string {
  const players = [
    ...(input.send ?? []).map((key) =>
      tradePlayerBody(key, input.traderTeamKey, input.tradeeTeamKey),
    ),
    ...(input.receive ?? []).map((key) =>
      tradePlayerBody(key, input.tradeeTeamKey, input.traderTeamKey),
    ),
  ];
  const picks = [
    ...(input.sendPicks ?? []).map((pick) =>
      tradePickBody(pick.round, input.traderTeamKey, input.tradeeTeamKey),
    ),
    ...(input.receivePicks ?? []).map((pick) =>
      tradePickBody(pick.round, input.tradeeTeamKey, input.traderTeamKey),
    ),
  ];
  const playersBody = players.length === 0 ? "" : `<players>${players.join("")}</players>`;
  const picksBody = picks.length === 0 ? "" : `<picks>${picks.join("")}</picks>`;
  return xml(
    `<transaction><type>pending_trade</type><trader_team_key>${input.traderTeamKey}</trader_team_key><tradee_team_key>${input.tradeeTeamKey}</tradee_team_key><trade_note>${xmlText(input.note)}</trade_note>${playersBody}${picksBody}</transaction>`,
  );
}

export function tradeResponseBody(input: {
  readonly transactionKey: YahooPendingTradeKey;
  readonly action: "accept" | "reject";
  readonly note: string;
}): string {
  return xml(
    `<transaction><transaction_key>${input.transactionKey}</transaction_key><type>pending_trade</type><action>${input.action}</action><trade_note>${xmlText(input.note)}</trade_note></transaction>`,
  );
}

function transactionPlayerBody(
  playerKey: YahooPlayerKey,
  movement: "add" | "drop",
  teamKey: YahooTeamKey,
): string {
  const team = movement === "add" ? "destination_team_key" : "source_team_key";
  return `<player><player_key>${playerKey}</player_key><transaction_data><type>${movement}</type><${team}>${teamKey}</${team}></transaction_data></player>`;
}

function tradePickBody(
  round: number,
  sourceTeamKey: YahooTeamKey,
  destinationTeamKey: YahooTeamKey,
): string {
  return `<pick><source_team_key>${sourceTeamKey}</source_team_key><destination_team_key>${destinationTeamKey}</destination_team_key><round>${String(round)}</round></pick>`;
}

function tradePlayerBody(
  playerKey: YahooPlayerKey,
  sourceTeamKey: YahooTeamKey,
  destinationTeamKey: YahooTeamKey,
): string {
  return `<player><player_key>${playerKey}</player_key><transaction_data><type>pending_trade</type><source_team_key>${sourceTeamKey}</source_team_key><destination_team_key>${destinationTeamKey}</destination_team_key></transaction_data></player>`;
}

function coverageBody(coverage: YahooCoverage): string {
  return coverage.type === "week"
    ? `<coverage_type>week</coverage_type><week>${String(coverage.week)}</week>`
    : `<coverage_type>date</coverage_type><date>${coverage.date}</date>`;
}

function xml(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><fantasy_content>${content}</fantasy_content>`;
}

function xmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export type YahooLineupAssignment = {
  readonly playerKey: YahooPlayerKey;
  readonly slot: YahooLineupSlot;
};
