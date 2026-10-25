import { Effect, Layer, Redacted, Schema, SchemaTransformation } from "effect";

import {
  ProviderCrumbUnavailable,
  ProviderGateway,
  ProviderOperationUnsupported,
  ProviderPeriodMismatch,
  ProviderRequestFailed,
  ProviderResponseInvalid,
  ProviderReviewLinkInvalid,
  ProviderSessionMaterial,
  ProviderSessionRejected,
} from "#contexts/connections/Provider.ts";
import type {
  ProviderLeagueSettings,
  ProviderOperation,
  ProviderPeriod,
  ProviderPlayerSearchInput,
  ProviderRoster,
  ProviderRosterPlayer,
  ProviderReviewLinkInput,
  ProviderTeam,
} from "#contexts/connections/Provider.ts";
import { PublicInternet } from "#runtime/PublicInternet.ts";

import { normalizeYahooJson } from "./YahooJson.ts";
import { yahooReadDeadlineMillis, yahooReadResponseLimitBytes } from "./YahooLimits.ts";

const readOrigin = new URL("https://pub-api-ro.fantasysports.yahoo.com");
const serviceOrigin = new URL("https://pub-api.fantasysports.yahoo.com");
const supportedLeagues = ["nfl", "nhl"] as const;
const leagueSport = {
  nfl: "football",
  nhl: "hockey",
} as const;
const reviewHosts = {
  football: "football.fantasysports.yahoo.com",
  hockey: "hockey.fantasysports.yahoo.com",
} as const;

type ReadOperation =
  | "validate_session"
  | "discover_teams"
  | "read_crumb"
  | "read_league"
  | "read_roster";

