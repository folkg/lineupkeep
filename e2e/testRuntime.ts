import type { BackendPlatform } from "@lineupkeep/backend/runtime/BackendPlatform";
import { BackendRuntime as Runtime } from "@lineupkeep/backend/runtime/BackendRuntime";
import { PublicInternet } from "@lineupkeep/backend/runtime/PublicInternet";

export const BackendRuntime = {
  make: (platform: BackendPlatform) =>
    Runtime.make({
      ...platform,
      publicInternet: PublicInternet.fromTransport((request) => {
        if (request.url !== "https://connections-client.test/client.json") {
          return Promise.reject(
            new Error("E2E_TEST_COMPOSITION_DO_NOT_DEPLOY: unknown metadata resource"),
          );
        }
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
      }),
    }),
};
