import { and, asc, eq, gt, isNull } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Array, Context, Crypto, DateTime, Effect, Layer, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import { ProviderKey } from "#contexts/connections/Connection.ts";
import { FantasyLeague, FantasySport, TeamId } from "#contexts/connections/FantasyTeam.ts";
import {
  ProposalItemId,
  ProposalItemKind,
  ProposalOutcome,
  ProposalPersistenceFailed,
  ProposalSetId,
  ProposalSetProvenance,
  proposalSetLifetimeMillis,
} from "#contexts/connections/TransactionProposals.ts";
import { anyOf, maxInsertRows, mutateRows } from "#database/dbUtilities.ts";
import { chunked } from "#utilities/collections.ts";

import { ConnectionsDatabase } from "./ConnectionsDatabase.ts";
import { providerTeams } from "./ConnectionTables.ts";
import type {
  ProposalItemRecord,
  ProposalSetRecord,
  ProposalStepRecord,
  ProposalTeamRecord,
  StoredProposalPlayer,
  StoredProposalStaleness,
  StoredReserveMove,
} from "./TransactionProposalRecord.ts";
import {
  ProposalItemRow,
  ProposalSetRow,
  ProposalStepRow,
  transactionProposalItems,
  transactionProposalSets,
  transactionProposalSteps,
} from "./TransactionProposalTables.ts";

export type ProposalItemCommand = {
  readonly team: TeamId;
  readonly kind: ProposalItemKind;
  readonly adds: ReadonlyArray<StoredProposalPlayer>;
  readonly drops: ReadonlyArray<StoredProposalPlayer>;
  readonly bid: number | undefined;
  readonly reason: string;
};

type LoadedProposalSet = {
  readonly set: ProposalSetRecord;
  readonly items: ReadonlyArray<ProposalItemRecord>;
  readonly steps: ReadonlyArray<ProposalStepRecord>;
  readonly created: boolean;
};

export type ProposalItemChange = {
  readonly id: ProposalItemId;
  readonly staleness: StoredProposalStaleness;
  readonly adds: ReadonlyArray<StoredProposalPlayer>;
  readonly drops: ReadonlyArray<StoredProposalPlayer>;
  readonly reserveMove?: StoredReserveMove;
};

export type ProposalStepCommand = {
  readonly kind: "reserve_move" | "add" | "drop";
  readonly playerKey: string;
  readonly playerName?: string;
  readonly fromSlot?: string;
  readonly toSlot?: string;
  readonly outcome: ProposalOutcome;
  readonly detail?: string;
  readonly decidedAt: DateTime.Utc;
};

export type ProposalOutcomeCommand = {
  readonly itemId: ProposalItemId;
  readonly outcome: ProposalOutcome;
  readonly detail: string | undefined;
  readonly at: DateTime.Utc;
  readonly steps: ReadonlyArray<ProposalStepCommand>;
};