export const YahooProvider = Layer.effect(
  ProviderGateway,
  Effect.gen(function* () {
    const internet = yield* PublicInternet;

    const validateSession = Effect.fn("YahooProvider.validateSession")(function* (
      input: ProviderSessionMaterial,
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "validate_session");
      const cookie = yield* sessionCookie(input, "validate_session");
      const payload = yield* readJson(internet, {
        operation: "validate_session",
        origin: readOrigin,
        path: "/fantasy/v2/users;use_login=1",
        query: { format: "json" },
        cookie,
        normalize: true,
      });
      const session = yield* decodePayload(SessionPayload, payload, "validate_session");
      if (session.users.length === 0) {
        return yield* ProviderSessionRejected.make({ operation: "validate_session" });
      }
    });

    const discoverTeams = Effect.fn("YahooProvider.discoverTeams")(function* (
      input: ProviderSessionMaterial,
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "discover_teams");
      const cookie = yield* sessionCookie(input, "discover_teams");
      const teams: ProviderTeam[] = [];
      for (const league of supportedLeagues) {
        const payload = yield* readJson(internet, {
          operation: "discover_teams",
          origin: readOrigin,
          path: `/fantasy/v2/users;use_login=1/games;game_keys=${league}/teams`,
          query: { format: "json" },
          cookie,
          normalize: true,
        });
        const decoded = yield* decodePayload(TeamsPayload, payload, "discover_teams");
        if (decoded.users.length === 0) {
          return yield* ProviderSessionRejected.make({ operation: "discover_teams" });
        }
        for (const team of teamsFromPayload(decoded, league)) {
          teams.push(team);
        }
      }
      yield* Effect.annotateCurrentSpan("provider.team_count", teams.length);
      return teams;
    });

    const readCrumb = Effect.fn("YahooProvider.readCrumb")(function* (
      input: ProviderSessionMaterial,
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "read_crumb");
      const cookie = yield* sessionCookie(input, "read_crumb");
      const payload = yield* readJson(internet, {
        operation: "read_crumb",
        origin: serviceOrigin,
        path: "/fantasy/v3/getCrumb",
        query: { format: "json_f" },
        cookie,
        normalize: false,
      });
      const decoded = yield* decodePayload(CrumbPayload, payload, "read_crumb");
      const crumb = decoded.service.crumb?.trim();
      if (crumb === undefined || crumb.length === 0) {
        return yield* ProviderCrumbUnavailable.make({ operation: "read_crumb" });
      }
      return { crumb: Redacted.make(crumb) };
    });

    const readLeague = Effect.fn("YahooProvider.readLeague")(function* (
      input: ProviderSessionMaterial & {
        readonly providerLeagueKey: string;
        readonly sport: "football" | "hockey";
      },
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "read_league");
      const cookie = yield* sessionCookie(input, "read_league");
      const leagueKey = yield* ValidLeagueKey(input.providerLeagueKey, "read_league");
      const payload = yield* readJson(internet, {
        operation: "read_league",
        origin: readOrigin,
        path: `/fantasy/v2/league/${leagueKey}/settings`,
        query: { format: "json" },
        cookie,
        normalize: true,
      });
      const decoded = yield* decodePayload(LeaguePayload, payload, "read_league");
      const settings = yield* leagueSettings(decoded, input.providerLeagueKey, input.sport);
      yield* Effect.annotateCurrentSpan({
        "provider.stat_category_count": settings.statCategories.length,
        "provider.roster_position_count": settings.rosterPositions.length,
      });
      return settings;
    });

    const readRoster = Effect.fn("YahooProvider.readRoster")(function* (
      input: ProviderSessionMaterial & {
        readonly providerTeamKey: string;
        readonly period: ProviderPeriod | undefined;
      },
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "read_roster");
      const cookie = yield* sessionCookie(input, "read_roster");
      const teamKey = yield* ValidTeamKey(input.providerTeamKey, "read_roster");
      const week = input.period === undefined ? undefined : yield* ValidWeek(input.period.week);
      const periodSuffix = week === undefined ? "" : `;week=${String(week)}`;
      const payload = yield* readJson(internet, {
        operation: "read_roster",
        origin: readOrigin,
        path: `/fantasy/v2/team/${teamKey}/roster${periodSuffix}`,
        query: { format: "json" },
        cookie,
        normalize: true,
      });
      const decoded = yield* decodePayload(TeamRosterPayload, payload, "read_roster");
      const roster = yield* rosterFromPayload(decoded, input.providerTeamKey, input.period);
      yield* Effect.annotateCurrentSpan("provider.player_count", roster.players.length);
      return roster;
    });

    const unsupported = (
      operation: ProviderOperation,
      reason: string,
    ): Effect.Effect<never, ProviderOperationUnsupported> =>
      ProviderOperationUnsupported.make({ operation, reason });

    const readPlayerDetails = Effect.fn("YahooProvider.readPlayerDetails")(function* () {
      yield* Effect.annotateCurrentSpan("provider.operation", "read_player_details");
      return yield* unsupported(
        "read_player_details",
        "Selected-player statistics and projections are not verified for this provider.",
      );
    });

    const searchPlayers = Effect.fn("YahooProvider.searchPlayers")(function* (
      _input: ProviderPlayerSearchInput,
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "search_players");
      return yield* unsupported(
        "search_players",
        "Free-agent and waiver player search is not verified for this provider.",
      );
    });

    const readMatchups = Effect.fn("YahooProvider.readMatchups")(function* () {
      yield* Effect.annotateCurrentSpan("provider.operation", "read_matchups");
      return yield* unsupported(
        "read_matchups",
        "League matchup reads are not verified for this provider.",
      );
    });

    const readTransactions = Effect.fn("YahooProvider.readTransactions")(function* () {
      yield* Effect.annotateCurrentSpan("provider.operation", "read_transactions");
      return yield* unsupported(
        "read_transactions",
        "Transaction history reads are not verified for this provider.",
      );
    });

    const readLeagueTeams = Effect.fn("YahooProvider.readLeagueTeams")(function* () {
      yield* Effect.annotateCurrentSpan("provider.operation", "read_league_teams");
      return yield* unsupported(
        "read_league_teams",
        "League team membership reads are not verified for this provider.",
      );
    });

    const buildReviewLink = Effect.fn("YahooProvider.buildReviewLink")(function* (
      input: ProviderReviewLinkInput,
    ) {
      yield* Effect.annotateCurrentSpan("provider.operation", "build_review_link");
      const base = yield* Effect.try({
        try: () =>
          reviewBase(input.leagueWebUrl, input.sport, leagueIdFromKey(input.providerLeagueKey)),
        catch: () => ProviderReviewLinkInvalid.make({ reason: "unsupported-league-url" }),
      });
      const url = yield* Effect.try({
        try: () => reviewUrl(base, input.intent),
        catch: () => ProviderReviewLinkInvalid.make({ reason: "unsupported-player-key" }),
      });
      if (
        url.origin !== base.origin ||
        url.username !== "" ||
        url.password !== "" ||
        url.hash !== "" ||
        !url.pathname.startsWith(`${base.pathname}/`) ||
        [...url.searchParams.keys()].some((name) => name !== "apid" && name !== "dpid")
      ) {
        return yield* ProviderReviewLinkInvalid.make({ reason: "unsupported-review-surface" });
      }
      return url.href;
    });

    return ProviderGateway.of({
      validateSession,
      discoverTeams,
      readCrumb,
      readLeague,
      readRoster,
      readPlayerDetails,
      searchPlayers,
      readMatchups,
      readTransactions,
      readLeagueTeams,
      buildReviewLink,
    });
  }),
);

