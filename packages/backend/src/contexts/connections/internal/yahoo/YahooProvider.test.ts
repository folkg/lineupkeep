import { assert, it } from "@effect/vitest";
import type { Tracer } from "effect";
import {
  Array,
  Cause,
  DateTime,
  Effect,
  Exit,
  Layer,
  Redacted,
  Schema,
  Tracer as EffectTracer,
} from "effect";
import { TestClock } from "effect/testing";

import { LineupTargetPeriod } from "#contexts/connections/LineupRun.ts";
import {
  ProviderOperationUnsupported,
  ProviderPeriodMismatch,
  ProviderPeriodUnsupported,
  ProviderRequestFailed,
  ProviderResponseInvalid,
  ProviderReviewLinkInvalid,
  ProviderSessionRejected,
} from "#contexts/connections/Provider.ts";
import type {
  ProviderLeagueSettings,
  ProviderScoreRequest,
  ProviderRoster,
} from "#contexts/connections/Provider.ts";
import { decodeProviderKey } from "#contexts/connections/ProviderKey.ts";
import { ProviderRegistry, providerRegistryOf } from "#contexts/connections/ProviderRegistry.ts";
import { PublicInternet } from "#runtime/PublicInternet.ts";
import type { PublicInternetOptions } from "#runtime/PublicInternet.ts";

import { yahooCapabilities } from "./YahooLineup.ts";
import {
  yahooEmptyRoster,
  yahooNflFreeAgents,
  yahooNflLeagueSettings,
  yahooNflLeagueTeams,
  yahooNflPlayerDetailsWithMismatchedStartedCoverage,
  yahooNflPlayerDetailsWithPopulatedCut,
  yahooNflPlayerDetailsWithUnpopulatedCut,
  yahooNflLeagueTeamsForAnotherLeague,
  yahooNflMatchups,
  yahooNflRosterWeekMismatch,
  yahooNflTeams,
  yahooNhlTeams,
  yahooSession,
  yahooNflSeasonPlayerDetails,
  yahooNflWeekPlayerDetails,
  yahooNhlSeasonPlayerDetails,
  yahooNflLeagueSettingsForAnotherLeague,
  yahooNflLeagueSettingsWithTextTeamCount,
  yahooNflLeagueSettingsWithoutEndWeek,
  yahooNhlLeagueSettings,
  yahooNhlLeagueSettingsWith,
  yahooNflLeagueSettingsWith,
  yahooNflLeagueSettingsWithGamesLimit,
  yahooNflLeagueSettingsWithPitcherSlot,
  yahooNflLeagueSettingsWithSettings,
  yahooNflPlayerDetailsWithOwnership,
  yahooNflGamesPlayed,
  yahooNhlRoster,
  yahooRosterWithConfirmedStart,
  yahooRosterWithOpponentKinds,
  yahooRosterWithoutOpponent,
  yahooNhlRotoLeagueSettings,
  yahooNhlWeekPlayerDetails,
  yahooNhlPlayerDetailsWithMissingStartedValue,
  yahooNhlPlayerDetailsWithUnparseableStartedValue,
  yahooNhlPlayerDetailsWithoutStartedPercentage,
  yahooNflTransactions,
  yahooNflTradeTransactions,
  yahooNflTradeTransactionsWithoutPartyKeys,
  yahooNflSinglePlayerTrade,
  yahooNflTradeWithPicks,
  yahooNflPickOnlyTrade,
  yahooNflEmptyTradeTransaction,
  yahooNflDraftResults,
  yahooNflRoster,
  yahooNflStandings,
  yahooNhlCategoryStandings,
  yahooNhlMatchupsWithGames,
  yahooNhlRotoStandings,
} from "./YahooPayloadFixturesTest.ts";
import { yahooNhlDatePlayerDetails } from "./YahooPayloadFixturesTest.ts";
import { yahooProvider } from "./YahooProvider.ts";

it.effect("validates a session with one exact read request", () => {
  const internet = recordingInternet((request) =>
    request.url.pathname === "/fantasy/v2/users;use_login=1"
      ? jsonResponse(yahooSession)
      : jsonResponse({}, 404),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

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
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("discovers both supported leagues with exact batches and stable team identity", () => {
  const internet = recordingInternet((request) =>
    request.url.pathname.includes("game_keys=nhl")
      ? jsonResponse(yahooNhlTeams)
      : jsonResponse(yahooNflTeams),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

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
        provider: decodeProviderKey("yahoo"),
        providerTeamKey: "466.l.4000.t.1",
        providerLeagueKey: "466.l.4000",
        league: "nfl",
        sport: "football",
        season: 2026,
        name: "Synthetic NFL Team",
      },
      {
        provider: decodeProviderKey("yahoo"),
        providerTeamKey: "466.l.4002.t.3",
        providerLeagueKey: "466.l.4002",
        league: "nhl",
        sport: "hockey",
        season: 2026,
        name: "Synthetic NHL Team",
      },
    ]);
    assert.isTrue(internet.calls.every((call) => call.options?.timeoutMs === 30_000));
    assert.isTrue(internet.calls.every((call) => call.options?.maxResponseBytes === 4_194_304));
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("rejects a discovered game that does not match the requested sport", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNhlTeams));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(provider.discoverTeams(sessionInput));

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.strictEqual(error.field, "game.code");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("sends the native start-active action to the read-write roster endpoint", () => {
  const calls: Array<{
    url: URL;
    method: string;
    body: string;
    headers: Record<string, string>;
  }> = [];
  const layer = Layer.succeed(PublicInternet)({
    request: (request) =>
      Effect.promise(async () => {
        const body = request.body === null ? "" : await request.clone().text();
        calls.push({
          url: new URL(request.url),
          method: request.method,
          body,
          headers: Object.fromEntries(request.headers.entries()),
        });
        return request.url.includes("getCrumb")
          ? jsonResponse({
              service: { "xml:lang": "en-US", crumb: "canary-crumb-value" },
            })
          : jsonResponse({ fantasy_content: { roster: { status: "success" } } });
      }),
  });

  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const result = yield* provider.applyNativeAction({
      ...sessionInput,
      providerTeamKey: "461.l.1000.t.1",
      target: { type: "week", week: 7 },
    });

    assert.deepStrictEqual(result, { status: "accepted" });
    assert.strictEqual(calls.length, 2);
    const write = calls[1];
    assert.isDefined(write);
    assert.strictEqual(write.method, "PUT");
    assert.strictEqual(write.url.origin, "https://pub-api-rw.fantasysports.yahoo.com");
    assert.strictEqual(write.url.pathname, "/fantasy/v2/team/461.l.1000.t.1/roster");
    assert.strictEqual(write.url.searchParams.get("format"), "json_f");
    assert.strictEqual(write.url.searchParams.get("crumb"), "canary-crumb-value");
    assert.strictEqual(write.headers["content-type"], "application/xml");
    assert.strictEqual(write.headers["cookie"], Redacted.value(sessionInput.session));
    assert.include(write.body, "<coverage_type>week</coverage_type>");
    assert.include(write.body, "<week>7</week>");
    assert.include(write.body, "<action>start_active_players</action>");
    assert.notInclude(write.body, "roster_action");
  }).pipe(Effect.provide(yahooLayer(layer)));
});

it.effect("sends explicit player assignments to the read-write roster endpoint", () => {
  const calls: Array<{
    url: URL;
    method: string;
    body: string;
    headers: Record<string, string>;
  }> = [];
  const layer = Layer.succeed(PublicInternet)({
    request: (request) =>
      Effect.promise(async () => {
        const body = request.body === null ? "" : await request.clone().text();
        calls.push({
          url: new URL(request.url),
          method: request.method,
          body,
          headers: Object.fromEntries(request.headers.entries()),
        });
        return request.url.includes("getCrumb")
          ? jsonResponse({
              service: { "xml:lang": "en-US", crumb: "canary-crumb-value" },
            })
          : jsonResponse({ fantasy_content: { roster: { status: "success" } } });
      }),
  });

  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const result = yield* provider.applyExplicitAssignments({
      ...sessionInput,
      providerTeamKey: "461.l.1000.t.1",
      target: { type: "week", week: 7 },
      assignments: [
        { providerPlayerKey: "461.p.10001", slot: "RB" },
        { providerPlayerKey: "461.p.10002", slot: "BN" },
      ],
    });

    assert.deepStrictEqual(result, { status: "accepted" });
    assert.strictEqual(calls.length, 2);
    const write = calls[1];
    assert.isDefined(write);
    assert.strictEqual(write.method, "PUT");
    assert.strictEqual(write.url.origin, "https://pub-api-rw.fantasysports.yahoo.com");
    assert.strictEqual(write.url.pathname, "/fantasy/v2/team/461.l.1000.t.1/roster");
    assert.strictEqual(write.url.searchParams.get("format"), "json_f");
    assert.strictEqual(write.url.searchParams.get("crumb"), "canary-crumb-value");
    assert.strictEqual(write.headers["content-type"], "application/xml");
    assert.strictEqual(write.headers["cookie"], Redacted.value(sessionInput.session));
    assert.strictEqual(
      write.body,
      '<?xml version="1.0" encoding="UTF-8"?><fantasy_content><roster><coverage_type>week</coverage_type><week>7</week><players><player><player_key>461.p.10001</player_key><position>RB</position></player><player><player_key>461.p.10002</player_key><position>BN</position></player></players></roster></fantasy_content>',
    );
  }).pipe(Effect.provide(yahooLayer(layer)));
});

it.effect("reports an explicit assignment rejection without retrying a different body", () => {
  const layer = Layer.succeed(PublicInternet)({
    request: (request) =>
      Effect.succeed(
        request.url.includes("getCrumb")
          ? jsonResponse({ service: { "xml:lang": "en-US", crumb: "canary-crumb-value" } })
          : new Response('{"error":{"description":"That position has already been filled."}}', {
              status: 400,
            }),
      ),
  });

  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const result = yield* provider.applyExplicitAssignments({
      ...sessionInput,
      providerTeamKey: "461.l.1000.t.1",
      target: { type: "week", week: 7 },
      assignments: [{ providerPlayerKey: "461.p.10001", slot: "RB" }],
    });

    assert.deepStrictEqual(result, { status: "rejected", reason: "invalid_request" });
  }).pipe(Effect.provide(yahooLayer(layer)));
});

