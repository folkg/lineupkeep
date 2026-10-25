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
              grant_types: [
                "authorization_code",
                "refresh_token",
                "urn:ietf:params:oauth:grant-type:device_code",
              ],
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
  return undefined;
}

function sessionPayload(): unknown {
  return { fantasy_content: { users: { "0": { user: { guid: "e2e-hosted-user" } }, count: 1 } } };
}

function teamsPayload(league: "nfl" | "nhl"): unknown {
  const teamKey = league === "nfl" ? "nfl.l.9000.t.1" : "nhl.l.9100.t.2";
  const name = league === "nfl" ? "Embedded Browser Team" : "Hosted Hockey Team";
  return {
    fantasy_content: {
      users: {
        "0": {
          user: {
            games: {
              "0": {
                game: [
                  { season: 2026 },
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