function sessionCookie(
  input: ProviderSessionMaterial,
  operation: ReadOperation,
): Effect.Effect<string, ProviderSessionRejected> {
  return Schema.decodeEffect(ProviderSessionMaterial)(input).pipe(
    Effect.flatMap((material) =>
      Schema.decodeEffect(SessionCookie)(Redacted.value(material.session)),
    ),
    Effect.mapError(() => ProviderSessionRejected.make({ operation })),
  );
}

type ReadRequest = {
  readonly operation: ReadOperation;
  readonly origin: URL;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly cookie: string;
  readonly normalize: boolean;
};

function readJson(
  internet: PublicInternet["Service"],
  request: ReadRequest,
): Effect.Effect<
  unknown,
  ProviderRequestFailed | ProviderResponseInvalid | ProviderSessionRejected
> {
  return Effect.scoped(
    Effect.gen(function* () {
      const url = yield* Effect.try({
        try: () => yahooUrl(request.origin, request.path, request.query),
        catch: () => ProviderResponseInvalid.make({ operation: request.operation }),
      });
      const response = yield* internet
        .request(
          new Request(url, {
            method: "GET",
            headers: {
              accept: "application/json",
              cookie: request.cookie,
            },
          }),
          {
            timeoutMs: yahooReadDeadlineMillis,
            maxResponseBytes: yahooReadResponseLimitBytes,
          },
        )
        .pipe(Effect.mapError(() => ProviderRequestFailed.make({ operation: request.operation })));

      if (response.status === 401 || response.status === 403) {
        yield* discardBody(response);
        return yield* ProviderSessionRejected.make({ operation: request.operation });
      }
      if (!response.ok) {
        yield* discardBody(response);
        return yield* ProviderRequestFailed.make({ operation: request.operation });
      }

      const text = yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => ProviderRequestFailed.make({ operation: request.operation }),
      });
      const payload = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Unknown))(text).pipe(
        Effect.mapError(() => ProviderResponseInvalid.make({ operation: request.operation })),
      );
      return request.normalize ? normalizeYahooJson(payload) : payload;
    }),
  );
}

function discardBody(response: Response): Effect.Effect<void> {
  return Effect.tryPromise({
    try: () => response.body?.cancel() ?? Promise.resolve(),
    catch: () => "discard_failed" as const,
  }).pipe(Effect.ignore);
}