it.effect("rejects rejected sessions without exposing the cookie or response body", () => {
  const internet = recordingInternet(() => new Response("private-provider-body", { status: 401 }));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(provider.validateSession(sessionInput));

    assert.instanceOf(error, ProviderSessionRejected);
    assert.notInclude(String(error), Redacted.value(sessionInput.session));
    assert.notInclude(String(error), "private-provider-body");
  }).pipe(Effect.provide(yahooLayer(internet)));
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
    const provider = yield* testProvider;

    yield* Effect.flip(provider.validateSession(sessionInput));

    assert.isTrue(cancelled);
  }).pipe(Effect.provide(yahooLayer(internet)));
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
    const provider = yield* testProvider;

    const error = yield* Effect.flip(provider.discoverTeams(sessionInput));

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.notInclude(String(error), "private-provider-body");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("rejects discovery when the provider returns no session user", () => {
  const internet = recordingInternet(() =>
    jsonResponse({ fantasy_content: { users: { count: 0 } } }),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(provider.discoverTeams(sessionInput));

    assert.instanceOf(error, ProviderSessionRejected);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("rejects redirects through PublicInternet", () => {
  const internet = PublicInternet.fromTransport(() =>
    Promise.resolve(
      new Response(null, { status: 302, headers: { location: "https://evil.test" } }),
    ),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(provider.validateSession(sessionInput));

    assert.instanceOf(error, ProviderRequestFailed);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reports a missing write token as an unsent write", () => {
  const internet = recordingInternet((request) =>
    request.url.pathname === "/fantasy/v3/getCrumb"
      ? jsonResponse({ service: { "xml:lang": "en-US", crumb: null } })
      : jsonResponse({}, 404),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;
    const result = yield* provider.applyNativeAction({
      ...sessionInput,
      providerTeamKey: "461.l.1000.t.1",
      target: { type: "week", week: 3 },
    });
    assert.deepStrictEqual(result, { status: "not_sent", reason: "session_incomplete" });
  }).pipe(Effect.provide(yahooLayer(internet)));
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
    const provider = yield* testProvider;

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
    Effect.provide(yahooLayer(internet)),
    Effect.withSpan("provider.test"),
    Effect.withTracer(tracer),
  );
});

it.effect("reads an NFL league whose settings publish extra and renamed fields", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflLeagueSettings));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const league = yield* provider.readLeague({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      sport: "football",
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/settings?format=json",
    );
    assert.strictEqual(internet.calls[0]?.headers["cookie"], Redacted.value(sessionInput.session));
    assert.strictEqual(league.name, "Synthetic NFL League");
    assert.deepStrictEqual(league.periodWindow, { current: 6, start: 1, end: 17 });
    assert.strictEqual(league.rosterCoverage, "week");
    assert.strictEqual(league.weeklyDeadline, undefined);
    assert.strictEqual(league.waiverDays, 1);
    assert.strictEqual(league.maxWeeklyAcquisitions, undefined);
    assert.strictEqual(league.maxSeasonAcquisitions, undefined);
    assert.strictEqual(league.tradeEndDate, "2026-11-20");
    assert.strictEqual(league.tradeRatification, "commissioner");
    assert.strictEqual(league.tradeObjectionDays, 2);
    assert.strictEqual(league.maxGamesPlayed, undefined);
    assert.strictEqual(league.maxInningsPitched, undefined);
    assert.deepStrictEqual(
      league.rosterPositions.map((position) => [position.position, position.count, position.kind]),
      [
        ["QB", 1, "starting"],
        ["WR", 2, "starting"],
        ["W/R/T", 1, "starting"],
        ["BN", 6, "bench"],
        ["IR", 1, "reserve"],
      ],
    );
    assert.deepStrictEqual(
      league.statCategories.map((category) => [
        category.statId,
        category.name,
        category.enabled,
        category.displayOnly,
        category.positionTypes,
      ]),
      [
        [4, "Passing Yards", true, false, ["O"]],
        [9, "Rushing Touchdowns", true, false, ["O"]],
        [13, "Receptions", false, true, ["O"]],
      ],
    );
    assert.deepStrictEqual(league.statModifiers, [
      { statId: 4, points: "0.04" },
      { statId: 9, points: "6" },
      { statId: 13, points: "0.5" },
    ]);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads the league's declared acquisition, trade, and games-cap rules", () => {
  const internet = recordingInternet(() =>
    jsonResponse(
      yahooNflLeagueSettingsWithSettings({
        max_weekly_adds: "7",
        max_adds: "3",
        max_games_played: "48",
        trade_ratify_type: "vote",
      }),
    ),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const league = yield* provider.readLeague({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      sport: "football",
    });

    assert.strictEqual(league.maxWeeklyAcquisitions, 7);
    assert.strictEqual(league.maxSeasonAcquisitions, 3);
    assert.strictEqual(league.maxGamesPlayed, 48);
    assert.strictEqual(league.maxInningsPitched, undefined);
    assert.strictEqual(league.tradeRatification, "vote");
    assert.strictEqual(league.tradeEndDate, "2026-11-20");
    assert.strictEqual(league.tradeObjectionDays, 2);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("names a trade ratification rule it was not taught as unknown", () => {
  const internet = recordingInternet(() =>
    jsonResponse(yahooNflLeagueSettingsWithSettings({ trade_ratify_type: "unanimous" })),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const league = yield* provider.readLeague({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      sport: "football",
    });

    assert.strictEqual(league.tradeRatification, "unknown");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads an NHL head-to-head league with qualifying-days settings and no modifiers", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNhlLeagueSettings));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const league = yield* provider.readLeague({
      ...sessionInput,
      providerLeagueKey: "466.l.4001",
      sport: "hockey",
    });

    assert.deepStrictEqual(league.periodWindow, { current: 3, start: 1, end: 24 });
    assert.strictEqual(league.rosterCoverage, "date");
    assert.strictEqual(league.webUrl, "https://hockey.fantasysports.yahoo.com/hockey/4001");
    assert.strictEqual(league.weeklyDeadline, "game");
    assert.strictEqual(league.maxWeeklyAcquisitions, 2);
    assert.strictEqual(league.maxSeasonAcquisitions, 20);
    assert.strictEqual(league.waiverDays, 1);
    assert.strictEqual(league.tradeEndDate, "2027-02-20");
    assert.strictEqual(league.tradeRatification, "commissioner");
    assert.strictEqual(league.tradeObjectionDays, 2);
    assert.strictEqual(league.maxGamesPlayed, undefined);
    assert.strictEqual(league.maxInningsPitched, undefined);
    assert.deepStrictEqual(
      league.rosterPositions.map((position) => position.positionType),
      ["P", "P", "G", undefined, undefined],
    );
    assert.deepStrictEqual(league.statModifiers, []);
    assert.strictEqual(league.statCategories.length, 3);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads a rotisserie league that publishes no scoring-week window", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNhlRotoLeagueSettings));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const league = yield* provider.readLeague({
      ...sessionInput,
      providerLeagueKey: "466.l.4002",
      sport: "hockey",
    });

    assert.strictEqual(league.periodWindow, undefined);
    assert.strictEqual(league.rosterCoverage, "date");
    assert.strictEqual(league.scoringType, "roto");
    assert.strictEqual(league.teamCount, 12);
    assert.strictEqual(league.startDate, "2026-10-01");
    assert.strictEqual(league.weeklyDeadline, undefined);
    assert.strictEqual(league.waiverType, "FR");
    assert.deepStrictEqual(
      league.rosterPositions.map((position) => position.position),
      ["C", "LW", "D", "BN", "IR"],
    );
    assert.deepStrictEqual(league.statModifiers, []);
    assert.deepStrictEqual(
      league.statCategories.map((category) => [
        category.name,
        category.enabled,
        category.displayOnly,
      ]),
      [
        ["Goals", true, false],
        ["Assists", true, false],
        ["Shots on Goal", true, true],
      ],
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("derives a weekly cadence from the league's own declared deadline", () => {
  const internet = recordingInternet(() =>
    jsonResponse(
      yahooNhlLeagueSettingsWith({
        league_key: "466.l.4003",
        league_id: "4003",
        url: "https://hockey.fantasysports.yahoo.com/hockey/4003",
        weekly_deadline: "3",
        edit_key: "12",
      }),
    ),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const league = yield* provider.readLeague({
      ...sessionInput,
      providerLeagueKey: "466.l.4003",
      sport: "hockey",
    });

    assert.strictEqual(league.rosterCoverage, "week");
    assert.strictEqual(league.weeklyDeadline, "3");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect(
  "resolves a week target and reads a week roster for a league that declares a weekly deadline",
  () => {
    const internet = recordingInternet((request) =>
      jsonResponse(
        request.url.pathname.endsWith("/settings")
          ? yahooNflLeagueSettingsWith({ weekly_deadline: "3", edit_key: "6" })
          : yahooNflRoster,
      ),
    );
    return Effect.gen(function* () {
      const provider = yield* testProvider;

      const league = yield* provider.readLeague({
        ...sessionInput,
        providerLeagueKey: "466.l.4000",
        sport: "football",
      });
      const roster = yield* provider.readRoster({
        ...sessionInput,
        providerTeamKey: "466.l.4000.t.1",
        period: { type: "week", week: 6 },
      });

      assert.strictEqual(league.rosterCoverage, "week");
      assert.strictEqual(league.periodWindow?.current, 6);
      assert.deepStrictEqual(roster.coverage, { type: "week", week: 6 });
      assert.strictEqual(
        internet.calls[1]?.url.pathname,
        "/fantasy/v2/team/466.l.4000.t.1/roster;week=6/players;out=opponent,starting_status",
      );
    }).pipe(Effect.provide(yahooLayer(internet)));
  },
);

it.effect("refuses a league whose declared deadline identifies no cadence", () => {
  const internet = recordingInternet(() =>
    jsonResponse(
      yahooNhlLeagueSettingsWith({
        league_key: "466.l.4004",
        league_id: "4004",
        weekly_deadline: "fortnightly",
        edit_key: "whenever",
      }),
    ),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readLeague({
        ...sessionInput,
        providerLeagueKey: "466.l.4004",
        sport: "hockey",
      }),
    );

    assert.instanceOf(error, ProviderOperationUnsupported);
    assert.include(error.reason, "fortnightly");
    assert.include(error.reason, "lineup period cannot be resolved");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("names the week-window field when only part of the window is published", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflLeagueSettingsWithoutEndWeek));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readLeague({
        ...sessionInput,
        providerLeagueKey: "466.l.4000",
        sport: "football",
      }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.strictEqual(error.field, "league.end_week");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("names the field that is genuinely unverifiable", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflLeagueSettingsWithTextTeamCount));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readLeague({
        ...sessionInput,
        providerLeagueKey: "466.l.4000",
        sport: "football",
      }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.strictEqual(error.field, "league.num_teams");
    assert.notInclude(String(error), "Synthetic NFL League");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("rejects a league response for another league and names the identity field", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflLeagueSettingsForAnotherLeague));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readLeague({
        ...sessionInput,
        providerLeagueKey: "466.l.4000",
        sport: "football",
      }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.strictEqual(error.field, "league.league_key");
    assert.notInclude(String(error), "Synthetic NFL League");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads the participation member as a scheduled fact", () => {
  const internet = recordingInternet(() => jsonResponse(yahooRosterWithOpponentKinds));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const roster = yield* provider.readRoster({
      ...sessionInput,
      providerTeamKey: "466.l.4002.t.3",
      period: undefined,
    });

    assert.deepStrictEqual(
      roster.players.map((player) => [player.name, player.scheduled, player.startingLineup]),
      [
        ["Synthetic At Home", true, "confirmed-not-starting"],
        ["Synthetic Off Night", false, "unconfirmed"],
        ["Synthetic On Bye", false, "unconfirmed"],
      ],
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads a confirmed real-world start as its own fact", () => {
  const internet = recordingInternet(() => jsonResponse(yahooRosterWithConfirmedStart));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const roster = yield* provider.readRoster({
      ...sessionInput,
      providerTeamKey: "466.l.4002.t.3",
      period: undefined,
    });

    assert.deepStrictEqual(
      roster.players.map((player) => [player.name, player.scheduled, player.startingLineup]),
      [["Synthetic Confirmed Goalie", true, "confirmed-starting"]],
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("rejects a roster payload that omits the participation member", () => {
  const internet = recordingInternet(() => jsonResponse(yahooRosterWithoutOpponent));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readRoster({
        ...sessionInput,
        providerTeamKey: "466.l.4002.t.3",
        period: undefined,
      }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads an exact selected week roster with whole verified fields", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflRoster));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const roster = yield* provider.readRoster({
      ...sessionInput,
      providerTeamKey: "466.l.4000.t.1",
      period: { type: "week", week: 6 },
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/team/466.l.4000.t.1/roster;week=6/players;out=opponent,starting_status?format=json",
    );
    assert.deepStrictEqual(roster.coverage, { type: "week", week: 6 });
    assert.deepStrictEqual(roster.players, [
      {
        providerPlayerKey: "466.p.20001",
        name: "Synthetic Starter",
        displayPosition: "QB",
        primaryPosition: "QB",
        positionType: "O",
        proTeamAbbreviation: "SYN",
        eligiblePositions: ["QB", "W/R"],
        slot: "QB",
        isEditable: true,
        injuryCode: undefined,
        injuryDetail: undefined,
        byeWeek: 7,
        scheduled: true,
        startingLineup: "confirmed-starting",
        undroppable: false,
      },
      {
        providerPlayerKey: "466.p.20002",
        name: "Synthetic Reserve",
        displayPosition: "WR",
        primaryPosition: "WR",
        positionType: "O",
        proTeamAbbreviation: "SYN",
        eligiblePositions: ["WR"],
        slot: "BN",
        isEditable: false,
        injuryCode: "O",
        injuryDetail: "Synthetic injury note",
        byeWeek: null,
        scheduled: false,
        startingLineup: "unconfirmed",
        undroppable: true,
      },
    ]);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads a week-scoped roster container from a captured payload", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflRoster));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const roster = yield* provider.readRoster({
      ...sessionInput,
      providerTeamKey: "466.l.4000.t.1",
      period: { type: "week", week: 6 },
    });

    assert.deepStrictEqual(roster.coverage, { type: "week", week: 6 });
    assert.deepStrictEqual(
      roster.players.map((player) => [
        player.name,
        player.slot,
        player.isEditable,
        player.injuryCode,
      ]),
      [
        ["Synthetic Starter", "QB", true, undefined],
        ["Synthetic Reserve", "BN", false, "O"],
      ],
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("rejects a roster returned for a different team", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflRoster));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readRoster({
        ...sessionInput,
        providerTeamKey: "466.l.4000.t.2",
        period: { type: "week", week: 6 },
      }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.strictEqual(error.field, "team.team_key");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("rejects a roster whose container and entries disagree on the week", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflRosterWeekMismatch));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readRoster({
        ...sessionInput,
        providerTeamKey: "466.l.4000.t.1",
        period: undefined,
      }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("refuses to relabel a date-scoped roster as a week", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNhlRoster));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readRoster({
        ...sessionInput,
        providerTeamKey: "466.l.4002.t.3",
        period: { type: "week", week: 4 },
      }),
    );

    assert.instanceOf(error, ProviderPeriodMismatch);
    assert.deepStrictEqual(error.requested, { type: "week", week: 4 });
    assert.deepStrictEqual(error.covered, { type: "date", date: "2026-10-25" });
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("treats a rejected week selector as uncovered period coverage", () => {
  const internet = recordingInternet((request) =>
    request.url.pathname.includes("/roster;week=6/players")
      ? jsonResponse({ error: { description: "Synthetic provider rejection" } }, 400)
      : jsonResponse(yahooNhlRoster),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readRoster({
        ...sessionInput,
        providerTeamKey: "466.l.4002.t.3",
        period: { type: "week", week: 6 },
      }),
    );

    assert.instanceOf(error, ProviderPeriodMismatch);
    assert.deepStrictEqual(error.requested, { type: "week", week: 6 });
    assert.strictEqual(error.covered, null);
    assert.strictEqual(internet.calls.length, 1);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads a date-scoped roster from a captured payload", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNhlRoster));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const roster = yield* provider.readRoster({
      ...sessionInput,
      providerTeamKey: "466.l.4002.t.3",
      period: undefined,
    });

    assert.deepStrictEqual(roster.coverage, { type: "date", date: "2026-10-25" });
    assert.deepStrictEqual(
      roster.players.map((player) => [player.name, player.slot, player.eligiblePositions]),
      [
        ["Synthetic Skater", "C", ["C", "LW"]],
        ["Synthetic Goalie", "BN", ["G"]],
      ],
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads a date target without sending a period selector", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNhlRoster));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const roster = yield* provider.readRoster({
      ...sessionInput,
      providerTeamKey: "466.l.4002.t.3",
      period: { type: "date", date: "2026-10-25" },
    });

    assert.deepStrictEqual(roster.coverage, { type: "date", date: "2026-10-25" });
    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/team/466.l.4002.t.3/roster/players;out=opponent,starting_status?format=json",
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reports a date period mismatch without relabelling another day", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNhlRoster));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readRoster({
        ...sessionInput,
        providerTeamKey: "466.l.4002.t.3",
        period: { type: "date", date: "2026-10-24" },
      }),
    );

    assert.instanceOf(error, ProviderPeriodMismatch);
    assert.deepStrictEqual(error.requested, { type: "date", date: "2026-10-24" });
    assert.deepStrictEqual(error.covered, { type: "date", date: "2026-10-25" });
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("sends a week selector only for a week target", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflRoster));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const roster = yield* provider.readRoster({
      ...sessionInput,
      providerTeamKey: "466.l.4000.t.1",
      period: { type: "week", week: 6 },
    });

    assert.deepStrictEqual(roster.coverage, { type: "week", week: 6 });
    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/team/466.l.4000.t.1/roster;week=6/players;out=opponent,starting_status?format=json",
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reports a period mismatch instead of relabelling another week", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflRoster));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readRoster({
        ...sessionInput,
        providerTeamKey: "466.l.4000.t.1",
        period: { type: "week", week: 4 },
      }),
    );

    assert.instanceOf(error, ProviderPeriodMismatch);
    assert.deepStrictEqual(error.requested, { type: "week", week: 4 });
    assert.deepStrictEqual(error.covered, { type: "week", week: 6 });
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("rejects an empty roster as an unestablished period", () => {
  const internet = recordingInternet(() => jsonResponse(yahooEmptyRoster));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readRoster({
        ...sessionInput,
        providerTeamKey: "466.l.4000.t.1",
        period: undefined,
      }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("searches free agents with one exact request and typed availability", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflFreeAgents));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const result = yield* provider.searchPlayers({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      season: 2026,
      query: "Synthetic Free",
      availability: "free_agent",
      sort: "ownership",
      statId: undefined,
      statType: "season",
      limit: 10,
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/players;status=FA;sort=R_PO;count=10;search=Synthetic%20Free;out=ownership,percent_owned,percent_started,ranks?format=json",
    );
    assert.deepStrictEqual(result.players, [
      {
        providerPlayerKey: "466.p.20006",
        name: "Synthetic Free Agent",
        primaryPosition: "WR",
        displayPosition: "WR",
        eligiblePositions: ["WR", "W/R"],
        availability: "free_agent",
        status: { value: "healthy", code: undefined, detail: undefined },
        percentOwned: 42.5,
        percentOwnedDelta: 3,
        percentStarted: 31.5,
        percentStartedChange: -2,
        actualRank: 14,
        overallRank: 22,
        statValue: null,
      },
      {
        providerPlayerKey: "466.p.20007",
        name: "Synthetic Waiver",
        primaryPosition: "RB",
        displayPosition: "RB",
        eligiblePositions: ["RB"],
        availability: "waiver",
        status: {
          value: "injured_reserve",
          code: "IR-LT",
          detail: "Out for the season after surgery.",
        },
        percentOwned: null,
        percentOwnedDelta: null,
        percentStarted: null,
        percentStartedChange: null,
        actualRank: 63,
        overallRank: 41,
        statValue: null,
      },
      {
        providerPlayerKey: "466.p.20008",
        name: "Synthetic Unstarted",
        primaryPosition: "TE",
        displayPosition: "TE",
        eligiblePositions: ["TE"],
        availability: "free_agent",
        status: { value: "unknown", code: "PUP-2027", detail: undefined },
        percentOwned: 0,
        percentOwnedDelta: 0,
        percentStarted: null,
        percentStartedChange: null,
        actualRank: 7,
        overallRank: 3,
        statValue: null,
      },
    ]);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("searches waiver players without a query", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflFreeAgents));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    yield* provider.searchPlayers({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      season: 2026,
      query: undefined,
      availability: "waiver",
      sort: "name",
      statId: undefined,
      statType: "season",
      limit: 25,
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/players;status=W;sort=NAME;count=25;out=ownership,percent_owned,percent_started,ranks?format=json",
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("searches the whole player pool without an availability filter", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflFreeAgents));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    yield* provider.searchPlayers({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      season: 2026,
      query: undefined,
      availability: "all",
      sort: "position",
      statId: undefined,
      statType: "season",
      limit: 25,
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/players;sort=NAME;count=25;out=ownership,percent_owned,percent_started,ranks?format=json",
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("requests the rank and stat values that each provider-ordered sort publishes", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflFreeAgents));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const statSort = yield* provider.searchPlayers({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      season: 2026,
      query: undefined,
      availability: "all",
      sort: "stat",
      statId: 4,
      statType: "season",
      limit: 10,
    });
    yield* provider.searchPlayers({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      season: 2026,
      query: undefined,
      availability: "all",
      sort: "actual_rank",
      statId: undefined,
      statType: "season",
      limit: 10,
    });

    assert.deepStrictEqual(
      internet.calls.map((call) => call.url.href),
      [
        "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/players;sort=4;sort_type=season;count=10;out=ownership,percent_owned,percent_started,ranks,stats?format=json",
        "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/players;sort=AR;sort_type=season;count=10;out=ownership,percent_owned,percent_started,ranks?format=json",
      ],
    );
    assert.deepStrictEqual(
      statSort.players.map((player) => [player.actualRank, player.overallRank, player.statValue]),
      [
        [14, 22, 1989],
        [63, 41, null],
        [7, 3, 0],
      ],
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("refuses a weekly player sort the rows cannot explain", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflFreeAgents));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.searchPlayers({
        ...sessionInput,
        providerLeagueKey: "466.l.4000",
        season: 2026,
        query: undefined,
        availability: "all",
        sort: "actual_rank",
        statId: undefined,
        statType: "week",
        limit: 10,
      }),
    );

    assert.instanceOf(error, ProviderOperationUnsupported);
    assert.deepStrictEqual(internet.calls, []);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("refuses a stat sort without a stat id", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflFreeAgents));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.searchPlayers({
        ...sessionInput,
        providerLeagueKey: "466.l.4000",
        season: 2026,
        query: undefined,
        availability: "all",
        sort: "stat",
        statId: undefined,
        statType: "season",
        limit: 10,
      }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.deepStrictEqual(internet.calls, []);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("rejects an unbounded player search without a request", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflFreeAgents));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.searchPlayers({
        ...sessionInput,
        providerLeagueKey: "461.l.1000",
        season: 2026,
        query: undefined,
        availability: "all",
        sort: "name",
        statId: undefined,
        statType: "season",
        limit: 51,
      }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.deepStrictEqual(internet.calls, []);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads completed-week football statistics on a weekly basis", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflWeekPlayerDetails));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const details = yield* provider.readPlayerDetails({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      providerPlayerKeys: ["466.p.20001"],
      sport: "football",
      period: { kind: "week", week: 6 },
      currentPeriod: 7,
      seasonStart: "2026-09-03",
      seasonEnd: "2026-12-28",
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/players;player_keys=466.p.20001;out=stats,ownership?format=json&stats.type=week&stats.week=6",
    );
    assert.deepStrictEqual(details, [
      {
        providerPlayerKey: "466.p.20001",
        name: "Synthetic Starter",
        primaryPosition: "QB",
        displayPosition: "QB",
        eligiblePositions: ["QB"],
        rosterStatus: "rostered",
        actual: {
          basis: { type: "week", week: 6 },
          notAggregated: [],
          stats: [
            { statId: 4, value: 287 },
            { statId: 9, value: 2 },
            { statId: 79, value: null },
          ],
        },
        projected: undefined,
      },
    ]);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect(
  "refuses a week the provider has not completed instead of substituting season totals",
  () => {
    const internet = recordingInternet(() => jsonResponse(yahooNflSeasonPlayerDetails));
    return Effect.gen(function* () {
      const provider = yield* testProvider;

      const error = yield* Effect.flip(
        provider.readPlayerDetails({
          ...sessionInput,
          providerLeagueKey: "466.l.4000",
          providerPlayerKeys: ["466.p.20001"],
          sport: "football",
          period: { kind: "week", week: 6 },
          currentPeriod: 6,
          seasonStart: "2026-09-03",
          seasonEnd: "2026-12-28",
        }),
      );

      assert.isTrue(Schema.is(ProviderPeriodUnsupported)(error));
      if (Schema.is(ProviderPeriodUnsupported)(error)) {
        assert.strictEqual(error.kind, "week");
        assert.strictEqual(error.declared, "native");
        assert.include(error.reason, "only for a completed scoring week");
        assert.include(error.remedy, '`kind: "season"`');
      }
      assert.deepStrictEqual(internet.calls, []);
    }).pipe(Effect.provide(yahooLayer(internet)));
  },
);

it.effect("reads a bounded player history in one request per period", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflSeasonPlayerDetails));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const history = yield* provider.readPlayerHistory({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      providerPlayerKeys: ["466.p.20001"],
      sport: "football",
      periods: [{ week: 6 }, { week: 7 }],
      currentPeriod: 6,
    });

    assert.deepStrictEqual(
      history.map((entry) => entry.period),
      [{ week: 6 }, { week: 7 }],
    );
    assert.strictEqual(internet.calls.length, 2);
    assert.include(internet.calls[0]?.url.href, "stats.type=season");
    assert.include(internet.calls[1]?.url.href, "stats.type=season");
    assert.notInclude(internet.calls[0]?.url.href, "percent_started");
    assert.strictEqual(history[0]?.details[0]?.providerPlayerKey, "466.p.20001");
    assert.strictEqual(history[1]?.details[0]?.providerPlayerKey, "466.p.20001");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("refuses a week whose completion cannot be verified", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflSeasonPlayerDetails));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readPlayerDetails({
        ...sessionInput,
        providerLeagueKey: "466.l.4000",
        providerPlayerKeys: ["466.p.20001"],
        sport: "football",
        period: { kind: "week", week: 6 },
        currentPeriod: undefined,
        seasonStart: "2026-09-03",
        seasonEnd: "2026-12-28",
      }),
    );

    assert.instanceOf(error, ProviderPeriodUnsupported);
    assert.deepStrictEqual(internet.calls, []);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads season statistics for hockey instead of requesting a weekly series", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNhlSeasonPlayerDetails));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const details = yield* provider.readPlayerDetails({
      ...sessionInput,
      providerLeagueKey: "466.l.4002",
      providerPlayerKeys: ["466.p.30001"],
      sport: "hockey",
      period: { kind: "season" },
      currentPeriod: 7,
      seasonStart: "2026-10-01",
      seasonEnd: "2027-04-01",
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4002/players;player_keys=466.p.30001;out=stats,ownership?format=json&stats.type=season",
    );
    assert.deepStrictEqual(details[0]?.actual, {
      basis: { type: "season" },
      notAggregated: [],
      stats: [
        { statId: 11, value: 4 },
        { statId: 12, value: 6 },
        { statId: 31, value: 23 },
      ],
    });
    assert.strictEqual(details[0]?.rosterStatus, "waiver");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reports no actual statistics when the provider omits the series", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNhlWeekPlayerDetails));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const details = yield* provider.readPlayerDetails({
      ...sessionInput,
      providerLeagueKey: "466.l.4002",
      providerPlayerKeys: ["466.p.30001"],
      sport: "hockey",
      period: { kind: "season" },
      currentPeriod: undefined,
      seasonStart: "2026-10-01",
      seasonEnd: "2027-04-01",
    });

    assert.strictEqual(details[0]?.actual, undefined);
    assert.strictEqual(details[0]?.name, "Synthetic Skater");
    assert.strictEqual(details[0]?.projected, undefined);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

