import { assert, it } from "@effect/vitest";

import {
  assignmentsBody,
  nativeActionBody,
  reserveMoveBody,
  tradeProposalBody,
  tradeResponseBody,
  transactionBody,
} from "./xml.ts";

it("writes the native start-active roster action for a week", () => {
  assert.strictEqual(
    nativeActionBody({ type: "week", week: 6 }),
    '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><roster><coverage_type>week</coverage_type><week>6</week><action>start_active_players</action></roster></fantasy_content>',
  );
});

it("writes explicit assignments for a date without an action", () => {
  assert.strictEqual(
    assignmentsBody({ type: "date", date: "2026-10-17" }, [
      { playerKey: "466.p.20001", slot: "QB" },
      { playerKey: "466.p.20002", slot: "BN" },
    ]),
    '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><roster><coverage_type>date</coverage_type><date>2026-10-17</date><players><player><player_key>466.p.20001</player_key><position>QB</position></player><player><player_key>466.p.20002</player_key><position>BN</position></player></players></roster></fantasy_content>',
  );
});

it("writes a reserve-slot move with the player's target position", () => {
  assert.strictEqual(
    reserveMoveBody({ type: "week", week: 6 }, "466.p.20003", "IR"),
    '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><roster><coverage_type>week</coverage_type><week>6</week><players><player><player_key>466.p.20003</player_key><position>IR</position></player></players></roster></fantasy_content>',
  );
});

it("writes an add and drop as one transaction with a FAAB bid", () => {
  assert.strictEqual(
    transactionBody({
      teamKey: "466.l.4000.t.1",
      add: "466.p.20003",
      drop: "466.p.20004",
      faabBid: 12,
    }),
    '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><transaction><type>add/drop</type><faab_bid>12</faab_bid><players><player><player_key>466.p.20003</player_key><transaction_data><type>add</type><destination_team_key>466.l.4000.t.1</destination_team_key></transaction_data></player><player><player_key>466.p.20004</player_key><transaction_data><type>drop</type><source_team_key>466.l.4000.t.1</source_team_key></transaction_data></player></players></transaction></fantasy_content>',
  );
});

it("writes a single drop without a players wrapper", () => {
  assert.strictEqual(
    transactionBody({
      teamKey: "466.l.4000.t.1",
      add: undefined,
      drop: "466.p.20004",
      faabBid: undefined,
    }),
    '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><transaction><type>drop</type><player><player_key>466.p.20004</player_key><transaction_data><type>drop</type><source_team_key>466.l.4000.t.1</source_team_key></transaction_data></player></transaction></fantasy_content>',
  );
});

it("writes two-sided trade movements and escapes the note", () => {
  assert.strictEqual(
    tradeProposalBody({
      traderTeamKey: "466.l.4000.t.1",
      tradeeTeamKey: "466.l.4000.t.2",
      send: ["466.p.20001"],
      receive: ["466.p.20003"],
      note: "A & B <tag> \"x\" 'y'",
    }),
    '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><transaction><type>pending_trade</type><trader_team_key>466.l.4000.t.1</trader_team_key><tradee_team_key>466.l.4000.t.2</tradee_team_key><trade_note>A &amp; B &lt;tag&gt; &quot;x&quot; &apos;y&apos;</trade_note><players><player><player_key>466.p.20001</player_key><transaction_data><type>pending_trade</type><source_team_key>466.l.4000.t.1</source_team_key><destination_team_key>466.l.4000.t.2</destination_team_key></transaction_data></player><player><player_key>466.p.20003</player_key><transaction_data><type>pending_trade</type><source_team_key>466.l.4000.t.2</source_team_key><destination_team_key>466.l.4000.t.1</destination_team_key></transaction_data></player></players></transaction></fantasy_content>',
  );
});

it("writes accept and reject actions for a pending trade", () => {
  assert.strictEqual(
    tradeResponseBody({
      transactionKey: "466.l.4000.pt.9",
      action: "accept",
      note: "Deal & done",
    }),
    '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><transaction><transaction_key>466.l.4000.pt.9</transaction_key><type>pending_trade</type><action>accept</action><trade_note>Deal &amp; done</trade_note></transaction></fantasy_content>',
  );
  assert.strictEqual(
    tradeResponseBody({
      transactionKey: "466.l.4000.pt.9",
      action: "reject",
      note: "",
    }),
    '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><transaction><transaction_key>466.l.4000.pt.9</transaction_key><type>pending_trade</type><action>reject</action><trade_note></trade_note></transaction></fantasy_content>',
  );
});

it("writes a draft-pick-only trade proposal", () => {
  assert.strictEqual(
    tradeProposalBody({
      traderTeamKey: "466.l.4000.t.1",
      tradeeTeamKey: "466.l.4000.t.2",
      sendPicks: [{ round: 1 }],
      receivePicks: [{ round: 2 }],
      note: "",
    }),
    '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><transaction><type>pending_trade</type><trader_team_key>466.l.4000.t.1</trader_team_key><tradee_team_key>466.l.4000.t.2</tradee_team_key><trade_note></trade_note><picks><pick><source_team_key>466.l.4000.t.1</source_team_key><destination_team_key>466.l.4000.t.2</destination_team_key><round>1</round></pick><pick><source_team_key>466.l.4000.t.2</source_team_key><destination_team_key>466.l.4000.t.1</destination_team_key><round>2</round></pick></picks></transaction></fantasy_content>',
  );
});
