import type { BackendPlatform } from "@lineupkeep/backend/runtime/BackendPlatform";
import { BackendRuntime as Runtime } from "@lineupkeep/backend/runtime/BackendRuntime";
import { PublicInternet } from "@lineupkeep/backend/runtime/PublicInternet";

import transactionRefusal from "#repo/packages/backend/src/contexts/connections/fixtures/yahoo-transaction-refusal-2026-11-03.json";

export const BackendRuntime = {
  make: (platform: BackendPlatform) =>
    Runtime.make({
      ...platform,
      publicInternet: PublicInternet.fromTransport((request) => {
        if (request.url === "https://connections-client.test/client.json") {
          return Promise.resolve(
            Response.json({
              client_id: request.url,
              client_name: "Lineupgrade test client",
              redirect_uris: ["http://127.0.0.1:19999/callback"],
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              token_endpoint_auth_method: "none",
            }),
          );
        }
        const yahoo = yahooResponse(new URL(request.url));
        if (yahoo instanceof Response) {
          return Promise.resolve(yahoo);
        }
        if (yahoo !== undefined) {
          return Promise.resolve(Response.json(yahoo));
        }
        return Promise.reject(
          new Error("E2E_TEST_COMPOSITION_DO_NOT_DEPLOY: unknown metadata resource"),
        );
      }),
    }),
};

function yahooResponse(url: URL): unknown {
  if (url.origin === "https://pub-api.fantasysports.yahoo.com") {
    return url.pathname === "/fantasy/v3/getCrumb"
      ? { service: { crumb: "e2e-fake-crumb" } }
      : undefined;
  }
  if (url.origin === "https://pub-api-rw.fantasysports.yahoo.com") {
    if (url.pathname.startsWith("/fantasy/v2/league/") && url.pathname.endsWith("/transactions")) {
      return url.pathname.includes("/465.l.9100/")
        ? new Response(transactionRefusal.response.body, {
            status: transactionRefusal.response.status,
            headers: { "content-type": "application/json" },
          })
        : { fantasy_content: { transaction: { status: "successful" } } };
    }
    if (/^\/fantasy\/v2\/team\/[^/]+\/roster$/u.test(url.pathname)) {
      return { fantasy_content: { roster: { status: "success" } } };
    }
    return undefined;
  }
  if (url.origin !== "https://pub-api-ro.fantasysports.yahoo.com") {
    return undefined;
  }
  if (url.pathname === "/fantasy/v2/users;use_login=1") {
    return sessionPayload();
  }
  const match = /^\/fantasy\/v2\/users;use_login=1\/games;game_keys=(nfl|nhl)\/teams$/u.exec(
    url.pathname,
  );
  const league = match?.[1];
  if (league === "nfl" || league === "nhl") {
    return teamsPayload(league);
  }
  const settings = /^\/fantasy\/v2\/league\/([^/]+)\/settings$/u.exec(url.pathname);
  if (settings?.[1] !== undefined) {
    return leagueSettingsPayload(settings[1]);
  }
  const roster =
    /^\/fantasy\/v2\/team\/([^/]+)\/roster(?:;week=\d+)?\/players(?:;out=[^/]*)?$/u.exec(
      url.pathname,
    );
  if (roster !== null && roster[1] !== undefined) {
    return rosterPayload(roster[1]);
  }
  const pendingTrades =
    /^\/fantasy\/v2\/league\/([^/]+)\/transactions;type=pending_trade;team_key=([^/;]+)$/u.exec(
      url.pathname,
    );
  if (pendingTrades?.[1] !== undefined && pendingTrades[2] !== undefined) {
    return pendingTradesPayload(pendingTrades[1], pendingTrades[2]);
  }
  return undefined;
}

function sessionPayload(): unknown {
  return {
    fantasy_content: {
      "xml:lang": "en-US",
      "yahoo:uri": "/fantasy/v2/users;use_login=1",
      users: {
        "0": { user: [{ guid: "E2E-USER" }] },
        count: 1,
      },
    },
  };
}

function rosterPayload(teamKey: string): unknown {
  const leagueKey = teamKey.slice(0, teamKey.lastIndexOf(".t."));
  const game = leagueKey.split(".")[0] ?? "461";
  return {
    fantasy_content: {
      team: [
        { team_key: teamKey, team_id: "1", name: "Synthetic Team" },
        {
          roster: {
            "0": {
              players: {
                "0": {
                  player: [
                    [
                      { player_key: `${game}.p.90001` },
                      { player_id: "90001" },
                      {
                        name: { full: "Riverside Receiver", first: "Riverside", last: "Receiver" },
                      },
                      { editorial_team_abbr: "SEA" },
                      { display_position: "WR" },
                      { position_type: "O" },
                      { primary_position: "WR" },
                      { eligible_positions: { "0": { position: "WR" }, count: 1 } },
                      { opponent: "SEA" },
                      {
                        starting_status: {
                          "0": { coverage_type: "week", week: "6" },
                          "1": { is_starting: 1 },
                          count: 2,
                        },
                      },
                      { is_undroppable: "0" },
                      { transactions: { total: "40", adds: "37", drops: "3", trades: "0" } },
                    ],
                    {
                      selected_position: [
                        { coverage_type: "week", week: "6" },
                        { position: "WR" },
                        { is_flex: 0 },
                      ],
                    },
                    { is_editable: "1" },
                  ],
                },
                "1": {
                  player: [
                    [
                      { player_key: `${game}.p.90002` },
                      { player_id: "90002" },
                      { name: { full: "Harbor Back", first: "Harbor", last: "Back" } },
                      { editorial_team_abbr: "SF" },
                      { display_position: "RB" },
                      { position_type: "O" },
                      { primary_position: "RB" },
                      { eligible_positions: { "0": { position: "RB" }, count: 1 } },
                      { opponent: null },
                      { status: "Q" },
                      { status_full: "Questionable" },
                      { injury_note: "Synthetic injury note" },
                      { is_undroppable: "0" },
                    ],
                    {
                      selected_position: [
                        { coverage_type: "week", week: "6" },
                        { position: "BN" },
                        { is_flex: 0 },
                      ],
                    },
                    { is_editable: "0" },
                  ],
                },
                count: 2,
              },
            },
            coverage_type: "week",
            week: 6,
            is_prescoring: 0,
            is_editable: 1,
          },
        },
      ],
    },
  };
}