function yahooUrl(origin: URL, path: string, query: Readonly<Record<string, string>>): URL {
  if (!path.startsWith("/") || path.includes("?") || path.includes("#")) {
    throw new Error("Yahoo path must be a relative path without query or fragment");
  }
  const url = new URL(path, origin);
  if (
    url.origin !== origin.origin ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== path
  ) {
    throw new Error("Yahoo request escaped its fixed origin");
  }
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
  if ([...url.searchParams.keys()].some((key) => key !== "format")) {
    throw new Error("Yahoo request contains an unsupported query field");
  }
  return url;
}

function decodePayload<A, E>(
  schema: Schema.Codec<A, E>,
  payload: unknown,
  operation: ProviderOperation,
): Effect.Effect<A, ProviderResponseInvalid> {
  return Schema.decodeUnknownEffect(schema)(payload).pipe(
    Effect.mapError(() => ProviderResponseInvalid.make({ operation })),
  );
}

function teamsFromPayload(
  payload: typeof TeamsPayload.Type,
  league: (typeof supportedLeagues)[number],
): ReadonlyArray<ProviderTeam> {
  return payload.users.flatMap((user) =>
    user.games.flatMap((game) => {
      const season = game.season;
      const teams = game.teams ?? [];
      return teams.map((team) => {
        const leagueKey = providerLeagueKey(team.team_key);
        return {
          provider: "yahoo" as const,
          providerTeamKey: team.team_key,
          providerLeagueKey: leagueKey,
          league,
          sport: leagueSport[league],
          season,
          name: team.name,
        };
      });
    }),
  );
}

function providerLeagueKey(teamKey: string): string {
  return teamKey.slice(0, teamKey.lastIndexOf(".t."));
}

function leagueSettings(
  payload: typeof LeaguePayload.Type,
  requestedLeagueKey: string,
  sport: "football" | "hockey",
): Effect.Effect<ProviderLeagueSettings, ProviderResponseInvalid> {
  return Effect.gen(function* () {
    const attributes = payload.league;
    const settings = singleEntry(attributes.settings);
    if (settings === undefined || attributes.league_key !== requestedLeagueKey) {
      return yield* ProviderResponseInvalid.make({ operation: "read_league" });
    }
    const webUrl = yield* Effect.try({
      try: () => reviewBase(attributes.url, sport, leagueIdFromKey(attributes.league_key)).href,
      catch: () => ProviderResponseInvalid.make({ operation: "read_league" }),
    });
    return {
      providerLeagueKey: attributes.league_key,
      name: attributes.name,
      webUrl,
      season: attributes.season,
      currentWeek: attributes.current_week,
      startWeek: attributes.start_week,
      endWeek: attributes.end_week,
      startDate: optionalNonEmpty(attributes.start_date),
      endDate: optionalNonEmpty(attributes.end_date),
      teamCount: attributes.num_teams,
      scoringType: attributes.scoring_type,
      scoringLabel: optionalNonEmpty(attributes.scoring_label),
      weeklyDeadline: optionalNonEmpty(attributes.weekly_deadline),
      waiverType: optionalNonEmpty(settings.waiver_type),
      waiverRule: optionalNonEmpty(settings.waiver_rule),
      usesFaab: settings.uses_faab,
      draftStatus: optionalNonEmpty(attributes.draft_status),
      rosterPositions: settings.roster_positions.map(({ roster_position }) => ({
        position: roster_position.position,
        positionType: optionalNonEmpty(roster_position.position_type),
        count: roster_position.count,
        isStarting: roster_position.is_starting_position,
      })),
      statCategories: settings.stat_categories.stats.map(({ stat }) => ({
        statId: stat.stat_id,
        name: stat.name,
        displayName: stat.display_name,
        abbreviation: stat.abbr,
        group: stat.group,
        enabled: stat.enabled,
        positionTypes: (stat.stat_position_types ?? []).flatMap(({ stat_position_type }) =>
          stat_position_type.position_type === undefined ? [] : [stat_position_type.position_type],
        ),
      })),
      statModifiers: settings.stat_modifiers.stats.map(({ stat }) => ({
        statId: stat.stat_id,
        points: String(stat.value),
      })),
    };
  });
}

