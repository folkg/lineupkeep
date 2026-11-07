import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { Array, Effect, Layer, Redacted } from "effect";

import { Connections } from "./Connections.ts";
import type { FantasyTeam } from "./FantasyTeam.ts";
import { ConnectionCredentialEncryption } from "./internal/ConnectionCredentialEncryption.ts";
import { ConnectionEncryptionKey } from "./internal/ConnectionEncryptionKey.ts";
import { ConnectionRepository } from "./internal/ConnectionRepository.ts";
import { ConnectionsDatabaseTest } from "./internal/ConnectionsDatabaseTest.ts";
import { ConnectionsLive } from "./internal/ConnectionsLive.ts";
import { QueryRepository } from "./internal/QueryRepository.ts";
import { QueryTokens } from "./internal/QueryTokens.ts";
import {
  secondProvider,
  secondProviderKey,
  secondProviderLeague,
} from "./internal/SecondProviderFakeTest.ts";
import { TransactionProposalRepository } from "./internal/TransactionProposalRepository.ts";
import { TransactionProposalsLive } from "./internal/TransactionProposalsLive.ts";
import { planProposalOrder } from "./ProposalOrder.ts";
import type {
  ProposalOrderInput,
  ProposalOrderItem,
  ProposalOrderPlayer,
} from "./ProposalOrder.ts";
import type { ProviderPlayerDetail, ProviderShape } from "./Provider.ts";
import { ProviderRegistry, providerRegistryOf } from "./ProviderRegistry.ts";
import { TransactionProposals } from "./TransactionProposals.ts";

const owner = decodeUserId("owner");
const proposer = { kind: "agent", reference: "mcp", surface: "mcp" } as const;

type OrderPlayerRef = ProposalOrderInput["items"][number]["adds"][number];

const atlasTiming = {
  rule: secondProviderLeague.rosterChange?.rule,
  currentDate: secondProviderLeague.currentDate,
} as const;

const atlasOrderPlayers: ReadonlyArray<ProposalOrderPlayer> = [
  player("atlas.p.1", "Ada Guard", "PG", ["PG"]),
  player("atlas.p.2", "Bo Wing", "SG", ["SG"]),
  player("atlas.p.3", "Cy Swing", "UTIL", ["SF"]),
  player("atlas.p.4", "Dee Bench", "BENCH", ["PG"]),
  player("atlas.p.5", "Eve Bench", "BENCH", ["SG"]),
  player("atlas.p.6", "Fay Reserve", "RESERVE", ["PG"]),
];

it("orders an atlas drop before the move that needs the bench place", () => {
  const decision = planProposalOrder({
    slots: secondProviderLeague.rosterPositions,
    players: atlasOrderPlayers,
    timing: atlasTiming,
    items: [
      move("move-fay-to-bench", ref("atlas.p.6", "Fay Reserve"), "BENCH"),
      drop("drop-dee", ref("atlas.p.4", "Dee Bench")),
    ],
  });

  assert.strictEqual(decision.status, "ordered");
  if (decision.status === "ordered") {
    assert.deepStrictEqual(
      decision.steps.map((step) => step.item),
      ["drop-dee", "move-fay-to-bench"],
    );
    assert.strictEqual(decision.timing, "next_day");
    assert.strictEqual(decision.effectiveDate, "2026-11-03");
  }
});

it("refuses only the atlas move whose drop frees another slot", () => {
  const decision = planProposalOrder({
    slots: secondProviderLeague.rosterPositions,
    players: atlasOrderPlayers,
    timing: atlasTiming,
    items: [
      move("move-fay-to-pg", ref("atlas.p.6", "Fay Reserve"), "PG"),
      drop("drop-dee", ref("atlas.p.4", "Dee Bench")),
    ],
  });

  assert.strictEqual(decision.status, "conflict");
  if (decision.status === "conflict") {
    assert.deepStrictEqual(decision.conflicts[0]?.items, ["move-fay-to-pg"]);
    assert.deepStrictEqual(
      decision.conflicts[0]?.reasons?.map((reason) => [reason.item, reason.code]),
      [["move-fay-to-pg", "move_slot_full"]],
    );
    const detail = decision.conflicts[0]?.detail ?? "";
    assert.include(detail, "Fay Reserve");
    assert.include(detail, "Dee Bench");
    assert.include(detail, "PG");
    assert.include(detail, "BENCH");
    assert.notInclude(detail, "Yahoo");
    assert.notInclude(detail, "yahoo");
    assert.notInclude(detail, "atlas");
    assert.notInclude(detail, "IR");
    assert.notInclude(detail, "BN");
  }
});

