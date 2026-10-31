import {
  Cause,
  Clock,
  Config,
  Duration,
  Effect,
  Layer,
  Option,
  Redacted,
  Ref,
  Schema,
} from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";

const metadataTokenPath = "/computeMetadata/v1/instance/service-accounts/default/token";
const defaultMetadataHost = "metadata.google.internal";
const tokenTimeout = Duration.seconds(5);
const tokenRefreshMarginMillis = 60_000;

export function telemetryHttpClientLayer(options: {
  readonly googleCloud: boolean;
}): Layer.Layer<HttpClient.HttpClient> {
  if (!options.googleCloud) {
    return FetchHttpClient.layer;
  }
  return Layer.effect(
    HttpClient.HttpClient,
    Effect.flatMap(HttpClient.HttpClient, googleCloudTelemetryClient),
  ).pipe(Layer.provide(FetchHttpClient.layer));
}

export function googleCloudTelemetryClient(
  client: HttpClient.HttpClient,
): Effect.Effect<HttpClient.HttpClient> {
  return Effect.map(Ref.make<TokenCache>(Option.none()), (cache) =>
    HttpClient.mapRequestEffect(client, (request) =>
      accessToken(client, cache).pipe(
        Effect.map((token) =>
          HttpClientRequest.setHeaders(request, {
            authorization: `Bearer ${Redacted.value(token)}`,
          }),
        ),
        Effect.mapError(
          (cause) =>
            new HttpClientError.HttpClientError({
              reason: new HttpClientError.TransportError({ request, cause }),
            }),
        ),
      ),
    ),
  );
}

function accessToken(
  client: HttpClient.HttpClient,
  cache: Ref.Ref<TokenCache>,
): Effect.Effect<Redacted.Redacted<string>, TokenFailure> {
  return Effect.gen(function* () {
    const cached = yield* Ref.get(cache);
    const now = yield* Clock.currentTimeMillis;
    if (Option.isSome(cached) && cached.value.expiresAt > now) {
      return cached.value.token;
    }
    const token = yield* fetchAccessToken(client);
    yield* Ref.set(cache, Option.some(token));
    return token.token;
  });
}

function fetchAccessToken(client: HttpClient.HttpClient): Effect.Effect<CachedToken, TokenFailure> {
  return Effect.gen(function* () {
    const host = yield* Config.option(Config.String("GCE_METADATA_HOST"));
    const response = yield* client.get(
      `http://${Option.getOrElse(host, () => defaultMetadataHost)}${metadataTokenPath}`,
      { headers: { "metadata-flavor": "Google" } },
    );
    const body = yield* HttpClientResponse.schemaBodyJson(MetadataToken)(response);
    const now = yield* Clock.currentTimeMillis;
    return {
      token: Redacted.make(body.access_token),
      expiresAt: now + body.expires_in * 1000 - tokenRefreshMarginMillis,
    };
  }).pipe(Effect.withTracerEnabled(false), Effect.timeout(tokenTimeout));
}

const MetadataToken = Schema.Struct({
  access_token: Schema.String,
  expires_in: Schema.Finite,
});

type TokenFailure =
  | Config.ConfigError
  | HttpClientError.HttpClientError
  | Schema.SchemaError
  | Cause.TimeoutError;

type TokenCache = Option.Option<CachedToken>;

type CachedToken = {
  readonly token: Redacted.Redacted<string>;
  readonly expiresAt: number;
};