function rosterFromPayload(
  payload: typeof TeamRosterPayload.Type,
  requestedTeamKey: string,
  requestedPeriod: ProviderPeriod | undefined,
): Effect.Effect<ProviderRoster, ProviderResponseInvalid | ProviderPeriodMismatch> {
  return Effect.gen(function* () {
    const rosterEntry = singleEntry(payload.team.roster);
    if (rosterEntry === undefined) {
      return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
    }
    const players = rosterEntry.players;
    if (players.length === 0) {
      return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
    }
    const coverageTypes = new Set(players.map((player) => player.selected_position.coverage_type));
    const weeks = new Set(
      players.flatMap((player) =>
        player.selected_position.week === undefined ? [] : [player.selected_position.week],
      ),
    );
    if (coverageTypes.size !== 1 || !coverageTypes.has("week") || weeks.size !== 1) {
      return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
    }
    const week = [...weeks][0];
    if (week === undefined) {
      return yield* ProviderResponseInvalid.make({ operation: "read_roster" });
    }
    if (requestedPeriod !== undefined && requestedPeriod.week !== week) {
      return yield* ProviderPeriodMismatch.make({
        operation: "read_roster",
        requestedWeek: requestedPeriod.week,
        coveredWeek: week,
      });
    }
    const leagueKey = providerLeagueKey(requestedTeamKey);
    return {
      providerTeamKey: requestedTeamKey,
      providerLeagueKey: leagueKey,
      coverage: { type: "week" as const, week },
      players: players.map(toRosterPlayer),
    };
  });
}

function toRosterPlayer(player: typeof RosterPlayerPayload.Type): ProviderRosterPlayer {
  return {
    providerPlayerKey: player.player_key,
    name: player.name.full,
    displayPosition: player.display_position,
    primaryPosition: player.primary_position,
    positionType: optionalNonEmpty(player.position_type),
    eligiblePositions: (player.eligible_positions ?? []).map(({ position }) => position),
    slot: player.selected_position.position,
    isFlex: player.selected_position.is_flex ?? null,
    isEditable: player.is_editable ?? null,
    injuryCode: optionalNonEmpty(player.status),
    injuryDetail: optionalNonEmpty(player.injury_note) ?? optionalNonEmpty(player.status_full),
    byeWeek: player.bye_weeks?.week ?? null,
    undroppable: player.is_undroppable ?? null,
  };
}

function singleEntry<A>(value: ReadonlyArray<A> | A): A | undefined {
  return isReadonlyArray(value) ? value[0] : value;
}

function isReadonlyArray<A>(value: ReadonlyArray<A> | A): value is ReadonlyArray<A> {
  return Array.isArray(value);
}

function reviewUrl(base: URL, intent: ProviderReviewLinkInput["intent"]): URL {
  const target = new URL(intent.kind === "trade" ? "trade" : "add", withTrailingSlash(base));
  const append = (name: "apid" | "dpid", key: string): void => {
    target.searchParams.append(name, numericPlayerId(key));
  };
  switch (intent.kind) {
    case "add":
      append("apid", intent.add);
      break;
    case "add_drop":
      append("apid", intent.add);
      append("dpid", intent.drop);
      break;
    case "drop":
      append("dpid", intent.drop);
      break;
    case "trade":
      for (const key of intent.send) {
        append("apid", key);
      }
      for (const key of intent.receive) {
        append("dpid", key);
      }
      break;
  }
  return target;
}

function reviewBase(url: string, sport: "football" | "hockey", leagueId: string): URL {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== reviewHosts[sport] ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("Yahoo review base escaped its fixed host");
  }
  const segments = parsed.pathname.split("/").filter((segment) => segment !== "");
  if (
    segments.length !== 2 ||
    segments[1] !== leagueId ||
    !/^[a-z0-9]{1,8}$/u.test(segments[0] ?? "")
  ) {
    throw new Error("Yahoo review base escaped its league page");
  }
  return parsed;
}

