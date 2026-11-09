import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";

export const FetchClient = Layer.merge(
  FetchHttpClient.layer,
  Layer.succeed(FetchHttpClient.RequestInit)({ redirect: "manual" }),
);
