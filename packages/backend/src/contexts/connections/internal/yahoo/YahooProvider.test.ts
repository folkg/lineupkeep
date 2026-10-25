import { assert, it } from "@effect/vitest";
import type { Tracer } from "effect";
import { Cause, Effect, Exit, Layer, Redacted, Tracer as EffectTracer } from "effect";

import {
  ProviderCrumbUnavailable,
  ProviderGateway,
  ProviderRequestFailed,
  ProviderResponseInvalid,
  ProviderSessionRejected,
} from "#contexts/connections/Provider.ts";
import { PublicInternet } from "#runtime/PublicInternet.ts";
import type { PublicInternetOptions } from "#runtime/PublicInternet.ts";

import { YahooProvider } from "./YahooProvider.ts";

it.effect("validates a session with one exact read request", () => {
  const internet = recordingInternet((request) =>
    request.url.pathname === "/fantasy/v2/users;use_login=1"
      ? jsonResponse(rawSession)
      : jsonResponse({}, 404),
  );
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    yield* provider.validateSession(sessionInput);

    const call = internet.calls[0];
    if (call === undefined) {
      return yield* Effect.die("expected a provider request");
    }
    assert.strictEqual(
      call.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/users;use_login=1?format=json",
    );
    assert.strictEqual(call.method, "GET");
    assert.strictEqual(call.headers["accept"], "application/json");
    assert.strictEqual(call.headers["cookie"], Redacted.value(sessionInput.session));
    assert.isNull(call.body);
    assert.deepStrictEqual(call.options, {
      timeoutMs: 30_000,
      maxResponseBytes: 4_194_304,
    });
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("discovers both supported leagues with exact batches and stable team identity", () => {
  const internet = recordingInternet((request) =>
    request.url.pathname.includes("game_keys=nhl")
      ? jsonResponse(rawNhlTeams)
      : jsonResponse(rawNflTeams),
  );
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const teams = yield* provider.discoverTeams(sessionInput);

    assert.deepStrictEqual(
      internet.calls.map((call) => call.url.href),
      [
        "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/users;use_login=1/games;game_keys=nfl/teams?format=json",
        "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/users;use_login=1/games;game_keys=nhl/teams?format=json",
      ],
    );
    assert.deepStrictEqual(teams, [
      {
        provider: "yahoo",
        providerTeamKey: "461.l.1000.t.1",
        providerLeagueKey: "461.l.1000",
        league: "nfl",
        sport: "football",
        season: 2026,
        name: "Alpha",
      },
      {
        provider: "yahoo",
        providerTeamKey: "461.l.1000.t.2",
        providerLeagueKey: "461.l.1000",
        league: "nfl",
        sport: "football",
        season: 2026,
        name: "Beta",
      },
      {
        provider: "yahoo",
        providerTeamKey: "465.l.2000.t.9",
        providerLeagueKey: "465.l.2000",
        league: "nhl",
        sport: "hockey",
        season: 2026,
        name: "Gamma",
      },
    ]);
    assert.isTrue(internet.calls.every((call) => call.options?.timeoutMs === 30_000));
    assert.isTrue(internet.calls.every((call) => call.options?.maxResponseBytes === 4_194_304));
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("reads a redacted crumb from the fixed service origin", () => {
  const internet = recordingInternet(() =>
    jsonResponse({ service: { "xml:lang": "en-US", crumb: "canary-crumb-value" } }),
  );
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const result = yield* provider.readCrumb(sessionInput);

    assert.strictEqual(Redacted.value(result.crumb), "canary-crumb-value");
    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api.fantasysports.yahoo.com/fantasy/v3/getCrumb?format=json_f",
    );
    assert.strictEqual(internet.calls[0]?.headers["cookie"], Redacted.value(sessionInput.session));
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("rejects rejected sessions without exposing the cookie or response body", () => {
  const internet = recordingInternet(() => new Response("private-provider-body", { status: 401 }));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const error = yield* Effect.flip(provider.validateSession(sessionInput));

    assert.instanceOf(error, ProviderSessionRejected);
    assert.notInclude(String(error), Redacted.value(sessionInput.session));
    assert.notInclude(String(error), "private-provider-body");
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("cancels a rejected response body inside the request scope", () => {
  let cancelled = false;
  const internet = recordingInternet(
    () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("private-provider-body"));
          },
          cancel() {
            cancelled = true;
          },
        }),
        { status: 403 },
      ),
  );
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    yield* Effect.flip(provider.validateSession(sessionInput));

    assert.isTrue(cancelled);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect.each([
  { name: "an error envelope", body: { error: { description: "private-provider-body" } } },
  {
    name: "a missing games collection",
    body: { fantasy_content: { users: { "0": { user: [{ guid: "SYNTHETICGUID" }] }, count: 1 } } },
  },
  {
    name: "a non-collection teams field",
    body: {
      fantasy_content: {
        users: {
          "0": { user: [{ games: { "0": { game: [{ season: 2026, teams: "wrong" }] } } }] },
          count: 1,
        },
      },
    },
  },
])("rejects $name without exposing provider content", ({ body }) => {
  const internet = recordingInternet(() => jsonResponse(body));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const error = yield* Effect.flip(provider.discoverTeams(sessionInput));

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.notInclude(String(error), "private-provider-body");
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("rejects discovery when the provider returns no session user", () => {
  const internet = recordingInternet(() =>
    jsonResponse({ fantasy_content: { users: { count: 0 } } }),
  );
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const error = yield* Effect.flip(provider.discoverTeams(sessionInput));

    assert.instanceOf(error, ProviderSessionRejected);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("rejects redirects through PublicInternet", () => {
  const internet = PublicInternet.fromTransport(() =>
    Promise.resolve(
      new Response(null, { status: 302, headers: { location: "https://evil.test" } }),
    ),
  );
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const error = yield* Effect.flip(provider.validateSession(sessionInput));

    assert.instanceOf(error, ProviderRequestFailed);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet))));
});

it.effect("reports a missing crumb as a typed unavailable failure", () => {
  const internet = recordingInternet(() =>
    jsonResponse({ service: { "xml:lang": "en-US", crumb: null } }),
  );
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const error = yield* Effect.flip(provider.readCrumb(sessionInput));

    assert.instanceOf(error, ProviderCrumbUnavailable);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("keeps cookies, crumbs, and raw payloads out of spans", () => {
  const spans: Array<Tracer.NativeSpan> = [];
  const tracer = EffectTracer.make({
    span(options) {
      const span = new EffectTracer.NativeSpan(options);
      spans.push(span);
      return span;
    },
  });
  const internet = PublicInternet.fromTransport(() =>
    Promise.resolve(new Response("private-provider-body", { status: 401 })),
  );
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    yield* Effect.exit(provider.validateSession(sessionInput));

    const exported = spans
      .flatMap((span) => [
        span.name,
        ...[...span.attributes].flat().map(String),
        span.status._tag === "Ended" && Exit.isFailure(span.status.exit)
          ? Cause.pretty(span.status.exit.cause)
          : "",
      ])
      .join("\n");
    assert.include(spans.map((span) => span.name).join("\n"), "YahooProvider.validateSession");
    for (const secret of [
      Redacted.value(sessionInput.session),
      "private-provider-body",
      "canary-crumb-value",
    ]) {
      assert.notInclude(exported, secret);
    }
    assert.isTrue(spans.some((span) => span.attributes.has("server.address")));
  }).pipe(
    Effect.provide(YahooProvider.pipe(Layer.provide(internet))),
    Effect.withSpan("provider.test"),
    Effect.withTracer(tracer),
  );
});

type RecordedRequest = {
  readonly url: URL;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | null;
  readonly options: PublicInternetOptions | undefined;
};

function recordingInternet(respond: (request: RecordedRequest) => Response): {
  readonly calls: Array<RecordedRequest>;
  readonly layer: Layer.Layer<PublicInternet>;
} {
  const calls: Array<RecordedRequest> = [];
  return {
    calls,
    layer: Layer.succeed(PublicInternet)({
      request: (request, options) =>
        Effect.sync(() => {
          const recorded: RecordedRequest = {
            url: new URL(request.url),
            method: request.method,
            headers: Object.fromEntries(request.headers.entries()),
            body: null,
            options,
          };
          calls.push(recorded);
          return respond(recorded);
        }),
    }),
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

const sessionInput = {
  provider: "yahoo" as const,
  session: Redacted.make("A1=canary-cookie-value; A3=another-cookie-value"),
};

const rawSession = {
  fantasy_content: {
    users: {
      "0": { user: [{ guid: "SYNTHETICGUID" }] },
      count: 1,
    },
  },
};

const rawNflTeams = teamPayload("461", "nfl", [
  { key: "461.l.1000.t.1", name: "Alpha" },
  { key: "461.l.1000.t.2", name: "Beta" },
]);

const rawNhlTeams = teamPayload("465", "nhl", [{ key: "465.l.2000.t.9", name: "Gamma" }]);

function teamPayload(
  gameKey: string,
  code: "nfl" | "nhl",
  teams: ReadonlyArray<{ readonly key: string; readonly name: string }>,
): unknown {
  return {
    fantasy_content: {
      users: {
        "0": {
          user: [
            { guid: "SYNTHETICGUID" },
            {
              games: {
                "0": {
                  game: [
                    {
                      game_key: gameKey,
                      game_id: gameKey,
                      name: code === "nfl" ? "Football" : "Hockey",
                      code,
                      type: "full",
                      url: `https://${code === "nfl" ? "football" : "hockey"}.fantasysports.yahoo.com/f1/${gameKey}`,
                      season: "2026",
                      is_registration_over: 1,
                      is_game_over: 0,
                      is_offseason: 1,
                      is_live_draft_lobby_active: 0,
                    },
                    {
                      teams: {
                        ...Object.fromEntries(
                          teams.map((team, index) => [
                            String(index),
                            {
                              team: [
                                [
                                  { team_key: team.key },
                                  { team_id: team.key.slice(team.key.lastIndexOf(".t.") + 3) },
                                  { name: team.name },
                                  { is_owned_by_current_login: 1 },
                                  {
                                    team_logos: [
                                      { team_logo: { size: "large", url: "https://s.yimg.com" } },
                                    ],
                                  },
                                  [],
                                  {
                                    managers: [
                                      { manager: { manager_id: "1", is_current_login: "1" } },
                                    ],
                                  },
                                  [],
                                ],
                                [],
                              ],
                            },
                          ]),
                        ),
                        count: teams.length,
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
  };
}