const hockeySeasonWindow = { seasonStart: "2026-10-01", seasonEnd: "2027-04-01" };

const hockeyDailyFixture = (date: string): ReturnType<typeof yahooNhlDatePlayerDetails> =>
  yahooNhlDatePlayerDetails(date, [
    {
      playerKey: "466.p.30001",
      name: "Synthetic Skater",
      stats:
        date === "2026-10-20" || date === "2026-10-22"
          ? [
              { statId: 1, value: "2" },
              { statId: 14, value: "5" },
              { statId: 22, value: "1" },
              { statId: 23, value: "2.5" },
              { statId: 26, value: ".900" },
            ]
          : [
              { statId: 1, value: "-" },
              { statId: 14, value: "-" },
              { statId: 22, value: "-" },
              { statId: 23, value: "-" },
              { statId: 26, value: "-" },
            ],
    },
    {
      playerKey: "466.p.30002",
      name: "Synthetic Centre",
      stats: [
        { statId: 1, value: "0" },
        { statId: 14, value: "-" },
        { statId: 22, value: "-" },
        { statId: 23, value: "-" },
        { statId: 26, value: "-" },
      ],
    },
  ]);

it.effect("serves a hockey preset window as the sum of batched daily reads", () => {
  const internet = recordingInternet((request) =>
    jsonResponse(hockeyDailyFixture(request.url.searchParams.get("stats.date") ?? "2026-10-26")),
  );
  return Effect.gen(function* () {
    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-26T18:00:00Z")));
    const provider = yield* testProvider;

    const details = yield* provider.readPlayerDetails({
      ...sessionInput,
      providerLeagueKey: "466.l.4002",
      providerPlayerKeys: ["466.p.30001", "466.p.30002"],
      sport: "hockey",
      period: { kind: "preset", preset: "last_7_days" },
      currentPeriod: 4,
      ...hockeySeasonWindow,
    });

    assert.deepStrictEqual(
      internet.calls.map((call) => call.url.searchParams.get("stats.date")),
      [
        "2026-10-20",
        "2026-10-21",
        "2026-10-22",
        "2026-10-23",
        "2026-10-24",
        "2026-10-25",
        "2026-10-26",
      ],
    );
    assert.isTrue(
      internet.calls.every((call) => call.url.searchParams.get("stats.type") === "date"),
    );
    assert.isTrue(
      internet.calls.every((call) =>
        call.url.pathname.includes("player_keys=466.p.30001,466.p.30002"),
      ),
      "each day batches every requested player reference into one request",
    );
    assert.isTrue(internet.calls.every((call) => call.url.searchParams.get("format") === "json"));

    const skater = details.find((player) => player.providerPlayerKey === "466.p.30001");
    assert.deepStrictEqual(skater?.actual, {
      basis: { type: "date_range", start: "2026-10-20", end: "2026-10-26", days: 7 },
      stats: [
        { statId: 1, value: 4 },
        { statId: 14, value: 10 },
        { statId: 22, value: 2 },
      ],
      notAggregated: [
        {
          statId: 23,
          detail:
            "A rate or percentage is not summed across days; the provider publishes this category only as a season total or a single date.",
        },
        {
          statId: 26,
          detail:
            "A rate or percentage is not summed across days; the provider publishes this category only as a season total or a single date.",
        },
      ],
    });
    assert.strictEqual(skater?.name, "Synthetic Skater");

    const centre = details.find((player) => player.providerPlayerKey === "466.p.30002");
    assert.deepStrictEqual(
      centre?.actual?.stats.find((stat) => stat.statId === 1),
      { statId: 1, value: 0 },
      "a published zero is summed as zero, and a day without a game adds nothing",
    );
    assert.strictEqual(
      centre?.actual?.stats.find((stat) => stat.statId === 14)?.value,
      null,
      "a category the player never recorded stays null rather than becoming zero",
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("serves a range that covers the declared season as the season series", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNhlSeasonPlayerDetails));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const details = yield* provider.readPlayerDetails({
      ...sessionInput,
      providerLeagueKey: "466.l.4002",
      providerPlayerKeys: ["466.p.30001"],
      sport: "hockey",
      period: { kind: "range", start: "2026-09-01", end: "2027-04-30" },
      currentPeriod: 4,
      ...hockeySeasonWindow,
    });

    assert.strictEqual(internet.calls.length, 1);
    assert.include(internet.calls[0]?.url.href, "stats.type=season");
    assert.deepStrictEqual(details[0]?.actual?.basis, { type: "season" });
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("refuses a range longer than the declared cap and names the window it can serve", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNhlSeasonPlayerDetails));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readPlayerDetails({
        ...sessionInput,
        providerLeagueKey: "466.l.4002",
        providerPlayerKeys: ["466.p.30001"],
        sport: "hockey",
        period: { kind: "range", start: "2026-10-11", end: "2026-11-11" },
        currentPeriod: 4,
        ...hockeySeasonWindow,
      }),
    );

    assert.isTrue(Schema.is(ProviderPeriodUnsupported)(error));
    if (Schema.is(ProviderPeriodUnsupported)(error)) {
      assert.strictEqual(error.kind, "range");
      assert.strictEqual(error.declared, "aggregated");
      assert.include(error.reason, "32 days");
      assert.include(error.reason, "at most 31 days");
      assert.include(error.remedy, "at most 31 days");
      assert.include(error.remedy, '`kind: "preset"`');
    }
    assert.deepStrictEqual(internet.calls, []);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("declares each period kind's support as the capability table says", () => {
  const anyBody = (): typeof yahooNflSeasonPlayerDetails => yahooNflSeasonPlayerDetails;
  const cases = [
    {
      sport: "football" as const,
      period: { kind: "season" as const },
      sportWindow: { seasonStart: "2026-09-03", seasonEnd: "2026-12-28" },
      respond: () => yahooNflSeasonPlayerDetails,
    },
    {
      sport: "football" as const,
      period: { kind: "week" as const, week: 6 },
      sportWindow: { seasonStart: "2026-09-03", seasonEnd: "2026-12-28" },
      respond: () => yahooNflWeekPlayerDetails,
    },
    {
      sport: "football" as const,
      period: { kind: "preset" as const, preset: "last_7_days" as const },
      sportWindow: { seasonStart: "2026-09-03", seasonEnd: "2026-12-28" },
      respond: anyBody,
    },
    {
      sport: "football" as const,
      period: { kind: "range" as const, start: "2026-10-20", end: "2026-10-26" },
      sportWindow: { seasonStart: "2026-09-03", seasonEnd: "2026-12-28" },
      respond: anyBody,
    },
    {
      sport: "hockey" as const,
      period: { kind: "season" as const },
      sportWindow: hockeySeasonWindow,
      respond: () => yahooNhlSeasonPlayerDetails,
    },
    {
      sport: "hockey" as const,
      period: { kind: "week" as const, week: 4 },
      sportWindow: hockeySeasonWindow,
      respond: anyBody,
    },
    {
      sport: "hockey" as const,
      period: { kind: "preset" as const, preset: "last_14_days" as const },
      sportWindow: hockeySeasonWindow,
      respond: (url: URL) => hockeyDailyFixture(url.searchParams.get("stats.date") ?? ""),
    },
    {
      sport: "hockey" as const,
      period: { kind: "range" as const, start: "2026-10-20", end: "2026-10-26" },
      sportWindow: hockeySeasonWindow,
      respond: (url: URL) => hockeyDailyFixture(url.searchParams.get("stats.date") ?? ""),
    },
  ];

  return Effect.gen(function* () {
    yield* TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe("2026-10-26T18:00:00Z")));
    for (const entry of cases) {
      const declared = yahooCapabilities.statPeriods[entry.sport].kinds[entry.period.kind];
      const internet = recordingInternet((request) => jsonResponse(entry.respond(request.url)));
      const attempt = yield* Effect.gen(function* () {
        const provider = yield* testProvider;
        return yield* Effect.result(
          provider.readPlayerDetails({
            ...sessionInput,
            providerLeagueKey: entry.sport === "hockey" ? "466.l.4002" : "466.l.4000",
            providerPlayerKeys: [entry.sport === "hockey" ? "466.p.30001" : "466.p.20001"],
            sport: entry.sport,
            period: entry.period,
            currentPeriod: 7,
            ...entry.sportWindow,
          }),
        );
      }).pipe(Effect.provide(yahooLayer(internet)));
      const label = `${entry.sport} ${entry.period.kind}`;
      if (declared === "unsupported") {
        assert.strictEqual(attempt._tag, "Failure", label);
        assert.isTrue(
          attempt._tag === "Failure" && Schema.is(ProviderPeriodUnsupported)(attempt.failure),
          label,
        );
        assert.deepStrictEqual(internet.calls, [], label);
        continue;
      }
      assert.strictEqual(attempt._tag, "Success", label);
      if (attempt._tag !== "Success") {
        continue;
      }
      const basis = attempt.success[0]?.actual?.basis;
      if (declared === "native") {
        assert.strictEqual(internet.calls.length, 1, label);
        assert.notStrictEqual(basis?.type, "date_range", label);
      } else {
        assert.isAbove(internet.calls.length, 1, label);
        assert.strictEqual(basis?.type, "date_range", label);
      }
    }
  });
});