function pendingTradesPayload(leagueKey: string, teamKey: string): unknown {
  const game = leagueKey.split(".")[0] ?? "461";
  const rivalKey = `${leagueKey}.t.1`;
  return {
    fantasy_content: {
      league: [
        {
          league_key: leagueKey,
          league_id: leagueKey.slice(leagueKey.lastIndexOf(".l.") + 3),
          name: "Synthetic League",
          url: "https://hockey.fantasysports.yahoo.com/hockey/9100",
        },
        {
          transactions: {
            "0": {
              transaction: [
                {
                  transaction_key: `${leagueKey}.pt.7`,
                  type: "pending_trade",
                  status: "proposed",
                  trader_team_key: rivalKey,
                  trader_team_name: "Synthetic Rival",
                  tradee_team_key: teamKey,
                  tradee_team_name: "Hosted Hockey Team",
                  trade_proposed_time: "1791000000",
                  tradee_unused_roster_spots: "0",
                  current_login_can_respond: "1",
                  trade_roster_reflect_key: `${leagueKey}.tr.1`,
                  trade_note: "An offer for the hosted team.",
                },
                {
                  picks: [
                    {
                      pick: {
                        source_team_key: rivalKey,
                        source_team_name: "Synthetic Rival",
                        destination_team_key: teamKey,
                        destination_team_name: "Hosted Hockey Team",
                        original_team_key: teamKey,
                        original_team_name: "Hosted Hockey Team",
                        round: "3",
                      },
                    },
                  ],
                },
                {
                  players: {
                    "0": {
                      player: [
                        [
                          { player_key: `${game}.p.95001` },
                          { player_id: "95001" },
                          {
                            name: {
                              full: "Synthetic Incoming",
                              first: "Synthetic",
                              last: "Incoming",
                            },
                          },
                          { editorial_team_abbr: "SYN" },
                          { display_position: "C" },
                          { position_type: "O" },
                        ],
                        {
                          transaction_data: {
                            type: "pending_trade",
                            source_type: "team",
                            source_team_key: rivalKey,
                            source_team_name: "Synthetic Rival",
                            destination_type: "team",
                            destination_team_key: teamKey,
                            destination_team_name: "Hosted Hockey Team",
                          },
                        },
                      ],
                    },
                    count: 1,
                  },
                },
              ],
            },
            count: 1,
          },
        },
      ],
    },
  };
}

function teamsPayload(league: "nfl" | "nhl"): unknown {
  const teamKey = league === "nfl" ? "461.l.9000.t.1" : "465.l.9100.t.2";
  const name = league === "nfl" ? "Embedded Browser Team" : "Hosted Hockey Team";
  return {
    fantasy_content: {
      users: {
        "0": {
          user: {
            games: {
              "0": {
                game: [
                  { game_key: league === "nfl" ? "461" : "465", code: league, season: 2026 },
                  {
                    teams: {
                      "0": { team: { team_key: teamKey, name } },
                      count: 1,
                    },
                  },
                ],
              },
              count: 1,
            },
          },
        },
        count: 1,
      },
    },
  };
}

function leagueSettingsPayload(leagueKey: string): unknown {
  const teamKey = leagueKey === "461.l.9000" ? "461.l.9000.t.1" : "465.l.9100.t.2";
  return {
    fantasy_content: {
      league: [
        {
          league_key: leagueKey,
          name: leagueKey === "461.l.9000" ? "Embedded Football League" : "Hosted Hockey League",
          url:
            leagueKey === "461.l.9000"
              ? "https://football.fantasysports.yahoo.com/f1/9000"
              : "https://hockey.fantasysports.yahoo.com/hockey/9100",
          num_teams: 10,
          current_week: 6,
          start_week: 1,
          end_week: 17,
          start_date: "2026-09-03",
          end_date: "2026-12-28",
          current_date: "2026-10-31",
          scoring_type: "head",
          scoring_label: "H2H",
          weekly_deadline: "",
          edit_key: "42",
          season: "2026",
          draft_status: "postdraft",
        },
        {
          settings: [
            {
              waiver_type: "FR",
              waiver_rule: "continuous",
              uses_faab: "0",
              roster_positions: [
                {
                  roster_position: {
                    position: "WR",
                    position_type: "O",
                    count: 2,
                    is_starting_position: 1,
                  },
                },
                {
                  roster_position: {
                    position: "BN",
                    position_type: "B",
                    count: 8,
                    is_starting_position: 0,
                  },
                },
              ],
              stat_categories: {
                stats: [
                  {
                    stat: {
                      stat_id: 4,
                      enabled: "1",
                      name: "Receiving Yards",
                      display_name: "Rec Yds",
                      group: "receiving",
                      abbr: "RECY",
                    },
                  },
                ],
              },
            },
          ],
          count: 1,
          team_key: teamKey,
        },
      ],
    },
  };
}
