import type { BackendPlatform } from "@lineupkeep/backend/runtime/BackendPlatform";
import { BackendRuntime as Runtime } from "@lineupkeep/backend/runtime/BackendRuntime";
import { PublicInternet } from "@lineupkeep/backend/runtime/PublicInternet";

export const BackendRuntime = {
  make: (platform: BackendPlatform) =>
    Runtime.make({
      ...platform,
      publicInternet: PublicInternet.fromTransport((request) => {
        if (request.url === "https://connections-client.test/client.json") {
          return Promise.resolve(
            Response.json({
              client_id: request.url,
              client_name: "Lineupkeep test client",
              redirect_uris: ["http://127.0.0.1:19999/callback"],
              grant_types: ["authorization_code", "refresh_token"],
              response_types: ["code"],
              token_endpoint_auth_method: "none",
            }),
          );
        }
        const yahoo = yahooResponse(new URL(request.url));
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
  if (url.origin !== "https://pub-api-ro.fantasysports.yahoo.com") {
    if (
      url.origin === "https://pub-api.fantasysports.yahoo.com" &&
      url.pathname === "/fantasy/v3/getCrumb"
    ) {
      return { service: { crumb: "e2e-fake-crumb" } };
    }
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
  const roster =
    /^\/fantasy\/v2\/team\/([^/]+)\/roster(?:;week=\d+)?\/players(?:;out=[^/]*)?$/u.exec(
      url.pathname,
    );
  if (roster !== null && roster[1] !== undefined) {
    return rosterPayload(roster[1]);
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