function withTrailingSlash(url: URL): URL {
  const copy = new URL(url.href);
  if (!copy.pathname.endsWith("/")) {
    copy.pathname = `${copy.pathname}/`;
  }
  return copy;
}

function numericPlayerId(playerKey: string): string {
  const match = /^[0-9]+\.p\.([0-9]+)$/u.exec(playerKey);
  if (match?.[1] === undefined) {
    throw new Error("Yahoo player key is not numeric");
  }
  return match[1];
}

function leagueIdFromKey(leagueKey: string): string {
  const match = /^[0-9]+\.l\.([0-9]+)$/u.exec(leagueKey);
  if (match?.[1] === undefined) {
    throw new Error("Yahoo league key is not numeric");
  }
  return match[1];
}

function ValidLeagueKey(
  value: string,
  operation: ProviderOperation,
): Effect.Effect<string, ProviderResponseInvalid> {
  return /^[0-9]+\.l\.[0-9]+$/u.test(value)
    ? Effect.succeed(value)
    : ProviderResponseInvalid.make({ operation });
}

function ValidTeamKey(
  value: string,
  operation: ProviderOperation,
): Effect.Effect<string, ProviderResponseInvalid> {
  return /^[0-9]+\.l\.[0-9]+\.t\.[0-9]+$/u.test(value)
    ? Effect.succeed(value)
    : ProviderResponseInvalid.make({ operation });
}

function ValidWeek(value: number): Effect.Effect<number, ProviderResponseInvalid> {
  return Number.isSafeInteger(value) && value >= 1
    ? Effect.succeed(value)
    : ProviderResponseInvalid.make({ operation: "read_roster" });
}

function optionalNonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === "" ? undefined : value;
}

const SessionCookie = Schema.Trim.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(8_192)),
  Schema.check(Schema.isPattern(/^[\x20-\x7e]+$/u)),
  Schema.check(Schema.isPattern(/=/u)),
);

const Season = Schema.Union([Schema.String, Schema.Finite]).pipe(
  Schema.decodeTo(
    Schema.Int.check(Schema.isGreaterThan(1900)),
    SchemaTransformation.transform({
      decode: (value) => (typeof value === "number" ? value : Number(value)),
      encode: (value) => value,
    }),
  ),
);

const IntFromStringOrNumber: Schema.Codec<number, number | string> = Schema.Union([
  Schema.Finite,
  Schema.String,
]).pipe(
  Schema.decodeTo(
    Schema.Int,
    SchemaTransformation.transform({
      decode: (value) => (typeof value === "number" ? value : Number(value)),
      encode: (value) => value,
    }),
  ),
);

const Flag: Schema.Codec<boolean, boolean | number | string> = Schema.Union([
  Schema.Boolean,
  Schema.Finite,
  Schema.String,
]).pipe(
  Schema.decodeTo(
    Schema.Boolean,
    SchemaTransformation.transform({
      decode: (value) =>
        typeof value === "boolean"
          ? value
          : typeof value === "number"
            ? value !== 0
            : value === "1",
      encode: (value) => value,
    }),
  ),
);

const SessionPayload = Schema.Struct({
  users: Schema.Array(
    Schema.Struct({
      guid: Schema.Union([Schema.String, Schema.Finite]),
    }),
  ),
});

const TeamPayload = Schema.Struct({
  team_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[^.]+\.l\.[^.]+\.t\.[^.]+$/u))),
  name: Schema.NonEmptyString,
});

const GamePayload = Schema.Struct({
  season: Season,
  teams: Schema.optional(Schema.Array(TeamPayload)),
});

const TeamsPayload = Schema.Struct({
  users: Schema.Array(
    Schema.Struct({
      games: Schema.Array(GamePayload),
    }),
  ),
});

const CrumbPayload = Schema.Struct({
  service: Schema.Struct({
    crumb: Schema.NullOr(Schema.String),
  }),
});

