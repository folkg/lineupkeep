import { assert, it } from "@effect/vitest";
import type { Tracer } from "effect";
import { Cause, Effect, Exit, Layer, Redacted, Tracer as EffectTracer } from "effect";

import {
  ProviderCrumbUnavailable,
  ProviderGateway,
  ProviderOperationUnsupported,
  ProviderPeriodMismatch,
  ProviderRequestFailed,
  ProviderResponseInvalid,
  ProviderReviewLinkInvalid,
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

it.effect("reads verified league settings with one exact request", () => {
  const internet = recordingInternet(() => jsonResponse(rawLeagueSettings));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const league = yield* provider.readLeague({
      ...sessionInput,
      providerLeagueKey: "461.l.1000",
      sport: "football",
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/461.l.1000/settings?format=json",
    );
    assert.strictEqual(internet.calls[0]?.headers["cookie"], Redacted.value(sessionInput.session));
    assert.deepStrictEqual(league, {
      providerLeagueKey: "461.l.1000",
      name: "Alpha League",
      webUrl: "https://football.fantasysports.yahoo.com/f1/1000",
      season: 2026,
      currentWeek: 3,
      startWeek: 1,
      endWeek: 17,
      startDate: "2026-09-03",
      endDate: "2026-12-28",
      teamCount: 10,
      scoringType: "head",
      scoringLabel: "H2H",
      weeklyDeadline: undefined,
      waiverType: "FR",
      waiverRule: "continuous",
      usesFaab: false,
      draftStatus: "postdraft",
      rosterPositions: [
        {
          position: "QB",
          positionType: "O",
          count: 1,
          isStarting: true,
        },
        {
          position: "BN",
          positionType: "B",
          count: 6,
          isStarting: false,
        },
      ],
      statCategories: [
        {
          statId: 4,
          name: "Passing Yards",
          displayName: "Pass Yds",
          abbreviation: "PY",
          group: "passing",
          enabled: true,
          positionTypes: ["O"],
        },
      ],
      statModifiers: [{ statId: 4, points: "0.04" }],
    });
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("reads a category league that omits stat modifiers", () => {
  const internet = recordingInternet(() => jsonResponse(rawLeagueSettingsWithoutModifiers));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const league = yield* provider.readLeague({
      ...sessionInput,
      providerLeagueKey: "461.l.1000",
      sport: "football",
    });

    assert.deepStrictEqual(league.statModifiers, []);
    assert.strictEqual(league.statCategories.length, 1);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("reads a one-entry stat position type collection", () => {
  const internet = recordingInternet(() => jsonResponse(rawLeagueSettingsWithSinglePositionType));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const league = yield* provider.readLeague({
      ...sessionInput,
      providerLeagueKey: "461.l.1000",
      sport: "football",
    });

    assert.deepStrictEqual(league.statCategories[0]?.positionTypes, ["O"]);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("rejects a league response for another league without exposing the payload", () => {
  const internet = recordingInternet(() =>
    jsonResponse({
      ...rawLeagueSettings.fantasy_content,
      league: [
        { ...rawLeagueAttributes, league_key: "461.l.9999" },
        ...rawLeagueSettings.fantasy_content.league.slice(1),
      ],
    }),
  );
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const error = yield* Effect.flip(
      provider.readLeague({
        ...sessionInput,
        providerLeagueKey: "461.l.1000",
        sport: "football",
      }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.notInclude(String(error), "Alpha League");
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("reads an exact selected week roster with whole verified fields", () => {
  const internet = recordingInternet(() => jsonResponse(rawRoster));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const roster = yield* provider.readRoster({
      ...sessionInput,
      providerTeamKey: "461.l.1000.t.1",
      period: { week: 3 },
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/team/461.l.1000.t.1/roster;week=3?format=json",
    );
    assert.deepStrictEqual(roster.coverage, { type: "week", week: 3 });
    assert.strictEqual(roster.players.length, 2);
    assert.deepStrictEqual(roster.players[0], {
      providerPlayerKey: "461.p.10001",
      name: "Synthetic Player",
      displayPosition: "QB",
      primaryPosition: "QB",
      positionType: "O",
      eligiblePositions: ["QB", "W/R"],
      slot: "QB",
      isFlex: false,
      isEditable: true,
      injuryCode: undefined,
      injuryDetail: undefined,
      byeWeek: 7,
      undroppable: false,
    });
    assert.deepStrictEqual(roster.players[1], {
      providerPlayerKey: "461.p.10002",
      name: "Synthetic Reserve",
      displayPosition: "RB",
      primaryPosition: "RB",
      positionType: "O",
      eligiblePositions: ["RB"],
      slot: "IR",
      isFlex: null,
      isEditable: false,
      injuryCode: "O",
      injuryDetail: "Out for the synthetic test",
      byeWeek: null,
      undroppable: true,
    });
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("reads a roster container that declares its covered week", () => {
  const internet = recordingInternet(() => jsonResponse(rawRosterContainerWithCoverage));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const roster = yield* provider.readRoster({
      ...sessionInput,
      providerTeamKey: "461.l.1000.t.1",
      period: { week: 3 },
    });

    assert.deepStrictEqual(roster.coverage, { type: "week", week: 3 });
    assert.strictEqual(roster.players.length, 1);
    assert.strictEqual(roster.players[0]?.providerPlayerKey, "461.p.10001");
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("rejects a roster whose container and entries disagree on the week", () => {
  const internet = recordingInternet(() => jsonResponse(rawRosterContainerWeekMismatch));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const error = yield* Effect.flip(
      provider.readRoster({
        ...sessionInput,
        providerTeamKey: "461.l.1000.t.1",
        period: undefined,
      }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("reads a date-scoped roster without a weekly claim", () => {
  const internet = recordingInternet(() => jsonResponse(rawDateRoster));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const roster = yield* provider.readRoster({
      ...sessionInput,
      providerTeamKey: "465.l.2000.t.9",
      period: undefined,
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/team/465.l.2000.t.9/roster?format=json",
    );
    assert.deepStrictEqual(roster.coverage, { type: "date", date: "2026-10-25" });
    assert.strictEqual(roster.players[0]?.slot, "G");
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("refuses to relabel a date-scoped roster as a week", () => {
  const internet = recordingInternet(() => jsonResponse(rawDateRoster));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const error = yield* Effect.flip(
      provider.readRoster({
        ...sessionInput,
        providerTeamKey: "465.l.2000.t.9",
        period: { week: 4 },
      }),
    );

    assert.instanceOf(error, ProviderPeriodMismatch);
    assert.strictEqual(error.coveredWeek, null);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("reports a period mismatch instead of relabelling another week", () => {
  const internet = recordingInternet(() => jsonResponse(rawRoster));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const error = yield* Effect.flip(
      provider.readRoster({
        ...sessionInput,
        providerTeamKey: "461.l.1000.t.1",
        period: { week: 4 },
      }),
    );

    assert.instanceOf(error, ProviderPeriodMismatch);
    assert.strictEqual(error.requestedWeek, 4);
    assert.strictEqual(error.coveredWeek, 3);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("rejects an empty roster as an unestablished period", () => {
  const internet = recordingInternet(() =>
    jsonResponse({
      fantasy_content: {
        team: [{ team_key: "461.l.1000.t.1" }, { roster: [{ players: [] }] }],
      },
    }),
  );
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const error = yield* Effect.flip(
      provider.readRoster({
        ...sessionInput,
        providerTeamKey: "461.l.1000.t.1",
        period: undefined,
      }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("searches free agents with one exact request and typed availability", () => {
  const internet = recordingInternet(() => jsonResponse(rawFreeAgents));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const result = yield* provider.searchPlayers({
      ...sessionInput,
      providerLeagueKey: "461.l.1000",
      query: "Synthetic Player",
      availability: "free_agent",
      sort: "ownership",
      limit: 10,
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/461.l.1000/players;status=FA;sort=R_PO;count=10;search=Synthetic%20Player;out=ownership,percent_owned?format=json",
    );
    assert.deepStrictEqual(result.players, [
      {
        providerPlayerKey: "461.p.10001",
        name: "Synthetic Player",
        primaryPosition: "QB",
        displayPosition: "QB",
        eligiblePositions: ["QB", "W/R"],
        availability: "free_agent",
        percentOwned: 42.5,
      },
      {
        providerPlayerKey: "461.p.10002",
        name: "Synthetic Waiver",
        primaryPosition: "RB",
        displayPosition: "RB",
        eligiblePositions: ["RB"],
        availability: "waiver",
        percentOwned: null,
      },
    ]);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("searches waiver players without a query", () => {
  const internet = recordingInternet(() => jsonResponse(rawFreeAgents));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    yield* provider.searchPlayers({
      ...sessionInput,
      providerLeagueKey: "461.l.1000",
      query: undefined,
      availability: "waiver",
      sort: "name",
      limit: 25,
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/461.l.1000/players;status=W;sort=NAME;count=25;out=ownership,percent_owned?format=json",
    );
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("searches the whole player pool without an availability filter", () => {
  const internet = recordingInternet(() => jsonResponse(rawFreeAgents));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    yield* provider.searchPlayers({
      ...sessionInput,
      providerLeagueKey: "461.l.1000",
      query: undefined,
      availability: "all",
      sort: "position",
      limit: 25,
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/461.l.1000/players;sort=NAME;count=25;out=ownership,percent_owned?format=json",
    );
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("rejects an unbounded player search without a request", () => {
  const internet = recordingInternet(() => jsonResponse(rawFreeAgents));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const error = yield* Effect.flip(
      provider.searchPlayers({
        ...sessionInput,
        providerLeagueKey: "461.l.1000",
        query: undefined,
        availability: "all",
        sort: "name",
        limit: 51,
      }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.deepStrictEqual(internet.calls, []);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("reads completed-week player statistics with honest missing values", () => {
  const internet = recordingInternet(() => jsonResponse(rawPlayerDetails));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const details = yield* provider.readPlayerDetails({
      ...sessionInput,
      providerLeagueKey: "461.l.1000",
      providerPlayerKeys: ["461.p.10001"],
      period: { week: 3 },
      currentWeek: 4,
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/461.l.1000/players;player_keys=461.p.10001;out=stats,ownership?format=json&stats.type=week&stats.week=3",
    );
    assert.deepStrictEqual(details, [
      {
        providerPlayerKey: "461.p.10001",
        name: "Synthetic Player",
        primaryPosition: "QB",
        displayPosition: "QB",
        eligiblePositions: ["QB"],
        rosterStatus: "rostered",
        actual: {
          period: { week: 3 },
          stats: [
            { statId: 4, value: 12.5 },
            { statId: 5, value: null },
          ],
        },
        projected: undefined,
      },
    ]);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("does not present an incomplete week as completed statistics", () => {
  const internet = recordingInternet(() => jsonResponse(rawPlayerDetails));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const details = yield* provider.readPlayerDetails({
      ...sessionInput,
      providerLeagueKey: "461.l.1000",
      providerPlayerKeys: ["461.p.10001"],
      period: { week: 3 },
      currentWeek: 3,
    });

    assert.strictEqual(details[0]?.actual, undefined);
    assert.strictEqual(details[0]?.projected, undefined);
    assert.strictEqual(details[0]?.rosterStatus, "rostered");
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("reports player-statistics period mismatch", () => {
  const internet = recordingInternet(() => jsonResponse(rawPlayerDetails));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const error = yield* Effect.flip(
      provider.readPlayerDetails({
        ...sessionInput,
        providerLeagueKey: "461.l.1000",
        providerPlayerKeys: ["461.p.10001"],
        period: { week: 4 },
        currentWeek: 5,
      }),
    );

    assert.instanceOf(error, ProviderPeriodMismatch);
    assert.strictEqual(error.coveredWeek, 3);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("requires a week before reading player statistics", () => {
  const internet = recordingInternet(() => jsonResponse({}));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const error = yield* Effect.flip(
      provider.readPlayerDetails({
        ...sessionInput,
        providerLeagueKey: "461.l.1000",
        providerPlayerKeys: ["461.p.10001"],
        period: undefined,
        currentWeek: 4,
      }),
    );

    assert.instanceOf(error, ProviderOperationUnsupported);
    assert.deepStrictEqual(internet.calls, []);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("reads a league scoreboard for the requested week", () => {
  const internet = recordingInternet(() => jsonResponse(rawMatchups));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const matchups = yield* provider.readMatchups({
      ...sessionInput,
      providerLeagueKey: "461.l.1000",
      period: { week: 3 },
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/461.l.1000/scoreboard;week=3?format=json",
    );
    assert.deepStrictEqual(matchups, [
      {
        period: { week: 3 },
        home: { providerTeamKey: "461.l.1000.t.1", name: "Alpha", points: 101.25 },
        away: { providerTeamKey: "461.l.1000.t.2", name: "Beta", points: 98.5 },
        status: "midevent",
      },
      {
        period: { week: 3 },
        home: { providerTeamKey: "461.l.1000.t.3", name: "Gamma", points: null },
        away: { providerTeamKey: "461.l.1000.t.4", name: "Delta", points: null },
        status: "preevent",
      },
    ]);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("reports a scoreboard period mismatch", () => {
  const internet = recordingInternet(() => jsonResponse(rawMatchups));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const error = yield* Effect.flip(
      provider.readMatchups({
        ...sessionInput,
        providerLeagueKey: "461.l.1000",
        period: { week: 4 },
      }),
    );

    assert.instanceOf(error, ProviderPeriodMismatch);
    assert.strictEqual(error.coveredWeek, 3);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("reads bounded league transaction history", () => {
  const internet = recordingInternet(() => jsonResponse(rawTransactions));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const transactions = yield* provider.readTransactions({
      ...sessionInput,
      providerLeagueKey: "461.l.1000",
      limit: 25,
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/461.l.1000/transactions;count=25?format=json",
    );
    assert.deepStrictEqual(transactions, [
      {
        occurredAt: "2025-10-27T21:20:00.000Z",
        type: "add_drop",
        status: "successful",
        teams: [
          { providerTeamKey: "461.l.1000.t.1", name: "Alpha" },
          { providerTeamKey: "461.l.1000.t.2", name: "Beta" },
        ],
        players: [
          { providerPlayerKey: "461.p.10001", direction: "add" },
          { providerPlayerKey: "461.p.10002", direction: "drop" },
        ],
      },
      {
        occurredAt: "2025-10-27T21:21:40.000Z",
        type: "trade",
        status: undefined,
        teams: [
          { providerTeamKey: "461.l.1000.t.1", name: "Alpha" },
          { providerTeamKey: "461.l.1000.t.2", name: "Beta" },
        ],
        players: [{ providerPlayerKey: "461.p.10003", direction: "incoming" }],
      },
    ]);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect("reads league team membership", () => {
  const internet = recordingInternet(() => jsonResponse(rawLeagueTeams));
  return Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const teams = yield* provider.readLeagueTeams({
      ...sessionInput,
      providerLeagueKey: "461.l.1000",
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/461.l.1000/teams?format=json",
    );
    assert.deepStrictEqual(teams, [
      { providerTeamKey: "461.l.1000.t.1", providerLeagueKey: "461.l.1000", name: "Alpha" },
      { providerTeamKey: "461.l.1000.t.2", providerLeagueKey: "461.l.1000", name: "Beta" },
    ]);
  }).pipe(Effect.provide(YahooProvider.pipe(Layer.provide(internet.layer))));
});

it.effect.each([
  {
    name: "add",
    intent: { kind: "add" as const, add: "461.p.10001" },
    expected: "apid=10001",
  },
  {
    name: "add/drop",
    intent: { kind: "add_drop" as const, add: "461.p.10001", drop: "461.p.10002" },
    expected: "apid=10001&dpid=10002",
  },
  {
    name: "drop",
    intent: { kind: "drop" as const, drop: "461.p.10002" },
    expected: "dpid=10002",
  },
  {
    name: "trade",
    intent: {
      kind: "trade" as const,
      send: ["461.p.10001", "461.p.10003"],
      receive: ["461.p.10002"],
    },
    expected: "apid=10001&apid=10003&dpid=10002",
  },
])("builds a review-only $name link on the exact provider host", ({ intent, expected }) =>
  Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const link = yield* provider.buildReviewLink({
      providerLeagueKey: "461.l.1000",
      leagueWebUrl: "https://football.fantasysports.yahoo.com/f1/1000",
      sport: "football",
      intent,
    });

    const url = new URL(link);
    assert.strictEqual(url.origin, "https://football.fantasysports.yahoo.com");
    assert.strictEqual(url.pathname, intent.kind === "trade" ? "/f1/1000/trade" : "/f1/1000/add");
    assert.strictEqual(url.search, `?${expected}`);
    assert.notInclude(url.pathname, "submit");
    assert.notInclude(url.pathname, "confirm");
  }).pipe(
    Effect.provide(
      YahooProvider.pipe(Layer.provide(recordingInternet(() => jsonResponse({})).layer)),
    ),
  ),
);

it.effect("rejects review links for a foreign host or a non-numeric player key", () =>
  Effect.gen(function* () {
    const provider = yield* ProviderGateway;

    const foreign = yield* Effect.flip(
      provider.buildReviewLink({
        providerLeagueKey: "461.l.1000",
        leagueWebUrl: "https://evil.test/f1/1000",
        sport: "football",
        intent: { kind: "add", add: "461.p.10001" },
      }),
    );
    const nonNumeric = yield* Effect.flip(
      provider.buildReviewLink({
        providerLeagueKey: "461.l.1000",
        leagueWebUrl: "https://football.fantasysports.yahoo.com/f1/1000",
        sport: "football",
        intent: { kind: "add", add: "461.p.not-a-number" },
      }),
    );

    assert.instanceOf(foreign, ProviderReviewLinkInvalid);
    assert.strictEqual(foreign.reason, "unsupported-league-url");
    assert.instanceOf(nonNumeric, ProviderReviewLinkInvalid);
    assert.strictEqual(nonNumeric.reason, "unsupported-player-key");
  }).pipe(
    Effect.provide(
      YahooProvider.pipe(Layer.provide(recordingInternet(() => jsonResponse({})).layer)),
    ),
  ),
);

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

const rawLeagueAttributes = {
  league_key: "461.l.1000",
  name: "Alpha League",
  url: "https://football.fantasysports.yahoo.com/f1/1000",
  num_teams: 10,
  current_week: 3,
  start_week: "1",
  end_week: "17",
  start_date: "2026-09-03",
  end_date: "2026-12-28",
  scoring_type: "head",
  scoring_label: "H2H",
  weekly_deadline: "",
  season: "2026",
  draft_status: "postdraft",
};

const rawLeagueSettings = {
  fantasy_content: {
    league: [
      rawLeagueAttributes,
      {
        settings: {
          "0": {
            roster_type: "head",
            waiver_type: "FR",
            waiver_rule: "continuous",
            uses_faab: "0",
            roster_positions: {
              "0": {
                roster_position: {
                  position: "QB",
                  position_type: "O",
                  count: 1,
                  is_starting_position: 1,
                },
              },
              "1": {
                roster_position: {
                  position: "BN",
                  position_type: "B",
                  count: 6,
                  is_starting_position: 0,
                },
              },
              count: 2,
            },
            stat_categories: {
              stats: {
                "0": {
                  stat: {
                    stat_id: 4,
                    name: "Passing Yards",
                    display_name: "Pass Yds",
                    group: "passing",
                    abbr: "PY",
                    enabled: "1",
                    position_type: "O",
                    stat_position_types: {
                      "0": { stat_position_type: { position_type: "O" } },
                      count: 1,
                    },
                  },
                },
                count: 1,
              },
            },
            stat_modifiers: {
              stats: {
                "0": { stat: { stat_id: 4, value: "0.04" } },
                count: 1,
              },
            },
          },
          count: 1,
        },
      },
    ],
  },
};

const rawRoster = {
  fantasy_content: {
    team: [
      { team_key: "461.l.1000.t.1" },
      {
        roster: {
          "0": {
            players: {
              "0": {
                player: [
                  [
                    { player_key: "461.p.10001" },
                    { name: { full: "Synthetic Player" } },
                    { display_position: "QB" },
                    { primary_position: "QB" },
                    { position_type: "O" },
                    {
                      eligible_positions: {
                        "0": { position: "QB" },
                        "1": { position: "W/R" },
                        count: 2,
                      },
                    },
                    { bye_weeks: { week: "7" } },
                    { is_undroppable: "0" },
                  ],
                  {
                    selected_position: [
                      { coverage_type: "week", week: "3" },
                      { position: "QB" },
                      { is_flex: 0 },
                    ],
                  },
                  { is_editable: "1" },
                ],
              },
              "1": {
                player: [
                  [
                    { player_key: "461.p.10002" },
                    { name: { full: "Synthetic Reserve" } },
                    { display_position: "RB" },
                    { primary_position: "RB" },
                    { position_type: "O" },
                    { eligible_positions: { "0": { position: "RB" }, count: 1 } },
                    { status: "O" },
                    { status_full: "Out" },
                    { injury_note: "Out for the synthetic test" },
                    { is_undroppable: "1" },
                  ],
                  {
                    selected_position: [{ coverage_type: "week", week: "3" }, { position: "IR" }],
                  },
                  { is_editable: "0" },
                ],
              },
              count: 2,
            },
          },
          count: 1,
        },
      },
    ],
  },
};

const rawRosterContainerWithCoverage = {
  fantasy_content: {
    team: [
      { team_key: "461.l.1000.t.1" },
      {
        roster: {
          "0": {
            players: {
              "0": {
                player: [
                  [
                    { player_key: "461.p.10001" },
                    { name: { full: "Synthetic Player" } },
                    { display_position: "QB" },
                    { primary_position: "QB" },
                    { position_type: "O" },
                    { eligible_positions: { "0": { position: "QB" }, count: 1 } },
                    { bye_weeks: { week: "7" } },
                    { is_undroppable: "0" },
                  ],
                  {
                    selected_position: [{ coverage_type: "week", week: "3" }, { position: "QB" }],
                  },
                  { is_editable: "1" },
                ],
              },
              count: 1,
            },
          },
          coverage_type: "week",
          week: "3",
          is_prescoring: 0,
          is_editable: 1,
          bye_week_sponsor: { sponsor_name: "Synthetic Sponsor" },
        },
      },
    ],
  },
};

const rawLeagueSettingsWithoutModifiers = {
  fantasy_content: {
    league: [
      rawLeagueAttributes,
      {
        settings: {
          "0": {
            roster_type: "head",
            waiver_type: "FR",
            waiver_rule: "continuous",
            uses_faab: "0",
            roster_positions: {
              "0": {
                roster_position: {
                  position: "QB",
                  position_type: "O",
                  count: 1,
                  is_starting_position: 1,
                },
              },
              count: 1,
            },
            stat_categories: {
              stats: {
                "0": {
                  stat: {
                    stat_id: 4,
                    name: "Passing Yards",
                    display_name: "Pass Yds",
                    group: "passing",
                    abbr: "PY",
                    enabled: "1",
                  },
                },
                count: 1,
              },
            },
          },
          count: 1,
        },
      },
    ],
  },
};

const rawLeagueSettingsWithSinglePositionType = {
  fantasy_content: {
    league: [
      rawLeagueAttributes,
      {
        settings: {
          "0": {
            roster_type: "head",
            roster_positions: { count: 0 },
            stat_categories: {
              stats: {
                "0": {
                  stat: {
                    stat_id: 4,
                    name: "Passing Yards",
                    display_name: "Pass Yds",
                    group: "passing",
                    abbr: "PY",
                    enabled: "1",
                    stat_position_types: [{ stat_position_type: { position_type: "O" } }],
                  },
                },
                count: 1,
              },
            },
            stat_modifiers: { stats: { count: 0 } },
          },
          count: 1,
        },
      },
    ],
  },
};

const rawRosterContainerWeekMismatch = {
  fantasy_content: {
    team: [
      { team_key: "461.l.1000.t.1" },
      {
        roster: {
          "0": {
            players: {
              "0": {
                player: [
                  [
                    { player_key: "461.p.10001" },
                    { name: { full: "Synthetic Player" } },
                    { display_position: "QB" },
                    { primary_position: "QB" },
                    { position_type: "O" },
                    { eligible_positions: { "0": { position: "QB" }, count: 1 } },
                  ],
                  {
                    selected_position: [{ coverage_type: "week", week: "3" }, { position: "QB" }],
                  },
                  { is_editable: "1" },
                ],
              },
              count: 1,
            },
          },
          coverage_type: "week",
          week: "4",
          is_prescoring: 0,
        },
      },
    ],
  },
};

const rawFreeAgents = {
  fantasy_content: {
    league: [
      { league_key: "461.l.1000" },
      {
        players: {
          "0": {
            player: [
              [
                { player_key: "461.p.10001" },
                { name: { full: "Synthetic Player" } },
                { primary_position: "QB" },
                { display_position: "QB" },
                {
                  eligible_positions: {
                    "0": { position: "QB" },
                    "1": { position: "W/R" },
                    count: 2,
                  },
                },
                { ownership: { ownership_type: "freeagents" } },
                { percent_owned: { coverage_type: "week", value: 42.5 } },
              ],
            ],
          },
          "1": {
            player: [
              [
                { player_key: "461.p.10002" },
                { name: { full: "Synthetic Waiver" } },
                { primary_position: "RB" },
                { display_position: "RB" },
                { eligible_positions: { "0": { position: "RB" }, count: 1 } },
                { ownership: { ownership_type: "waivers" } },
              ],
            ],
          },
          count: 2,
        },
      },
    ],
  },
};

const rawPlayerDetails = {
  fantasy_content: {
    league: [
      { league_key: "461.l.1000" },
      {
        players: {
          "0": {
            player: [
              [
                { player_key: "461.p.10001" },
                { name: { full: "Synthetic Player" } },
                { primary_position: "QB" },
                { display_position: "QB" },
                { eligible_positions: { "0": { position: "QB" }, count: 1 } },
              ],
              { ownership: { ownership_type: "team" } },
              {
                player_stats: {
                  "0": { coverage_type: "week", week: "3" },
                  stats: {
                    "0": { stat: { stat_id: 4, value: 12.5 } },
                    "1": { stat: { stat_id: 5, value: "-" } },
                    count: 2,
                  },
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

const rawMatchups = {
  fantasy_content: {
    league: [
      { league_key: "461.l.1000" },
      {
        scoreboard: {
          "0": {
            matchups: {
              "0": {
                matchup: {
                  "0": {
                    teams: {
                      "0": {
                        team: [
                          [
                            { team_key: "461.l.1000.t.1" },
                            { name: "Alpha" },
                            { team_points: { coverage_type: "week", week: "3", total: "101.25" } },
                          ],
                        ],
                      },
                      "1": {
                        team: [
                          [
                            { team_key: "461.l.1000.t.2" },
                            { name: "Beta" },
                            { team_points: { coverage_type: "week", week: "3", total: "98.5" } },
                          ],
                        ],
                      },
                      count: 2,
                    },
                  },
                  week: "3",
                  status: "midevent",
                },
              },
              "1": {
                matchup: {
                  "0": {
                    teams: {
                      "0": { team: [[{ team_key: "461.l.1000.t.3" }, { name: "Gamma" }]] },
                      "1": { team: [[{ team_key: "461.l.1000.t.4" }, { name: "Delta" }]] },
                      count: 2,
                    },
                  },
                  week: "3",
                  status: "preevent",
                },
              },
              count: 2,
            },
          },
          week: "3",
        },
      },
    ],
  },
};

const rawTransactions = {
  fantasy_content: {
    league: [
      { league_key: "461.l.1000" },
      {
        transactions: {
          "0": {
            transaction: [
              { type: "add/drop" },
              { status: "successful" },
              { timestamp: "1761600000" },
              {
                players: {
                  "0": {
                    player: [
                      [
                        { player_key: "461.p.10001" },
                        {
                          transaction_data: [
                            { type: "add" },
                            { source_type: "freeagents" },
                            { destination_type: "team" },
                            { destination_team_key: "461.l.1000.t.1" },
                            { destination_team_name: "Alpha" },
                          ],
                        },
                      ],
                    ],
                  },
                  "1": {
                    player: [
                      [
                        { player_key: "461.p.10002" },
                        {
                          transaction_data: [
                            { type: "drop" },
                            { source_type: "team" },
                            { source_team_key: "461.l.1000.t.2" },
                            { source_team_name: "Beta" },
                            { destination_type: "waivers" },
                          ],
                        },
                      ],
                    ],
                  },
                  count: 2,
                },
              },
            ],
          },
          "1": {
            transaction: [
              { type: "trade" },
              { timestamp: "1761600100" },
              {
                players: {
                  "0": {
                    player: [
                      [
                        { player_key: "461.p.10003" },
                        {
                          transaction_data: [
                            { type: "trade" },
                            { source_team_key: "461.l.1000.t.1" },
                            { source_team_name: "Alpha" },
                            { destination_team_key: "461.l.1000.t.2" },
                            { destination_team_name: "Beta" },
                          ],
                        },
                      ],
                    ],
                  },
                  count: 1,
                },
              },
            ],
          },
          count: 2,
        },
      },
    ],
  },
};

const rawLeagueTeams = {
  fantasy_content: {
    league: [
      { league_key: "461.l.1000" },
      {
        teams: {
          "0": { team: [[{ team_key: "461.l.1000.t.1" }, { name: "Alpha" }]] },
          "1": { team: [[{ team_key: "461.l.1000.t.2" }, { name: "Beta" }]] },
          count: 2,
        },
      },
    ],
  },
};

const rawDateRoster = {
  fantasy_content: {
    team: [
      { team_key: "465.l.2000.t.9" },
      {
        roster: {
          "0": {
            players: {
              "0": {
                player: [
                  [
                    { player_key: "465.p.20001" },
                    { name: { full: "Synthetic Goalie" } },
                    { display_position: "G" },
                    { primary_position: "G" },
                    { position_type: "G" },
                    { eligible_positions: { "0": { position: "G" }, count: 1 } },
                  ],
                  {
                    selected_position: [
                      { coverage_type: "date", date: "2026-10-25" },
                      { position: "G" },
                    ],
                  },
                  { is_editable: "1" },
                ],
              },
              count: 1,
            },
          },
          coverage_type: "date",
          date: "2026-10-25",
          is_prescoring: 0,
        },
      },
    ],
  },
};

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