it.effect("declares an atlas slot move in atlas' own slot vocabulary", () =>
  Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const connections = yield* Connections;
    const tokens = yield* QueryTokens;
    const team = yield* linkAtlas(connections);
    const eve = Array.getUnsafe(
      yield* tokens.sealPlayerRefs({
        userId: owner,
        leagueKey: team.providerLeagueKey,
        playerKeys: ["atlas.p.5"],
      }),
      0,
    );

    const proposed = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: team.id,
          kind: "slot_move",
          adds: [],
          drops: [],
          slotMove: { player: eve, toSlot: "BENCH" },
          reason: "Move the reserve guard to the bench.",
        },
      ],
    });
    const accepted = Array.getUnsafe(proposed.items, 0);
    assert.strictEqual(accepted.outcome, "accepted");

    const review = yield* proposals.revalidate(owner, { set: proposed.set.id });
    const teamReview = Array.getUnsafe(review.teams, 0);
    const item = Array.getUnsafe(teamReview.items, 0);
    assert.strictEqual(item.staleness.status, "current");
    assert.strictEqual(item.slotMove?.player.name, "Eve Reserve");
    assert.strictEqual(item.slotMove?.fromSlot, "RESERVE");
    assert.strictEqual(item.slotMove?.toSlot, "BENCH");
    assert.strictEqual(teamReview.order?.status, "ordered");
    if (teamReview.order?.status === "ordered") {
      assert.strictEqual(teamReview.order.timing, "next_day");
      assert.strictEqual(teamReview.order.effectiveDate, "2026-11-03");
      assert.deepStrictEqual(
        teamReview.order.steps.map((step) => step.item),
        [item.id],
      );
    }
  }).pipe(Effect.provide(testLayer(secondProvider))),
);

it.effect("sends an atlas item with the provider's declared two adds and two drops", () => {
  const sent: Array<{
    readonly adds: ReadonlyArray<string>;
    readonly drops: ReadonlyArray<string>;
  }> = [];
  const provider = atlasWithPool(sent);
  return Effect.gen(function* () {
    const proposals = yield* TransactionProposals;
    const connections = yield* Connections;
    const tokens = yield* QueryTokens;
    const team = yield* linkAtlas(connections);
    const [ada, bo, gil, hal] = yield* Effect.all([
      tokens.sealPlayerRefs({
        userId: owner,
        leagueKey: team.providerLeagueKey,
        playerKeys: ["atlas.p.1"],
      }),
      tokens.sealPlayerRefs({
        userId: owner,
        leagueKey: team.providerLeagueKey,
        playerKeys: ["atlas.p.2"],
      }),
      tokens.sealPlayerRefs({
        userId: owner,
        leagueKey: team.providerLeagueKey,
        playerKeys: ["atlas.p.101"],
      }),
      tokens.sealPlayerRefs({
        userId: owner,
        leagueKey: team.providerLeagueKey,
        playerKeys: ["atlas.p.102"],
      }),
    ]);

    const proposed = yield* proposals.propose(owner, proposer, {
      items: [
        {
          team: team.id,
          kind: "free_agent_add",
          adds: [Array.getUnsafe(gil, 0), Array.getUnsafe(hal, 0)],
          drops: [Array.getUnsafe(ada, 0), Array.getUnsafe(bo, 0)],
          reason: "Replace two guards with two available guards.",
        },
      ],
    });
    const item = Array.getUnsafe(proposed.items, 0);
    assert.strictEqual(item.outcome, "accepted");
    const checked = yield* proposals.revalidate(owner, { set: proposed.set.id });
    const checkedItem = Array.getUnsafe(Array.getUnsafe(checked.teams, 0).items, 0);
    assert.strictEqual(checkedItem.staleness.status, "current");

    const submitted = yield* proposals.submit(owner, {
      set: proposed.set.id,
      include: [item.item.id],
    });
    const submittedItem = Array.getUnsafe(Array.getUnsafe(submitted.teams, 0).items, 0);
    assert.strictEqual(submittedItem.state, "failed");
    assert.strictEqual(sent.length, 1);
    assert.deepStrictEqual(sent[0]?.adds, ["atlas.p.101", "atlas.p.102"]);
    assert.deepStrictEqual(sent[0]?.drops, ["atlas.p.1", "atlas.p.2"]);
    assert.notInclude(submittedItem.execution?.detail ?? "", "at most");
  }).pipe(Effect.provide(testLayer(provider)));
});