it.effect("reads a declared games limit and the team's per-position allowance", () => {
  const internet = recordingInternet((request) =>
    jsonResponse(
      request.url.pathname.endsWith("/settings")
        ? yahooNflLeagueSettingsWithGamesLimit
        : request.url.pathname.includes("/teams;")
          ? yahooNflGamesPlayed
          : yahooNflPlayerDetailsWithOwnership,
    ),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const league = yield* provider.readLeague({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      sport: "football",
    });
    const outcome = yield* provider.scoreRoster(
      planRequest({
        league,
        roster: planRoster({
          providerLeagueKey: "466.l.4000",
          coverage: weekSix,
          members: qbAndWideReceiver,
        }),
        target: { coverage: "week", week: 6 },
      }),
    );

    assert.strictEqual(league.maxGamesPlayed, 162);
    assert.strictEqual(league.maxInningsPitched, 1400);
    assert.strictEqual(outcome.kind, "scored");
    if (outcome.kind !== "scored") {
      return;
    }
    assert.deepStrictEqual(outcome.gamesPlayed, [
      { position: "QB", played: 12, max: 17, projected: 17 },
    ]);
    assert.strictEqual(
      internet.calls[1]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/teams;team_keys=466.l.4000.t.1;out=games_played?format=json",
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("maps the published innings allowance to the league's pitcher slot", () => {
  const internet = recordingInternet((request) =>
    jsonResponse(
      request.url.pathname.endsWith("/settings")
        ? yahooNflLeagueSettingsWithPitcherSlot
        : request.url.pathname.includes("/teams;")
          ? yahooNflGamesPlayed
          : yahooNflPlayerDetailsWithOwnership,
    ),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const league = yield* provider.readLeague({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      sport: "football",
    });
    const outcome = yield* provider.scoreRoster(
      planRequest({
        league,
        roster: planRoster({
          providerLeagueKey: "466.l.4000",
          coverage: weekSix,
          members: qbAndWideReceiver,
        }),
        target: { coverage: "week", week: 6 },
      }),
    );

    assert.strictEqual(outcome.kind, "scored");
    if (outcome.kind !== "scored") {
      return;
    }
    assert.deepStrictEqual(
      outcome.gamesPlayed.find((entry) => entry.position === "P"),
      { position: "P", played: 82.1, max: 1400, projected: 1400.1 },
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("prices a games-limited league from the ownership composite, not the crowd", () => {
  const internet = recordingInternet((request) =>
    jsonResponse(
      request.url.pathname.endsWith("/settings")
        ? yahooNflLeagueSettingsWithGamesLimit
        : request.url.pathname.includes("/teams;")
          ? yahooNflGamesPlayed
          : yahooNflPlayerDetailsWithOwnership,
    ),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const league = yield* provider.readLeague({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      sport: "football",
    });
    const outcome = yield* provider.scoreRoster(
      planRequest({
        league,
        roster: planRoster({
          providerLeagueKey: "466.l.4000",
          coverage: weekSix,
          members: qbAndWideReceiver,
        }),
        target: { coverage: "week", week: 6 },
      }),
    );

    assert.strictEqual(outcome.kind, "scored");
    if (outcome.kind !== "scored") {
      return;
    }
    assert.strictEqual(
      outcome.provenance,
      "yahoo/ownership-composite:no-positional-scarcity:football:week:6",
    );
    assert.deepStrictEqual(outcome.players, [
      { providerPlayerKey: "466.p.20001", score: 920000, availability: "will-play" },
      { providerPlayerKey: "466.p.20002", score: 125000, availability: "will-play" },
    ]);
    const factsRequest = internet.calls.find((call) => call.url.pathname.includes("/players;"));
    assert.include(factsRequest?.url.href, ";out=percent_started,percent_owned,ranks");
    assert.strictEqual(
      factsRequest?.url.searchParams.get("ranks"),
      "last30days,last14days,projected_next7days,projected_season_remaining,last4weeks,projected_week,projected_next4weeks",
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("scores a roster from the published started percentage and its platinum cut", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflPlayerDetailsWithPopulatedCut));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const outcome = yield* provider.scoreRoster(
      planRequest({
        league: planLeague({ providerLeagueKey: "466.l.4000", rosterCoverage: "week" }),
        roster: planRoster({
          providerLeagueKey: "466.l.4000",
          coverage: weekSix,
          members: qbAndWideReceiver,
        }),
        target: { coverage: "week", week: 6 },
      }),
    );

    assert.strictEqual(outcome.kind, "scored");
    if (outcome.kind !== "scored") {
      return;
    }
    assert.strictEqual(outcome.provenance, "yahoo/community-start-rate:cut-platinum:week:6");
    assert.deepStrictEqual(outcome.players, [
      { providerPlayerKey: "466.p.20001", score: 4100, availability: "will-play" },
      { providerPlayerKey: "466.p.20002", score: 6500, availability: "will-play" },
    ]);
    assert.include(internet.calls[0]?.url.href, ";out=percent_started");
    assert.include(internet.calls[0]?.url.href, "percent_started.cut_types=platinum");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("uses the overall started percentage and records an unpopulated cut", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflPlayerDetailsWithUnpopulatedCut));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const outcome = yield* provider.scoreRoster(
      planRequest({
        league: planLeague({ providerLeagueKey: "466.l.4000", rosterCoverage: "week" }),
        roster: planRoster({
          providerLeagueKey: "466.l.4000",
          coverage: weekSix,
          members: qbAndWideReceiver,
        }),
        target: { coverage: "week", week: 6 },
      }),
    );

    assert.strictEqual(outcome.kind, "scored");
    if (outcome.kind !== "scored") {
      return;
    }
    assert.strictEqual(
      outcome.provenance,
      "yahoo/community-start-rate:overall:platinum-cut-unpopulated:week:6",
    );
    assert.deepStrictEqual(
      outcome.players.map((player) => player.score),
      [3800, 7200],
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("leaves a player without a published started percentage unscored", () => {
  const internet = recordingInternet(() =>
    jsonResponse(yahooNhlPlayerDetailsWithMissingStartedValue),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const outcome = yield* provider.scoreRoster(
      planRequest({
        league: planLeague({ providerLeagueKey: "466.l.4002", rosterCoverage: "date" }),
        roster: planRoster({
          providerLeagueKey: "466.l.4002",
          coverage: { type: "date", date: "2026-10-26" },
          members: goalieAndCentre,
        }),
        target: { coverage: "date", date: "2026-10-26" },
      }),
    );

    assert.strictEqual(outcome.kind, "scored");
    if (outcome.kind !== "scored") {
      return;
    }
    assert.deepStrictEqual(outcome.players, [
      { providerPlayerKey: "466.p.30001", score: null, availability: "will-play" },
      { providerPlayerKey: "466.p.30002", score: 4300, availability: "will-play" },
    ]);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("fails loudly when a started percentage cannot be parsed", () => {
  const internet = recordingInternet(() =>
    jsonResponse(yahooNhlPlayerDetailsWithUnparseableStartedValue),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.scoreRoster(
        planRequest({
          league: planLeague({ providerLeagueKey: "466.l.4002", rosterCoverage: "date" }),
          roster: planRoster({
            providerLeagueKey: "466.l.4002",
            coverage: { type: "date", date: "2026-10-26" },
            members: [skaterMember],
          }),
          target: { coverage: "date", date: "2026-10-26" },
        }),
      ),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.strictEqual(error.field, "league.players.466.p.30001.percent_started.value");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("fails loudly when no player carries a started percentage", () => {
  const internet = recordingInternet(() =>
    jsonResponse(yahooNhlPlayerDetailsWithoutStartedPercentage),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.scoreRoster(
        planRequest({
          league: planLeague({ providerLeagueKey: "466.l.4002", rosterCoverage: "date" }),
          roster: planRoster({
            providerLeagueKey: "466.l.4002",
            coverage: { type: "date", date: "2026-10-26" },
            members: [skaterMember],
          }),
          target: { coverage: "date", date: "2026-10-26" },
        }),
      ),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.strictEqual(error.field, "league.players.percent_started");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reports the covered started period when it differs from the request", () => {
  const internet = recordingInternet(() =>
    jsonResponse(yahooNflPlayerDetailsWithMismatchedStartedCoverage),
  );
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.scoreRoster(
        planRequest({
          league: planLeague({ providerLeagueKey: "466.l.4000", rosterCoverage: "week" }),
          roster: planRoster({
            providerLeagueKey: "466.l.4000",
            coverage: weekSix,
            members: [quarterbackMember],
          }),
          target: { coverage: "week", week: 6 },
        }),
      ),
    );

    assert.instanceOf(error, ProviderPeriodMismatch);
    assert.deepStrictEqual(error.requested, { type: "week", week: 6 });
    assert.deepStrictEqual(error.covered, { type: "week", week: 5 });
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads a league scoreboard for the requested week", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflMatchups));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const matchups = yield* provider.readMatchups({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      period: { week: 6 },
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/scoreboard;week=6?format=json",
    );
    assert.deepStrictEqual(matchups, [
      {
        period: { week: 6 },
        home: {
          providerTeamKey: "466.l.4000.t.1",
          name: "Synthetic NFL Team",
          points: 101.25,
          projectedPoints: 109.4,
          winProbability: 0.62,
          remainingGames: undefined,
          categoryTotals: [],
        },
        away: {
          providerTeamKey: "466.l.4000.t.2",
          name: "Synthetic Rival",
          points: 98.5,
          projectedPoints: 104.1,
          winProbability: 0.38,
          remainingGames: undefined,
          categoryTotals: [],
        },
        status: "postevent",
        isPlayoffs: false,
        isConsolation: false,
        isTied: false,
        weekStart: "2026-10-15",
        weekEnd: "2026-10-19",
        categoryWinners: [],
      },
    ]);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads head-to-head point standings with record and season points", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflStandings));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const standings = yield* provider.readStandings({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/standings?format=json",
    );
    assert.deepStrictEqual(standings.teams, [
      {
        providerTeamKey: "466.l.4000.t.1",
        name: "Synthetic NFL Team",
        rank: 1,
        playoffSeed: 4,
        record: { wins: 8, losses: 6, ties: 0, percentage: 0.571 },
        gamesBack: null,
        pointsBack: null,
        points: 1583.16,
        pointsFor: 1583.16,
        pointsAgainst: 1447.26,
        streak: { type: "loss", value: 2 },
        categoryTotals: [],
        categoryPoints: [],
      },
      {
        providerTeamKey: "466.l.4000.t.2",
        name: "Synthetic Rival",
        rank: 2,
        playoffSeed: 3,
        record: { wins: 6, losses: 8, ties: 0, percentage: 0.429 },
        gamesBack: null,
        pointsBack: null,
        points: 1494.02,
        pointsFor: 1494.02,
        pointsAgainst: 1501.44,
        streak: { type: "win", value: 1 },
        categoryTotals: [],
        categoryPoints: [],
      },
    ]);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads category standings with season category totals and no roto points", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNhlCategoryStandings));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const standings = yield* provider.readStandings({
      ...sessionInput,
      providerLeagueKey: "466.l.4002",
    });

    const first = standings.teams[0];
    assert.deepStrictEqual(first?.record, {
      wins: 9,
      losses: 3,
      ties: 1,
      percentage: 0.731,
    });
    assert.deepStrictEqual(first?.categoryTotals, [
      { statId: 1, value: 37 },
      { statId: 2, value: 54 },
    ]);
    assert.deepStrictEqual(first?.categoryPoints, []);
    assert.isNull(first?.gamesBack);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads rotisserie standings without inventing a win-loss record", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNhlRotoStandings));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const standings = yield* provider.readStandings({
      ...sessionInput,
      providerLeagueKey: "466.l.4003",
    });

    const first = standings.teams[0];
    assert.isUndefined(first?.record);
    assert.strictEqual(first?.rank, 1);
    assert.strictEqual(first?.points, 92);
    assert.strictEqual(first?.pointsBack, 0);
    assert.deepStrictEqual(
      first?.categoryPoints.filter((entry) => entry.value === null),
      [
        { statId: 22, value: null },
        { statId: 25, value: null },
        { statId: 24, value: null },
      ],
    );
    assert.deepStrictEqual(first?.categoryPoints.slice(0, 4), [
      { statId: 1, value: 12 },
      { statId: 2, value: 8.5 },
      { statId: 3, value: 10 },
      { statId: 8, value: 11 },
    ]);
    assert.deepStrictEqual(first?.categoryPoints.slice(-2), [
      { statId: 29, value: 162 },
      { statId: 30, value: 15 },
    ]);
    assert.deepStrictEqual(first?.categoryTotals.slice(0, 3), [
      { statId: 1, value: 37 },
      { statId: 2, value: 54 },
      { statId: 3, value: 91 },
    ]);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("keeps the rotisserie fixture's published, empty, and unscored stat ids distinct", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNhlRotoStandings));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const standings = yield* provider.readStandings({
      ...sessionInput,
      providerLeagueKey: "466.l.4003",
    });

    const categories = [1, 2, 3, 8, 14, 31, 32, 19, 22, 23, 25, 24, 26];
    const unscored = [29, 30];
    const statIds = (team: (typeof standings.teams)[number]): ReadonlyArray<number> =>
      [
        ...new Set([
          ...team.categoryTotals.map((entry) => entry.statId),
          ...team.categoryPoints.map((entry) => entry.statId),
        ]),
      ].toSorted((left, right) => left - right);
    assert.deepStrictEqual(
      statIds(Array.getUnsafe(standings.teams, 0)),
      [...categories, ...unscored].toSorted((left, right) => left - right),
    );
    assert.deepStrictEqual(
      standings.teams.flatMap((team) =>
        team.categoryPoints.filter((entry) => entry.value === null).map((entry) => entry.statId),
      ),
      [22, 25, 24, 22, 25, 24, 22, 25, 24],
    );
    assert.isTrue(
      standings.teams.every(
        (team) =>
          team.categoryTotals.filter((entry) => [22, 24, 25].includes(entry.statId)).length === 3 &&
          team.categoryTotals
            .filter((entry) => [22, 24, 25].includes(entry.statId))
            .every((entry) => entry.value !== null),
      ),
    );
    assert.isTrue(
      standings.teams.every((team) =>
        team.categoryPoints
          .filter((entry) => unscored.includes(entry.statId))
          .every((entry) => entry.value !== null),
      ),
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("rejects standings for another league", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflStandings));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readStandings({ ...sessionInput, providerLeagueKey: "466.l.4999" }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.strictEqual(error.field, "league.league_key");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads category matchup values, winners, and remaining player-games", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNhlMatchupsWithGames));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const matchups = yield* provider.readMatchups({
      ...sessionInput,
      providerLeagueKey: "466.l.4002",
      period: { week: 4 },
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4002/scoreboard;week=4?format=json",
    );
    const matchup = Array.getUnsafe(matchups, 0);
    assert.deepStrictEqual(matchup.home.remainingGames, {
      week: 4,
      completed: 51,
      live: 3,
      remaining: 0,
    });
    assert.deepStrictEqual(matchup.away.remainingGames, {
      week: 4,
      completed: 48,
      live: 2,
      remaining: 4,
    });
    assert.deepStrictEqual(matchup.home.categoryTotals, [
      { statId: 1, value: 6 },
      { statId: 2, value: 9 },
    ]);
    assert.deepStrictEqual(matchup.categoryWinners, [
      { statId: 1, winnerProviderTeamKey: "466.l.4002.t.3", isTied: false },
      { statId: 2, winnerProviderTeamKey: undefined, isTied: true },
    ]);
    assert.isTrue(matchup.isPlayoffs);
    assert.isFalse(matchup.isConsolation);
    assert.isFalse(matchup.isTied);
    assert.strictEqual(matchup.weekStart, "2026-10-19");
    assert.strictEqual(matchup.weekEnd, "2026-10-25");
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reports a scoreboard period mismatch", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflMatchups));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readMatchups({
        ...sessionInput,
        providerLeagueKey: "466.l.4000",
        period: { week: 4 },
      }),
    );

    assert.instanceOf(error, ProviderPeriodMismatch);
    assert.deepStrictEqual(error.requested, { type: "week", week: 4 });
    assert.deepStrictEqual(error.covered, { type: "week", week: 6 });
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("scopes a transaction read to one team in the same league", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflTransactions));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    yield* provider.readTransactions({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      providerTeamKey: "466.l.4000.t.1",
      limit: 25,
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/transactions;count=25;team_key=466.l.4000.t.1?format=json",
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("refuses a transaction team filter from another league", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflTransactions));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readTransactions({
        ...sessionInput,
        providerLeagueKey: "466.l.4000",
        providerTeamKey: "466.l.4001.t.1",
        limit: 25,
      }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
    assert.deepStrictEqual(internet.calls, []);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads bounded league transaction history with dropped-player identity", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflTransactions));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const transactions = yield* provider.readTransactions({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      providerTeamKey: undefined,
      limit: 25,
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/transactions;count=25?format=json",
    );
    assert.deepStrictEqual(transactions, [
      {
        occurredAt: "2026-10-03T04:00:00.000Z",
        type: "add_drop",
        status: "successful",
        parties: undefined,
        teams: [{ providerTeamKey: "466.l.4000.t.1", name: "Synthetic Team" }],
        picks: [],
        players: [
          {
            providerPlayerKey: "466.p.20003",
            movement: {
              kind: "add",
              from: undefined,
              to: { providerTeamKey: "466.l.4000.t.1", name: "Synthetic Team" },
            },
            name: "Synthetic Addition",
            primaryPosition: undefined,
            displayPosition: "WR",
            eligiblePositions: undefined,
            proTeam: "SYN",
          },
          {
            providerPlayerKey: "466.p.20004",
            movement: {
              kind: "drop",
              from: { providerTeamKey: "466.l.4000.t.1", name: "Synthetic Team" },
              to: undefined,
            },
            name: "Synthetic Drop",
            primaryPosition: undefined,
            displayPosition: "RB",
            eligiblePositions: undefined,
            proTeam: "SYN",
          },
        ],
        incomplete: undefined,
      },
      {
        occurredAt: "2026-10-02T00:13:20.000Z",
        type: "drop",
        status: "successful",
        parties: undefined,
        teams: [{ providerTeamKey: "466.l.4000.t.2", name: "Synthetic Rival" }],
        picks: [],
        players: [
          {
            providerPlayerKey: "466.p.20005",
            movement: {
              kind: "drop",
              from: { providerTeamKey: "466.l.4000.t.2", name: "Synthetic Rival" },
              to: undefined,
            },
            name: "Synthetic Retired",
            primaryPosition: undefined,
            displayPosition: "TE",
            eligiblePositions: undefined,
            proTeam: "SYN",
          },
        ],
        incomplete: undefined,
      },
    ]);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("decodes both sides of a trade with the team each player left and joined", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflTradeTransactions));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const transactions = yield* provider.readTransactions({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      providerTeamKey: undefined,
      limit: 25,
    });

    assert.deepStrictEqual(transactions, [
      {
        occurredAt: "2026-10-05T08:46:40.000Z",
        type: "trade",
        status: "successful",
        parties: {
          source: "provider",
          entries: [
            {
              role: "proposer",
              team: { providerTeamKey: "466.l.4000.t.1", name: "Synthetic Team" },
            },
            {
              role: "receiver",
              team: { providerTeamKey: "466.l.4000.t.2", name: "Synthetic Rival" },
            },
          ],
        },
        teams: [
          { providerTeamKey: "466.l.4000.t.1", name: "Synthetic Team" },
          { providerTeamKey: "466.l.4000.t.2", name: "Synthetic Rival" },
        ],
        picks: [],
        players: [
          {
            providerPlayerKey: "466.p.20003",
            movement: {
              kind: "trade",
              from: { providerTeamKey: "466.l.4000.t.1", name: "Synthetic Team" },
              to: { providerTeamKey: "466.l.4000.t.2", name: "Synthetic Rival" },
            },
            name: "Synthetic Sender",
            primaryPosition: undefined,
            displayPosition: "WR",
            eligiblePositions: undefined,
            proTeam: "SYN",
          },
          {
            providerPlayerKey: "466.p.20006",
            movement: {
              kind: "trade",
              from: { providerTeamKey: "466.l.4000.t.2", name: "Synthetic Rival" },
              to: { providerTeamKey: "466.l.4000.t.1", name: "Synthetic Team" },
            },
            name: "Synthetic Return",
            primaryPosition: undefined,
            displayPosition: "RB",
            eligiblePositions: undefined,
            proTeam: "SYN",
          },
        ],
        incomplete: undefined,
      },
    ]);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("derives trade parties from the player movements when the payload omits them", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflTradeTransactionsWithoutPartyKeys));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const transactions = yield* provider.readTransactions({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      providerTeamKey: undefined,
      limit: 25,
    });

    const transaction = Array.getUnsafe(transactions, 0);
    assert.deepStrictEqual(transaction.parties, {
      source: "player_movements",
      entries: [
        {
          role: "participant",
          team: { providerTeamKey: "466.l.4000.t.1", name: "Synthetic Team" },
        },
        {
          role: "participant",
          team: { providerTeamKey: "466.l.4000.t.2", name: "Synthetic Rival" },
        },
      ],
    });
    assert.strictEqual(transaction.players.length, 2);
    assert.isUndefined(transaction.incomplete);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("marks a trade with no player movements incomplete instead of empty", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflEmptyTradeTransaction));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const transactions = yield* provider.readTransactions({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      providerTeamKey: undefined,
      limit: 25,
    });

    assert.deepStrictEqual(transactions, [
      {
        occurredAt: "2026-10-03T04:00:00.000Z",
        type: "trade",
        status: "successful",
        parties: {
          source: "provider",
          entries: [
            {
              role: "proposer",
              team: { providerTeamKey: "466.l.4000.t.1", name: "Synthetic Team" },
            },
            {
              role: "receiver",
              team: { providerTeamKey: "466.l.4000.t.2", name: "Synthetic Rival" },
            },
          ],
        },
        teams: [
          { providerTeamKey: "466.l.4000.t.1", name: "Synthetic Team" },
          { providerTeamKey: "466.l.4000.t.2", name: "Synthetic Rival" },
        ],
        picks: [],
        players: [],
        incomplete: {
          code: "no_movements",
          detail:
            "The provider published this transaction with no player movements and no traded picks, so neither side can be reconstructed. This is not evidence that no assets moved.",
        },
      },
    ]);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("decodes traded draft picks as part of the trade", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflTradeWithPicks));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const transactions = yield* provider.readTransactions({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      providerTeamKey: undefined,
      limit: 25,
    });

    const trade = Array.getUnsafe(transactions, 0);
    assert.deepStrictEqual(trade.picks, [
      {
        round: 10,
        from: { providerTeamKey: "466.l.4000.t.1", name: "Synthetic Team" },
        to: { providerTeamKey: "466.l.4000.t.2", name: "Synthetic Rival" },
        original: { providerTeamKey: "466.l.4000.t.1", name: "Synthetic Team" },
      },
      {
        round: 1,
        from: { providerTeamKey: "466.l.4000.t.2", name: "Synthetic Rival" },
        to: { providerTeamKey: "466.l.4000.t.1", name: "Synthetic Team" },
        original: { providerTeamKey: "466.l.4000.t.2", name: "Synthetic Rival" },
      },
    ]);
    assert.strictEqual(trade.players.length, 1);
    assert.isUndefined(trade.incomplete);
    assert.strictEqual(trade.teams.length, 2);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads a pick-only trade as complete instead of an empty transaction", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflPickOnlyTrade));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const transactions = yield* provider.readTransactions({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      providerTeamKey: undefined,
      limit: 25,
    });

    const trade = Array.getUnsafe(transactions, 0);
    assert.deepStrictEqual(trade.players, []);
    assert.strictEqual(trade.picks.length, 2);
    assert.isUndefined(trade.incomplete);
    assert.deepStrictEqual(
      trade.teams.map((team) => team.name),
      ["Synthetic Team", "Synthetic Rival"],
    );
    assert.deepStrictEqual(
      trade.parties?.entries.map((party) => party.role),
      ["proposer", "receiver"],
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("marks a trade whose published movements go one way incomplete", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflSinglePlayerTrade));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const transactions = yield* provider.readTransactions({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
      providerTeamKey: undefined,
      limit: 25,
    });

    const trade = Array.getUnsafe(transactions, 0);
    assert.strictEqual(trade.type, "trade");
    assert.strictEqual(trade.players.length, 1);
    assert.deepStrictEqual(trade.incomplete, {
      code: "trade_return_unpublished",
      detail:
        "The provider published no returning player and no traded draft pick for this trade, so the return side cannot be reconstructed; do not treat this as a one-for-nothing trade.",
    });
    assert.deepStrictEqual(
      trade.parties?.entries.map((party) => party.role),
      ["proposer", "receiver"],
    );
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads a league's draft results with round, pick, team, and player", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflDraftResults));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const picks = yield* provider.readDraftResults({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/draftresults?format=json",
    );
    assert.deepStrictEqual(picks, [
      {
        round: 1,
        pick: 1,
        providerTeamKey: "466.l.4000.t.1",
        providerPlayerKey: "466.p.20003",
      },
      {
        round: 1,
        pick: 2,
        providerTeamKey: "466.l.4000.t.2",
        providerPlayerKey: "466.p.20006",
      },
      {
        round: 2,
        pick: 3,
        providerTeamKey: "466.l.4000.t.1",
        providerPlayerKey: "466.p.20009",
      },
    ]);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("reads league team membership", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflLeagueTeams));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const teams = yield* provider.readLeagueTeams({
      ...sessionInput,
      providerLeagueKey: "466.l.4000",
    });

    assert.strictEqual(
      internet.calls[0]?.url.href,
      "https://pub-api-ro.fantasysports.yahoo.com/fantasy/v2/league/466.l.4000/teams?format=json",
    );
    assert.deepStrictEqual(teams, [
      {
        providerTeamKey: "466.l.4000.t.1",
        providerLeagueKey: "466.l.4000",
        name: "Synthetic NFL Team",
      },
      {
        providerTeamKey: "466.l.4000.t.2",
        providerLeagueKey: "466.l.4000",
        name: "Synthetic Rival",
      },
    ]);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect("rejects league membership that names another league", () => {
  const internet = recordingInternet(() => jsonResponse(yahooNflLeagueTeamsForAnotherLeague));
  return Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.readLeagueTeams({
        ...sessionInput,
        providerLeagueKey: "466.l.4000",
      }),
    );

    assert.instanceOf(error, ProviderResponseInvalid);
  }).pipe(Effect.provide(yahooLayer(internet)));
});

