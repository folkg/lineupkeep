import type { BackendPlatform } from "@sourdough/backend/runtime/BackendPlatform";
import { BackendRuntime as Runtime } from "@sourdough/backend/runtime/BackendRuntime";
import { PublicInternet } from "@sourdough/backend/runtime/PublicInternet";

export const BackendRuntime = {
  make: (platform: BackendPlatform) =>
    Runtime.make({
      ...platform,
      publicInternet: PublicInternet.fromTransport((request) => {
        if (request.url !== "https://notes-client.test/client.json") {
          return Promise.reject(
            new Error("E2E_TEST_COMPOSITION_DO_NOT_DEPLOY: unknown metadata resource"),
          );
        }
        return Promise.resolve(
          Response.json({
            client_id: request.url,
            client_name: "Notes test client",
            redirect_uris: ["http://127.0.0.1:19999/callback"],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            token_endpoint_auth_method: "none",
          }),
        );
      }),
    }),
};