function atlasWithPool(
  sent: Array<{ readonly adds: ReadonlyArray<string>; readonly drops: ReadonlyArray<string> }>,
): ProviderShape {
  return {
    ...secondProvider,
    readPlayerDetails: ({ providerPlayerKeys }) =>
      Effect.succeed(
        atlasPoolDetails.filter((player) => providerPlayerKeys.includes(player.providerPlayerKey)),
      ),
    applyTransaction: (input) => {
      sent.push({ adds: [...input.adds], drops: [...input.drops] });
      return Effect.succeed({ status: "not_sent" as const, reason: "request_failed" as const });
    },
  };
}

const atlasPoolDetails: ReadonlyArray<ProviderPlayerDetail> = [
  {
    providerPlayerKey: "atlas.p.101",
    name: "Gil Wing",
    primaryPosition: "PG",
    displayPosition: "PG",
    proTeam: "ATL",
    availabilityDetail: undefined,
    eligiblePositions: ["PG"],
    rosterStatus: "free_agent",
    actual: undefined,
    projected: undefined,
  },
  {
    providerPlayerKey: "atlas.p.102",
    name: "Hal Guard",
    primaryPosition: "PG",
    displayPosition: "PG",
    proTeam: "ATL",
    availabilityDetail: undefined,
    eligiblePositions: ["PG"],
    rosterStatus: "free_agent",
    actual: undefined,
    projected: undefined,
  },
];

function linkAtlas(connections: Connections["Service"]): Effect.Effect<FantasyTeam, never> {
  return Effect.gen(function* () {
    const linked = Array.getUnsafe(
      yield* connections.link(owner, [
        { provider: secondProviderKey, session: Redacted.make("A1=atlas-session") },
      ]),
      0,
    );
    const discovered = yield* connections.discoverTeams(owner, [{ id: linked.id }]);
    return Array.getUnsafe(discovered, 0);
  }).pipe(Effect.orDie);
}

function testLayer(
  provider: ProviderShape,
): Layer.Layer<TransactionProposals | Connections | QueryTokens> {
  const EncryptionTestLayer = ConnectionCredentialEncryption.forKey(
    ConnectionEncryptionKey.fromBytes({
      bytes: new TextEncoder().encode("abcdefghijklmnopqrstuvwxyz012345"),
      keyVersion: 1,
    }),
  ).pipe(Layer.provide(NodeCrypto.layer));
  const ConnectionRepositoryTest = ConnectionRepository.layer.pipe(
    Layer.provideMerge(ConnectionsDatabaseTest),
  );
  const QueryRepositoryTest = QueryRepository.layer.pipe(Layer.provide(ConnectionRepositoryTest));

  return TransactionProposalsLive.pipe(
    Layer.provide(TransactionProposalRepository.layer),
    Layer.provideMerge(ConnectionsLive),
    Layer.provideMerge(QueryRepositoryTest),
    Layer.provideMerge(ConnectionRepositoryTest),
    Layer.provideMerge(ConnectionsDatabaseTest),
    Layer.provideMerge(
      Layer.effect(ProviderRegistry)(
        Effect.succeed(ProviderRegistry.of(providerRegistryOf([provider]))),
      ),
    ),
    Layer.provide(EncryptionTestLayer),
    Layer.provideMerge(QueryTokens.fromSecret("test-query-token-secret-at-least-32-chars")),
    Layer.provide(NodeCrypto.layer),
    Layer.orDie,
  );
}

function player(
  key: string,
  name: string,
  slot: string,
  positions: ReadonlyArray<string>,
): ProposalOrderPlayer {
  return { key, name, positions, slot, editable: true };
}

function ref(key: string, name: string): OrderPlayerRef {
  return { key, name };
}

function move(id: string, player: OrderPlayerRef, toSlot: string): ProposalOrderItem {
  return {
    id,
    label: `Move ${player.name} to ${toSlot}`,
    adds: [],
    drops: [],
    move: { player, toSlot },
    mayRepair: false,
  };
}

function drop(id: string, player: OrderPlayerRef): ProposalOrderItem {
  return {
    id,
    label: `Drop ${player.name}`,
    adds: [],
    drops: [player],
    move: undefined,
    mayRepair: true,
  };
}