it.effect.each([
  {
    sport: "football" as const,
    leagueWebUrl: "https://football.fantasysports.yahoo.com/f1/1000",
    providerLeagueKey: "461.l.1000",
    name: "add",
    intent: { kind: "add" as const, add: "461.p.10001" },
    expected: "https://football.fantasysports.yahoo.com/f1/1000/addplayer?apid=10001",
  },
  {
    sport: "football" as const,
    leagueWebUrl: "https://football.fantasysports.yahoo.com/f1/1000",
    providerLeagueKey: "461.l.1000",
    name: "add/drop",
    intent: { kind: "add_drop" as const, add: "461.p.10001", drop: "461.p.10002" },
    expected: "https://football.fantasysports.yahoo.com/f1/1000/addplayer?apid=10001&dpid=10002",
  },
  {
    sport: "football" as const,
    leagueWebUrl: "https://football.fantasysports.yahoo.com/f1/1000",
    providerLeagueKey: "461.l.1000",
    name: "drop",
    intent: { kind: "drop" as const, drop: "461.p.10002" },
    expected: "https://football.fantasysports.yahoo.com/f1/1000/4/dropplayer?pid=10002",
  },
  {
    sport: "hockey" as const,
    leagueWebUrl: "https://hockey.fantasysports.yahoo.com/hockey/2000",
    providerLeagueKey: "461.l.2000",
    name: "add",
    intent: { kind: "add" as const, add: "461.p.10001" },
    expected: "https://hockey.fantasysports.yahoo.com/hockey/2000/addplayer?apid=10001",
  },
  {
    sport: "hockey" as const,
    leagueWebUrl: "https://hockey.fantasysports.yahoo.com/hockey/2000",
    providerLeagueKey: "461.l.2000",
    name: "add/drop",
    intent: { kind: "add_drop" as const, add: "461.p.10001", drop: "461.p.10002" },
    expected: "https://hockey.fantasysports.yahoo.com/hockey/2000/addplayer?apid=10001&dpid=10002",
  },
  {
    sport: "hockey" as const,
    leagueWebUrl: "https://hockey.fantasysports.yahoo.com/hockey/2000",
    providerLeagueKey: "461.l.2000",
    name: "drop",
    intent: { kind: "drop" as const, drop: "461.p.10002" },
    expected: "https://hockey.fantasysports.yahoo.com/hockey/2000/4/dropplayer?pid=10002",
  },
])(
  "builds the exact $sport review URL for $name",
  ({ sport, leagueWebUrl, providerLeagueKey, intent, expected }) =>
    Effect.gen(function* () {
      const provider = yield* testProvider;

      const link = yield* provider.buildReviewLink({
        providerLeagueKey,
        providerTeamKey: `${providerLeagueKey}.t.4`,
        leagueWebUrl,
        sport,
        intent,
      });

      assert.strictEqual(link, expected);
      assert.strictEqual(provider.reviewLinkTemplate.version, "yahoo-review-links-v2");
    }).pipe(Effect.provide(yahooLayer(recordingInternet(() => jsonResponse({}))))),
);