const LeagueAttributes = Schema.Struct({
  league_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.l\.[0-9]+$/u))),
  name: Schema.NonEmptyString,
  url: Schema.String,
  num_teams: IntFromStringOrNumber,
  current_week: IntFromStringOrNumber,
  start_week: IntFromStringOrNumber,
  end_week: IntFromStringOrNumber,
  start_date: Schema.optional(Schema.String),
  end_date: Schema.optional(Schema.String),
  scoring_type: Schema.NonEmptyString,
  scoring_label: Schema.optional(Schema.String),
  weekly_deadline: Schema.optional(Schema.String),
  season: Season,
  draft_status: Schema.optional(Schema.String),
});

const RosterPositionAttributes = Schema.Struct({
  position: Schema.NonEmptyString,
  position_type: Schema.optional(Schema.String),
  count: IntFromStringOrNumber,
  is_starting_position: Flag,
});

const StatPositionTypeAttributes = Schema.Struct({
  stat_position_type: Schema.Struct({
    position_type: Schema.optional(Schema.String),
  }),
});
const StatCategoryAttributes = Schema.Struct({
  stat_id: IntFromStringOrNumber,
  name: Schema.NonEmptyString,
  display_name: Schema.NonEmptyString,
  group: Schema.NonEmptyString,
  abbr: Schema.NonEmptyString,
  enabled: Flag,
  stat_position_types: Schema.optional(Schema.Array(StatPositionTypeAttributes)),
});

const StatModifierAttributes = Schema.Struct({
  stat_id: IntFromStringOrNumber,
  value: Schema.Union([Schema.String, Schema.Finite]),
});

const LeagueSettingsAttributes = Schema.Struct({
  roster_type: Schema.optional(Schema.String),
  waiver_type: Schema.optional(Schema.String),
  waiver_rule: Schema.optional(Schema.String),
  uses_faab: Schema.optional(Flag),
  roster_positions: Schema.Array(
    Schema.Struct({
      roster_position: RosterPositionAttributes,
    }),
  ),
  stat_categories: Schema.Struct({
    stats: Schema.Array(Schema.Struct({ stat: StatCategoryAttributes })),
  }),
  stat_modifiers: Schema.Struct({
    stats: Schema.Array(Schema.Struct({ stat: StatModifierAttributes })),
  }),
});

const LeaguePayload = Schema.Struct({
  league: Schema.Struct({
    ...LeagueAttributes.fields,
    settings: Schema.Union([Schema.Array(LeagueSettingsAttributes), LeagueSettingsAttributes]),
  }),
});

const RosterPlayerPayload = Schema.Struct({
  player_key: Schema.String.pipe(Schema.check(Schema.isPattern(/^[0-9]+\.p\.[0-9]+$/u))),
  name: Schema.Struct({ full: Schema.NonEmptyString }),
  display_position: Schema.NonEmptyString,
  primary_position: Schema.NonEmptyString,
  position_type: Schema.optional(Schema.String),
  eligible_positions: Schema.optional(Schema.Array(Schema.Struct({ position: Schema.String }))),
  selected_position: Schema.Struct({
    coverage_type: Schema.NonEmptyString,
    week: Schema.optional(IntFromStringOrNumber),
    position: Schema.NonEmptyString,
    is_flex: Schema.optional(Flag),
  }),
  is_editable: Schema.optional(Flag),
  status: Schema.optional(Schema.String),
  status_full: Schema.optional(Schema.String),
  injury_note: Schema.optional(Schema.String),
  bye_weeks: Schema.optional(Schema.Struct({ week: IntFromStringOrNumber })),
  is_undroppable: Schema.optional(Flag),
});

const RosterEntry = Schema.Struct({
  players: Schema.Array(RosterPlayerPayload),
});

const TeamRosterPayload = Schema.Struct({
  team: Schema.Struct({
    roster: Schema.Union([Schema.Array(RosterEntry), RosterEntry]),
  }),
});
