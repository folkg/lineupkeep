import { assert, it } from "@effect/vitest";
import { decodeConnectionId } from "@lineupkeep/backend/connections/Connection";
import { decodeTeamId } from "@lineupkeep/backend/connections/FantasyTeam";
import type { ProviderTeamCard } from "@lineupkeep/backend/connections/Provider";
import { decodeProviderKey } from "@lineupkeep/backend/connections/ProviderKey";
import type { TeamSummary } from "@lineupkeep/backend/connections/Teams";
import { DateTime } from "effect";

import { toTeamCardViews } from "./teamPresentation.ts";

const firstConnection = decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c916001");
const secondConnection = decodeConnectionId("018f79ea-7d86-7c18-9b4a-8b4d0c916002");
const at = DateTime.makeUnsafe("2026-11-21T12:00:00.000Z");
const provider = decodeProviderKey("yahoo");
const first: TeamSummary = {
  team: {
    id: decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c916003"),
    connectionId: firstConnection,
    provider,
    providerTeamKey: "470.l.2.t.1",
    providerLeagueKey: "470.l.2",
    league: "nfl",
    sport: "football",
    season: 2026,
    name: "My team",
    availability: "available",
    automation: { status: "enabled", changedAt: at },
    ownerNote: "Do not move my quarterback",
    ownerNoteUpdatedAt: at,
    lastSeenAt: at,
    createdAt: at,
    updatedAt: at,
  },
  connectionStatus: "ready",
  connectionCount: 2,
  recentRuns: [],
};

const card: ProviderTeamCard = {
  provider,
  providerTeamKey: "470.l.2.t.1",
  providerLeagueKey: "470.l.2",
  league: "nfl",
  sport: "football",
  season: 2026,
  seasonOver: undefined,
  name: "Provider name",
  format: "rotisserie",
  scoringType: "roto",
  scoringLabel: "Rotisserie",
  teamCount: 12,
  weeklyDeadline: "intraday",
  startDate: "2026-09-01",
  endDate: "2027-01-04",
  currentWeek: undefined,
  endWeek: undefined,
  maxGamesPlayed: 162,
  maxInningsPitched: undefined,
  standing: {
    providerTeamKey: "470.l.2.t.1",
    name: "Provider name",
    rank: 1,
    playoffSeed: null,
    record: undefined,
    gamesBack: null,
    pointsBack: 0,
    points: 0,
    pointsFor: null,
    pointsAgainst: null,
    streak: undefined,
    acquisitionUsage: { seasonMoves: undefined, weeklyAdds: undefined },
    categoryTotals: [],
    categoryPoints: [],
  },
};

it("merges by connection and provider team key without replacing local controls or notes", () => {
  const second: TeamSummary = {
    ...first,
    team: {
      ...first.team,
      id: decodeTeamId("018f79ea-7d86-7c18-9b4a-8b4d0c916004"),
      connectionId: secondConnection,
    },
  };
  const [present, missing] = toTeamCardViews({
    cards: [{ ...card, connectionId: firstConnection }],
    failures: [{ connectionId: secondConnection, reason: "Provider unavailable." }],
  })([first, second]);

  assert.strictEqual(present?.season?.standing?.points, 0);
  assert.strictEqual(present?.season?.standing?.pointsBack, 0);
  assert.strictEqual(present?.season?.standing?.record, undefined);
  assert.strictEqual(present?.summary.team.name, "My team");
  assert.strictEqual(present?.summary.team.ownerNote, "Do not move my quarterback");
  assert.strictEqual(present?.summary.team.automation.status, "enabled");
  assert.isUndefined(missing?.season);
  assert.strictEqual(missing?.reason, "Provider unavailable.");
  assert.strictEqual(missing?.summary.team.automation.status, "enabled");
});