it.effect("publishes no parameterized trade review link", () =>
  Effect.gen(function* () {
    const provider = yield* testProvider;

    const error = yield* Effect.flip(
      provider.buildReviewLink({
        providerLeagueKey: "461.l.1000",
        providerTeamKey: "461.l.1000.t.4",
        leagueWebUrl: "https://football.fantasysports.yahoo.com/f1/1000",
        sport: "football",
        intent: {
          kind: "trade",
          send: ["461.p.10001"],
          receive: ["461.p.10002"],
        },
      }),
    );

    assert.instanceOf(error, ProviderReviewLinkInvalid);
    assert.strictEqual(error.reason, "unsupported-review-surface");
  }).pipe(Effect.provide(yahooLayer(recordingInternet(() => jsonResponse({}))))),
);

it.effect("rejects review links for a foreign host or a non-numeric player key", () =>
  Effect.gen(function* () {
    const provider = yield* testProvider;

    const foreign = yield* Effect.flip(
      provider.buildReviewLink({
        providerLeagueKey: "461.l.1000",
        providerTeamKey: "461.l.1000.t.4",
        leagueWebUrl: "https://evil.test/f1/1000",
        sport: "football",
        intent: { kind: "add", add: "461.p.10001" },
      }),
    );
    const nonNumeric = yield* Effect.flip(
      provider.buildReviewLink({
        providerLeagueKey: "461.l.1000",
        providerTeamKey: "461.l.1000.t.4",
        leagueWebUrl: "https://football.fantasysports.yahoo.com/f1/1000",
        sport: "football",
        intent: { kind: "add", add: "461.p.not-a-number" },
      }),
    );

    assert.instanceOf(foreign, ProviderReviewLinkInvalid);
    assert.strictEqual(foreign.reason, "unsupported-league-url");
    assert.instanceOf(nonNumeric, ProviderReviewLinkInvalid);
    assert.strictEqual(nonNumeric.reason, "unsupported-player-key");
  }).pipe(Effect.provide(yahooLayer(recordingInternet(() => jsonResponse({}))))),
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

const testProvider = Effect.gen(function* () {
  const registry = yield* ProviderRegistry;
  return yield* registry.requireProvider(decodeProviderKey("yahoo"));
});

function yahooLayer(
  internet: Layer.Layer<PublicInternet> | { readonly layer: Layer.Layer<PublicInternet> },
): Layer.Layer<ProviderRegistry> {
  return Layer.effect(ProviderRegistry)(
    Effect.map(yahooProvider, (provider) => ProviderRegistry.of(providerRegistryOf([provider]))),
  ).pipe(Layer.provide("layer" in internet ? internet.layer : internet));
}

const sessionInput = {
  provider: decodeProviderKey("yahoo"),
  session: Redacted.make("A1=canary-cookie-value; A3=another-cookie-value"),
};

const weekSix = { type: "week" as const, week: 6 };

const quarterbackMember = rosterMember("466.p.20001", "QB", "QB", ["QB"]);
const receiverMember = rosterMember("466.p.20002", "WR", "BN", ["WR"]);
const goalieMember = rosterMember("466.p.30001", "G", "G", ["G", "IR+"]);
const centreMember = rosterMember("466.p.30002", "C", "C", ["C"]);

const qbAndWideReceiver = [quarterbackMember, receiverMember];
const goalieAndCentre = [goalieMember, centreMember];
const skaterMember = rosterMember("466.p.30001", "C", "C", ["C", "LW"]);

function rosterMember(
  providerPlayerKey: string,
  primaryPosition: string,
  slot: string,
  eligiblePositions: ReadonlyArray<string>,
): ProviderRoster["players"][number] {
  return {
    providerPlayerKey,
    name: providerPlayerKey,
    displayPosition: primaryPosition,
    primaryPosition,
    positionType: "O",
    proTeamAbbreviation: undefined,
    eligiblePositions,
    slot,
    isEditable: true,
    injuryCode: undefined,
    injuryDetail: undefined,
    byeWeek: null,
    scheduled: true,
    startingLineup: "unconfirmed",
    undroppable: false,
  };
}

function planLeague(input: {
  readonly providerLeagueKey: string;
  readonly rosterCoverage: "week" | "date";
}): ProviderLeagueSettings {
  return {
    providerLeagueKey: input.providerLeagueKey,
    name: "Synthetic League",
    webUrl: `https://football.fantasysports.yahoo.com/f1/${input.providerLeagueKey}`,
    season: 2026,
    periodWindow: input.rosterCoverage === "week" ? { current: 6, start: 1, end: 17 } : undefined,
    rosterCoverage: input.rosterCoverage,
    maxGamesPlayed: undefined,
    maxInningsPitched: undefined,
    startDate: "2026-09-03",
    endDate: "2026-12-28",
    teamCount: 10,
    format: "head_to_head_points",
    scoringType: "head",
    scoringLabel: "H2H",
    weeklyDeadline: undefined,
    waiverType: "FR",
    waiverRule: "continuous",
    usesFaab: false,
    waiverDays: undefined,
    maxWeeklyAcquisitions: undefined,
    maxSeasonAcquisitions: undefined,
    tradeEndDate: undefined,
    tradeRatification: undefined,
    tradeObjectionDays: undefined,
    draftStatus: "postdraft",
    rosterPositions: [
      {
        position: input.rosterCoverage === "week" ? "QB" : "G",
        positionType: "O",
        count: 1,
        kind: "starting",
        eligibility: [input.rosterCoverage === "week" ? "QB" : "G"],
      },
      {
        position: "BN",
        positionType: "B",
        count: 2,
        kind: "bench",
        eligibility: [],
      },
    ],
    statCategories: [],
    statModifiers: [],
  };
}

function planRoster(input: {
  readonly providerLeagueKey: string;
  readonly coverage: ProviderRoster["coverage"];
  readonly members: ReadonlyArray<ProviderRoster["players"][number]>;
}): ProviderRoster {
  return {
    providerTeamKey: `${input.providerLeagueKey}.t.1`,
    providerLeagueKey: input.providerLeagueKey,
    coverage: input.coverage,
    players: input.members,
  };
}

function planRequest(input: {
  readonly league: ProviderLeagueSettings;
  readonly roster: ProviderRoster;
  readonly target:
    | { readonly coverage: "week"; readonly week: number }
    | { readonly coverage: "date"; readonly date: string };
}): ProviderScoreRequest {
  return {
    ...sessionInput,
    providerTeamKey: input.roster.providerTeamKey,
    providerLeagueKey: input.roster.providerLeagueKey,
    sport: input.league.rosterCoverage === "week" ? "football" : "hockey",
    league: input.league,
    roster: input.roster,
    target: Schema.decodeSync(LineupTargetPeriod)(input.target),
  };
}