export class TransactionProposalRepository extends Context.Service<TransactionProposalRepository>()(
  "@lineupkeep/backend/contexts/connections/internal/TransactionProposalRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;
      const crypto = yield* Crypto.Crypto;
      const newId = crypto
        .randomUUIDv7()
        .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));

      const create = Effect.fn("TransactionProposalRepository.create")(function* (input: {
        readonly userId: UserId;
        readonly proposedBy: ProposalSetProvenance;
        readonly fingerprintSource: string;
        readonly teams: ReadonlyArray<TeamId>;
        readonly items: ReadonlyArray<ProposalItemCommand>;
        readonly at: DateTime.Utc;
      }) {
        const fingerprint = yield* fingerprintOf(crypto, input.fingerprintSource);
        const teams = yield* Schema.encodeEffect(Schema.Array(TeamId))(input.teams).pipe(
          Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })),
        );
        const ids = yield* Effect.replicateEffect(input.items.length)(newId);
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const inserted = yield* tx
                .insert(transactionProposalSets)
                .values({
                  userId: input.userId,
                  proposerKind: input.proposedBy.kind,
                  proposerReference: input.proposedBy.reference,
                  surface: input.proposedBy.surface,
                  clientLabel: input.proposedBy.client ?? null,
                  fingerprint,
                  teams,
                  createdAt: DateTime.toDateUtc(input.at),
                  expiresAt: DateTime.toDateUtc(
                    DateTime.addDuration(input.at, proposalSetLifetimeMillis),
                  ),
                  updatedAt: DateTime.toDateUtc(input.at),
                })
                .onConflictDoNothing({
                  target: [transactionProposalSets.userId, transactionProposalSets.fingerprint],
                })
                .returning();
              const insertedSet = inserted[0];
              if (insertedSet === undefined) {
                return yield* loadByFingerprint(tx, input.userId, fingerprint);
              }
              const set = yield* decodeSet(insertedSet);
              const itemIds = ids.map((id) => Schema.decodeSync(ProposalItemId)(id));
              const rows = itemIds.map((id, index) => {
                const item = Array.getUnsafe(input.items, index);
                return {
                  id,
                  setId: set.id,
                  position: index,
                  userId: input.userId,
                  teamId: item.team,
                  kind: item.kind,
                  addPlayers: item.adds,
                  dropPlayers: item.drops,
                  bid: item.bid ?? null,
                  reason: item.reason,
                  state: "proposed" as const,
                  staleness: "unchecked" as const,
                  staleReasons: [],
                  checkedAt: null,
                  createdAt: DateTime.toDateUtc(input.at),
                  updatedAt: DateTime.toDateUtc(input.at),
                };
              });
              const insertedItems = yield* chunked(
                rows,
                maxInsertRows(transactionProposalItems),
                (chunk) =>
                  tx
                    .insert(transactionProposalItems)
                    .values([...chunk])
                    .returning(),
              );
              const items = yield* Effect.forEach(insertedItems, decodeItem);
              const byId = new Map(items.map((item) => [item.id, item] as const));
              return {
                set,
                items: itemIds.map((id) => {
                  const item = byId.get(id);
                  if (item === undefined) {
                    throw new Error("A created proposal item was not returned");
                  }
                  return item;
                }),
                steps: [],
                created: true,
              };
            }),
          )
          .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
      });

      const load = Effect.fn("TransactionProposalRepository.load")(function* (
        userId: UserId,
        setId: ProposalSetId,
      ) {
        const setRows = yield* database
          .select()
          .from(transactionProposalSets)
          .where(
            and(eq(transactionProposalSets.userId, userId), eq(transactionProposalSets.id, setId)),
          )
          .limit(1)
          .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        const setRow = setRows[0];
        if (setRow === undefined) {
          return undefined;
        }
        const set = yield* decodeSet(setRow);
        const itemRows = yield* database
          .select()
          .from(transactionProposalItems)
          .where(
            and(
              eq(transactionProposalItems.userId, userId),
              eq(transactionProposalItems.setId, setId),
            ),
          )
          .orderBy(asc(transactionProposalItems.position))
          .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        const items = yield* Effect.forEach(itemRows, decodeItem);
        const steps = yield* loadSteps(
          userId,
          items.map((item) => item.id),
        );
        return { set, items, steps };
      });

      const saveChecks = Effect.fn("TransactionProposalRepository.saveChecks")(function* (input: {
        readonly userId: UserId;
        readonly setId: ProposalSetId;
        readonly changes: ReadonlyArray<ProposalItemChange>;
        readonly at: DateTime.Utc;
      }) {
        const ids = input.changes.map((change) => change.id);
        if (!Array.isArrayNonEmpty(ids)) {
          return [];
        }
        const changeById = new Map(input.changes.map((change) => [change.id, change] as const));
        return yield* database
          .transaction((tx) =>
            mutateRows(tx, transactionProposalItems, {
              where: and(
                eq(transactionProposalItems.userId, input.userId),
                eq(transactionProposalItems.setId, input.setId),
              ),
              ids,
              codec: ProposalItemRow,
              plan: (locked) =>
                Effect.sync(() => {
                  const planned: Array<ProposalItemRecord> = [];
                  for (const id of ids) {
                    const change = changeById.get(id);
                    const record = locked.get(id);
                    if (change === undefined || record === undefined) {
                      continue;
                    }
                    planned.push({
                      ...record,
                      adds: change.adds,
                      drops: change.drops,
                      staleness: change.staleness,
                      updatedAt: input.at,
                    });
                  }
                  return planned;
                }),
            }),
          )
          .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
      });

      const listTeams = Effect.fn("TransactionProposalRepository.listTeams")(function* (
        userId: UserId,
      ) {
        const rows = yield* database
          .select(teamColumns)
          .from(providerTeams)
          .where(eq(providerTeams.userId, userId))
          .orderBy(asc(providerTeams.league), asc(providerTeams.name), asc(providerTeams.id))
          .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        return yield* decodeTeams(rows);
      });

      const loadTeams = Effect.fn("TransactionProposalRepository.loadTeams")(function* (
        userId: UserId,
        teamIds: ReadonlyArray<TeamId>,
      ) {
        const ids = [...new Set(teamIds)];
        if (!Array.isArrayNonEmpty(ids)) {
          return [];
        }
        const rows = yield* database
          .select(teamColumns)
          .from(providerTeams)
          .where(and(eq(providerTeams.userId, userId), anyOf(providerTeams.id, ids)))
          .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        return yield* decodeTeams(rows);
      });

      const claimSubmission = Effect.fn("TransactionProposalRepository.claimSubmission")(
        function* (input: {
          readonly userId: UserId;
          readonly setId: ProposalSetId;
          readonly at: DateTime.Utc;
        }) {
          const at = DateTime.toDateUtc(input.at);
          const claimed = yield* database
            .update(transactionProposalSets)
            .set({ submittedByUserId: input.userId, submittedAt: at, updatedAt: at })
            .where(
              and(
                eq(transactionProposalSets.userId, input.userId),
                eq(transactionProposalSets.id, input.setId),
                isNull(transactionProposalSets.submittedAt),
                gt(transactionProposalSets.expiresAt, at),
              ),
            )
            .returning({ id: transactionProposalSets.id })
            .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
          return claimed.length === 1;
        },
      );

      const recordItemOutcomes = Effect.fn("TransactionProposalRepository.recordItemOutcomes")(
        function* (input: {
          readonly userId: UserId;
          readonly setId: ProposalSetId;
          readonly outcomes: ReadonlyArray<ProposalOutcomeCommand>;
        }) {
          const outcomes = [...input.outcomes];
          if (!Array.isArrayNonEmpty(outcomes)) {
            return;
          }
          const outcomeById = new Map(
            outcomes.map((outcome) => [outcome.itemId, outcome] as const),
          );
          const ids = [...outcomeById.keys()];
          if (!Array.isArrayNonEmpty(ids)) {
            return;
          }
          const stepCount = outcomes.reduce((total, outcome) => total + outcome.steps.length, 0);
          const stepIds = yield* Effect.replicateEffect(stepCount)(newId);
          let stepOffset = 0;
          return yield* database
            .transaction((tx) =>
              Effect.gen(function* () {
                const updated = yield* mutateRows(tx, transactionProposalItems, {
                  where: and(
                    eq(transactionProposalItems.userId, input.userId),
                    eq(transactionProposalItems.setId, input.setId),
                  ),
                  ids,
                  codec: ProposalItemRow,
                  plan: (locked) =>
                    Effect.sync(() => {
                      const planned: Array<ProposalItemRecord> = [];
                      for (const [itemId, outcome] of outcomeById) {
                        const record = locked.get(itemId);
                        if (record === undefined) {
                          continue;
                        }
                        planned.push({
                          ...record,
                          state: outcome.outcome,
                          outcome: outcome.outcome,
                          outcomeDetail: outcome.detail,
                          outcomeAt: outcome.at,
                          updatedAt: outcome.at,
                        });
                      }
                      return planned;
                    }),
                });
                if (updated.length !== outcomes.length) {
                  return yield* ProposalPersistenceFailed.make({
                    cause: new Error("A proposal item outcome was recorded for a missing item"),
                  });
                }
                const rows = outcomes.flatMap((outcome) =>
                  outcome.steps.map((step, index) => ({
                    id: Schema.decodeSync(ProposalItemId)(Array.getUnsafe(stepIds, stepOffset++)),
                    setId: input.setId,
                    itemId: outcome.itemId,
                    userId: input.userId,
                    position: index,
                    kind: step.kind,
                    playerKey: step.playerKey,
                    playerName: step.playerName ?? null,
                    fromSlot: step.fromSlot ?? null,
                    toSlot: step.toSlot ?? null,
                    outcome: step.outcome,
                    detail: step.detail ?? null,
                    decidedAt: DateTime.toDateUtc(step.decidedAt),
                  })),
                );
                if (rows.length > 0) {
                  yield* chunked(rows, maxInsertRows(transactionProposalSteps), (chunk) =>
                    tx
                      .insert(transactionProposalSteps)
                      .values([...chunk])
                      .returning(),
                  );
                }
              }),
            )
            .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        },
      );

      const completeSubmission = Effect.fn("TransactionProposalRepository.completeSubmission")(
        function* (input: {
          readonly userId: UserId;
          readonly setId: ProposalSetId;
          readonly at: DateTime.Utc;
        }) {
          const at = DateTime.toDateUtc(input.at);
          yield* database
            .update(transactionProposalSets)
            .set({ completedAt: at, updatedAt: at })
            .where(
              and(
                eq(transactionProposalSets.userId, input.userId),
                eq(transactionProposalSets.id, input.setId),
                isNull(transactionProposalSets.completedAt),
              ),
            )
            .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        },
      );

      function loadSteps(
        userId: UserId,
        itemIds: ReadonlyArray<ProposalItemId>,
      ): Effect.Effect<ReadonlyArray<ProposalStepRecord>, ProposalPersistenceFailed> {
        const ids = [...new Set(itemIds)];
        if (!Array.isArrayNonEmpty(ids)) {
          return Effect.succeed([]);
        }
        return database
          .select()
          .from(transactionProposalSteps)
          .where(
            and(
              eq(transactionProposalSteps.userId, userId),
              anyOf(transactionProposalSteps.itemId, ids),
            ),
          )
          .orderBy(asc(transactionProposalSteps.itemId), asc(transactionProposalSteps.position))
          .pipe(
            Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })),
            Effect.flatMap((rows) => Effect.forEach(rows, decodeStep)),
          );
      }

      return {
        create,
        load,
        listTeams,
        loadTeams,
        saveChecks,
        claimSubmission,
        recordItemOutcomes,
        completeSubmission,
      };

      function loadByFingerprint(
        tx: Parameters<Parameters<typeof database.transaction>[0]>[0],
        userId: UserId,
        fingerprint: string,
      ): Effect.Effect<LoadedProposalSet, ProposalPersistenceFailed | EffectDrizzleQueryError> {
        return Effect.gen(function* () {
          const setRows = yield* tx
            .select()
            .from(transactionProposalSets)
            .where(
              and(
                eq(transactionProposalSets.userId, userId),
                eq(transactionProposalSets.fingerprint, fingerprint),
              ),
            )
            .limit(1);
          const setRow = setRows[0];
          if (setRow === undefined) {
            return yield* ProposalPersistenceFailed.make({
              cause: new Error("A proposal set conflicted without a stored set"),
            });
          }
          const set = yield* decodeSet(setRow);
          const itemRows = yield* tx
            .select()
            .from(transactionProposalItems)
            .where(
              and(
                eq(transactionProposalItems.userId, userId),
                eq(transactionProposalItems.setId, set.id),
              ),
            )
            .orderBy(asc(transactionProposalItems.position));
          const items = yield* Effect.forEach(itemRows, decodeItem);
          const steps = yield* loadSteps(
            userId,
            items.map((item) => item.id),
          );
          return { set, items, steps, created: false };
        });
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

const teamColumns = {
  id: providerTeams.id,
  name: providerTeams.name,
  provider: providerTeams.provider,
  providerLeagueKey: providerTeams.providerLeagueKey,
  league: providerTeams.league,
  sport: providerTeams.sport,
  season: providerTeams.season,
};

const ProposalTeamSelected = Schema.Struct({
  id: Schema.String,
  name: Schema.NonEmptyString,
  provider: Schema.String,
  providerLeagueKey: Schema.NonEmptyString,
  league: FantasyLeague,
  sport: FantasySport,
  season: Schema.Int.check(Schema.isGreaterThan(1900)),
});

function decodeTeams(
  rows: ReadonlyArray<typeof ProposalTeamSelected.Encoded>,
): Effect.Effect<ReadonlyArray<ProposalTeamRecord>, ProposalPersistenceFailed> {
  return Effect.forEach(rows, (row) =>
    Effect.gen(function* () {
      const team = yield* Schema.decodeEffect(ProposalTeamSelected)(row).pipe(
        Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })),
      );
      return {
        id: yield* Schema.decodeEffect(TeamId)(team.id),
        name: team.name,
        provider: yield* Schema.decodeEffect(ProviderKey)(team.provider),
        providerLeagueKey: team.providerLeagueKey,
        league: team.league,
        sport: team.sport,
        season: team.season,
      };
    }).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause }))),
  );
}

function decodeSet(
  row: typeof transactionProposalSets.$inferSelect,
): Effect.Effect<ProposalSetRecord, ProposalPersistenceFailed> {
  return Schema.decodeEffect(ProposalSetRow)(row).pipe(
    Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })),
  );
}

function decodeItem(
  row: typeof transactionProposalItems.$inferSelect,
): Effect.Effect<ProposalItemRecord, ProposalPersistenceFailed> {
  return Schema.decodeEffect(ProposalItemRow)(row).pipe(
    Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })),
  );
}

function decodeStep(
  row: typeof transactionProposalSteps.$inferSelect,
): Effect.Effect<ProposalStepRecord, ProposalPersistenceFailed> {
  return Schema.decodeEffect(ProposalStepRow)(row).pipe(
    Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })),
  );
}

function fingerprintOf(
  crypto: Crypto.Crypto,
  source: string,
): Effect.Effect<string, ProposalPersistenceFailed> {
  return crypto.digest("SHA-256", new TextEncoder().encode(source)).pipe(
    Effect.map(hexOf),
    Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })),
  );
}

function hexOf(bytes: Uint8Array): string {
  return Array.fromIterable(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
