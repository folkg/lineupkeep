import { readFileSync } from "node:fs";

import { assert, it } from "@effect/vitest";
import { Effect } from "effect";
import { Schema } from "effect";
import { Array as EffectArray } from "effect";
import { Option as EffectOption } from "effect";

import jsonTools from "#runtime/JsonText.ts";

import { hockeyProfessionalTeamMap, matchProfessionalTeam } from "./ProfessionalTeamMap.ts";
function optionalArrayValue<A extends ReadonlyArray<unknown>, B>(value: A, f: (value: A) => B): B;
function optionalArrayValue<A extends ReadonlyArray<unknown>, B>(
  value: A | null | undefined,
  f: (value: A) => B,
): B | undefined;
function optionalArrayValue<A extends ReadonlyArray<unknown>, B>(
  value: A | null | undefined,
  f: (value: A) => B,
): B | undefined {
  return value === undefined || value === null ? undefined : f(value);
}

function arrayValueIsArray<A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> {
  return EffectArray.isArray(value);
}

const LeagueClub = Schema.Struct({
  id: Schema.Int,
  abbrev: Schema.NonEmptyString,
  placeName: Schema.Struct({ default: Schema.NonEmptyString }),
  commonName: Schema.optional(Schema.Struct({ default: Schema.NonEmptyString })),
});

const ProviderTeamRead = Effect.runSync(
  Schema.decodeUnknownEffect(
    Schema.Struct({
      read: Schema.Struct({
        url: Schema.NonEmptyString,
        observedAt: Schema.DateTimeUtcFromString,
      }),
      teams: Schema.Array(
        Schema.Struct({
          providerTeamKey: Schema.NonEmptyString,
          abbreviation: Schema.NonEmptyString,
          displayName: Schema.NonEmptyString,
        }),
      ),
    }),
  )(fixture("fixtures/provider-hockey-teams.json")),
);

const LeagueWeek = Effect.runSync(
  Schema.decodeUnknownEffect(
    Schema.Struct({
      gameWeek: Schema.Array(
        Schema.Struct({
          games: Schema.Array(Schema.Struct({ homeTeam: LeagueClub, awayTeam: LeagueClub })),
        }),
      ),
    }),
  )(fixture("game-sources/nhl/fixtures/league-week.json")),
);

const providerTeams = new Map(
  EffectArray.map(ProviderTeamRead.teams, (team) => [team.providerTeamKey, team]),
);
const leagueClubs = new Map(
  EffectArray.map(
    EffectArray.flatMap(LeagueWeek.gameWeek, (day) => {
      const flatMapped1 = EffectArray.flatMap(day.games, (game) => {
        const flatMapped1 = [game.homeTeam, game.awayTeam];
        return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
      });
      return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
    }),
    (club) => [String(club.id), club] as const,
  ),
);

it("covers every club of the league once, with one provider key and one league identifier each", () => {
  assert.strictEqual(hockeyProfessionalTeamMap.length, 32);
  assert.strictEqual(leagueClubs.size, 32);
  assert.isTrue(EffectArray.every(hockeyProfessionalTeamMap, (entry) => entry.league === "nhl"));
  assert.strictEqual(
    new Set(EffectArray.map(hockeyProfessionalTeamMap, (entry) => entry.providerTeamKey)).size,
    hockeyProfessionalTeamMap.length,
  );
  assert.strictEqual(
    new Set(EffectArray.map(hockeyProfessionalTeamMap, (entry) => entry.sourceIdentifier)).size,
    hockeyProfessionalTeamMap.length,
  );
  assert.deepStrictEqual(
    EffectArray.map(hockeyProfessionalTeamMap, (entry) => entry.sourceIdentifier).sort(),
    [...leagueClubs.keys()].sort(),
  );
});

it("pairs every club with the provider's own team key as the provider pool read published it", () => {
  assert.strictEqual(ProviderTeamRead.teams.length, hockeyProfessionalTeamMap.length);
  assert.strictEqual(providerTeams.size, hockeyProfessionalTeamMap.length);

  for (const entry of hockeyProfessionalTeamMap) {
    const published = providerTeams.get(entry.providerTeamKey);
    assert.isDefined(published, `${entry.providerTeamKey} is not in the provider read`);
    assert.strictEqual(
      plain(published.displayName),
      plain(entry.displayName),
      `${entry.providerTeamKey} names a different club in the two reads`,
    );
  }
});

it("names every club as the league's own week read published it", () => {
  for (const entry of hockeyProfessionalTeamMap) {
    const club = leagueClubs.get(entry.sourceIdentifier);
    assert.isDefined(club, `league identifier ${entry.sourceIdentifier} is in no game`);
    assert.strictEqual(club.abbrev, entry.sourceAbbreviation);
    assert.strictEqual(clubName(club), entry.displayName);
  }
});

it("spells four abbreviations differently from the league, which an abbreviation join would miss", () => {
  const differently = optionalArrayValue(
    EffectArray.map(hockeyProfessionalTeamMap, (entry) => [
      entry.sourceAbbreviation,
      providerTeams.get(entry.providerTeamKey)?.abbreviation ?? "",
    ]),
    (value) => EffectArray.filter(value, ([league, provider]) => league !== provider),
  );

  assert.deepStrictEqual(differently, [
    ["LAK", "LA"],
    ["NJD", "NJ"],
    ["SJS", "SJ"],
    ["TBL", "TB"],
  ]);
});

it("matches a club by its league identifier and refuses a pair the recorded read no longer names", () => {
  const toronto = EffectOption.getOrUndefined(
    EffectArray.findFirst(hockeyProfessionalTeamMap, (entry) => entry.sourceAbbreviation === "TOR"),
  );
  assert.isDefined(toronto);
  const club = leagueClubs.get(toronto.sourceIdentifier);
  assert.isDefined(club);
  const observed = {
    league: "nhl" as const,
    identifier: toronto.sourceIdentifier,
    abbreviation: club.abbrev,
    name: clubName(club),
  };

  assert.deepStrictEqual(matchProfessionalTeam(observed), {
    kind: "mapped",
    providerTeamKey: "nhl.t.21",
  });
  assert.deepStrictEqual(matchProfessionalTeam({ ...observed, identifier: "999" }), {
    kind: "not_mapped",
  });
  assert.deepStrictEqual(matchProfessionalTeam({ ...observed, league: "nfl" }), {
    kind: "not_mapped",
  });
  assert.deepStrictEqual(matchProfessionalTeam({ ...observed, name: "Another Club" }), {
    kind: "disagrees",
  });
});

function clubName(club: typeof LeagueClub.Type): string {
  const common = club.commonName?.default;
  return common === undefined ? club.placeName.default : `${club.placeName.default} ${common}`;
}

function plain(value: string): string {
  return value.normalize("NFD").replaceAll(/\p{Diacritic}/gu, "");
}

function fixture(name: string): unknown {
  return jsonTools.jsonValue(readFileSync(new URL(`./${name}`, import.meta.url), "utf8"));
}
