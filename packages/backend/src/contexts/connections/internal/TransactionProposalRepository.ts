import { and, asc, count, desc, eq, exists, isNotNull, isNull, lte, not } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Array, Context, Crypto, DateTime, Effect, Layer, Schema } from "effect";

import { UserId } from "#contexts/auth/User.ts";
import { ConnectionId, ProviderKey } from "#contexts/connections/Connection.ts";
import { FantasyLeague, FantasySport, TeamId } from "#contexts/connections/FantasyTeam.ts";
import {
  ProposalItemId,
  ProposalItemKind,
  ProposalItemState,
  ProposalOutcome,
  ProposalPersistenceFailed,
  ProposalSetId,
  ProposalSetProvenance,
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
  StoredProposalIntent,
  StoredProposalLineup,
  StoredProposalOrder,
  StoredProposalPlacement,
  StoredProposalSubmission,
  StoredSlotMove,
  StoredProposalPlayer,
  StoredProposalStaleness,
  StoredProposalTrade,
  StoredProposalTradePick,
  StoredReserveMove,
} from "./TransactionProposalRecord.ts";
import { isDismissibleItem, isSettledItem } from "./TransactionProposalRecord.ts";
import {
  ProposalItemRow,
  ProposalSetRow,
  ProposalStepRow,
  ProposalSubmissionRow,
  transactionProposalItems,
  transactionProposalSets,
  transactionProposalSteps,
  transactionProposalSubmissions,
} from "./TransactionProposalTables.ts";

export type ProposalItemCommand = {
  readonly team: TeamId;
  readonly connection: ConnectionId;
  readonly kind: ProposalItemKind;
  readonly adds: ReadonlyArray<StoredProposalPlayer>;
  readonly fallbacks: ReadonlyArray<StoredProposalPlayer>;
  readonly drops: ReadonlyArray<StoredProposalPlayer>;
  readonly picks: ReadonlyArray<StoredProposalTradePick>;
  readonly slotMove: StoredSlotMove | undefined;
  readonly intent: StoredProposalIntent | undefined;
  readonly counterpartyKey: string | undefined;
  readonly counterpartyName: string | undefined;
  readonly bid: number | undefined;
  readonly window: string | undefined;
  readonly reason: string;
};

type ProposalItemStore = {
  readonly id: ProposalItemId;
  readonly command: ProposalItemCommand;
  readonly check: StoredProposalStaleness;
  readonly reserveMove: StoredReserveMove | undefined;
  readonly placement: StoredProposalPlacement | undefined;
  readonly effectiveDate: string | undefined;
};

type LoadedProposalSet = {
  readonly set: ProposalSetRecord;
  readonly submissions: ReadonlyArray<StoredProposalSubmission>;
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
  readonly placement?: StoredProposalPlacement;
  readonly trade?: StoredProposalTrade;
  readonly state?: ProposalItemState;
  readonly approvedAt?: DateTime.Utc;
  readonly effectiveDate?: string;
};

export type ProposalStepCommand = {
  readonly kind: "reserve_move" | "slot_move" | "add" | "drop";
  readonly playerKey: string;
  readonly playerName?: string;
  readonly fromSlot?: string;
  readonly toSlot?: string;
  readonly outcome: ProposalOutcome;
  readonly detail?: string;
  readonly decidedAt: DateTime.Utc;
};

type ProposalTradeCommand = {
  readonly itemId: ProposalItemId;
  readonly state: ProposalItemState;
  readonly trade: StoredProposalTrade;
  readonly at: DateTime.Utc;
};

export type ProposalOutcomeCommand = {
  readonly itemId: ProposalItemId;
  readonly outcome: ProposalOutcome;
  readonly detail: string | undefined;
  readonly at: DateTime.Utc;
  readonly position: number | undefined;
  readonly steps: ReadonlyArray<ProposalStepCommand>;
  readonly settled: boolean;
  readonly trade?: StoredProposalTrade;
};

export class TransactionProposalRepository extends Context.Service<TransactionProposalRepository>()(
  "@lineupkeep/backend/contexts/connections/internal/TransactionProposalRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* ConnectionsDatabase;
      const crypto = yield* Crypto.Crypto;
      const newId = crypto.randomULID.pipe(
        Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })),
      );
      const newItemId = newId.pipe(Effect.map((id) => Schema.decodeSync(ProposalItemId)(id)));
      const newSetId = newId.pipe(Effect.map((id) => Schema.decodeSync(ProposalSetId)(id)));

      const create = Effect.fn("TransactionProposalRepository.create")(
        (input: {
          readonly userId: UserId;
          readonly setId: ProposalSetId;
          readonly proposedBy: ProposalSetProvenance;
          readonly fingerprintSource: string;
          readonly teams: ReadonlyArray<TeamId>;
          readonly items: ReadonlyArray<ProposalItemStore>;
          readonly orders: ReadonlyArray<StoredProposalOrder>;
          readonly at: DateTime.Utc;
        }) =>
          Effect.gen(function* () {
            const fingerprint = yield* fingerprintOf(crypto, input.fingerprintSource);
            const teams = yield* Schema.encodeEffect(Schema.Array(TeamId))(input.teams);
            return yield* database.transaction((tx) =>
              Effect.gen(function* () {
                const inserted = yield* tx
                  .insert(transactionProposalSets)
                  .values({
                    id: input.setId,
                    userId: input.userId,
                    proposerKind: input.proposedBy.kind,
                    proposerReference: input.proposedBy.reference,
                    surface: input.proposedBy.surface,
                    clientLabel: input.proposedBy.client ?? null,
                    fingerprint,
                    teams,
                    orders: input.orders.length === 0 ? null : [...input.orders],
                    createdAt: DateTime.toDateUtc(input.at),
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
                const rows = input.items.map((item, index) => storeRow(input, set.id, item, index));
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
                  submissions: [],
                  items: input.items.map((item) => {
                    const stored = byId.get(item.id);
                    if (stored === undefined) {
                      throw new Error("A created proposal item was not returned");
                    }
                    return stored;
                  }),
                  steps: [],
                  created: true,
                };
              }),
            );
          }).pipe(Effect.mapError(persistenceFailure)),
      );

      const append = Effect.fn("TransactionProposalRepository.append")(
        (input: {
          readonly userId: UserId;
          readonly setId: ProposalSetId;
          readonly teams: ReadonlyArray<TeamId>;
          readonly items: ReadonlyArray<ProposalItemStore>;
          readonly changes: ReadonlyArray<ProposalItemChange>;
          readonly orders: ReadonlyArray<StoredProposalOrder>;
          readonly at: DateTime.Utc;
        }) =>
          Effect.gen(function* () {
            const teams = yield* Schema.encodeEffect(Schema.Array(TeamId))(input.teams);
            const fingerprint = yield* newId;
            return yield* database.transaction((tx) =>
              Effect.gen(function* () {
                const setRows = yield* tx
                  .select()
                  .from(transactionProposalSets)
                  .where(
                    and(
                      eq(transactionProposalSets.userId, input.userId),
                      eq(transactionProposalSets.id, input.setId),
                    ),
                  )
                  .for("update");
                const setRow = setRows[0];
                if (setRow === undefined) {
                  return { status: "missing" as const };
                }
                const submissionRows = yield* tx
                  .select({
                    completedAt: transactionProposalSubmissions.completedAt,
                  })
                  .from(transactionProposalSubmissions)
                  .where(
                    and(
                      eq(transactionProposalSubmissions.userId, input.userId),
                      eq(transactionProposalSubmissions.setId, input.setId),
                    ),
                  );
                if (submissionRows.some((row) => row.completedAt === null)) {
                  return { status: "in_flight" as const };
                }
                const positionRows = yield* tx
                  .select({
                    position: transactionProposalItems.position,
                    state: transactionProposalItems.state,
                    settled: transactionProposalItems.settled,
                  })
                  .from(transactionProposalItems)
                  .where(
                    and(
                      eq(transactionProposalItems.userId, input.userId),
                      eq(transactionProposalItems.setId, input.setId),
                    ),
                  );
                if (positionRows.every(isSettledItem)) {
                  return { status: "closed" as const };
                }
                const nextPosition = positionRows.reduce(
                  (next, row) => Math.max(next, row.position + 1),
                  0,
                );
                const rows = input.items.map((item, index) =>
                  storeRow(input, input.setId, item, nextPosition + index),
                );
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
                yield* applyChanges(tx, input);
                yield* tx
                  .update(transactionProposalSets)
                  .set({
                    fingerprint,
                    teams,
                    orders: input.orders.length === 0 ? null : [...input.orders],
                    updatedAt: DateTime.toDateUtc(input.at),
                  })
                  .where(
                    and(
                      eq(transactionProposalSets.userId, input.userId),
                      eq(transactionProposalSets.id, input.setId),
                    ),
                  );
                return { status: "appended" as const, items };
              }),
            );
          }).pipe(Effect.mapError(persistenceFailure)),
      );

      const withdraw = Effect.fn("TransactionProposalRepository.withdraw")(function* (input: {
        readonly userId: UserId;
        readonly setId: ProposalSetId;
        readonly remove: ReadonlyArray<ProposalItemId>;
        readonly changes: ReadonlyArray<ProposalItemChange>;
        readonly orders: ReadonlyArray<StoredProposalOrder>;
        readonly at: DateTime.Utc;
      }) {
        const fingerprint = yield* newId;
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const setRows = yield* tx
                .select()
                .from(transactionProposalSets)
                .where(
                  and(
                    eq(transactionProposalSets.userId, input.userId),
                    eq(transactionProposalSets.id, input.setId),
                  ),
                )
                .for("update");
              const setRow = setRows[0];
              if (setRow === undefined) {
                return { status: "missing" as const };
              }
              const submissions = yield* tx
                .select({ completedAt: transactionProposalSubmissions.completedAt })
                .from(transactionProposalSubmissions)
                .where(
                  and(
                    eq(transactionProposalSubmissions.userId, input.userId),
                    eq(transactionProposalSubmissions.setId, input.setId),
                  ),
                );
              if (submissions.some((row) => row.completedAt === null)) {
                return { status: "in_flight" as const };
              }
              const ids = [...input.remove];
              if (!Array.isArrayNonEmpty(ids)) {
                return yield* ProposalPersistenceFailed.make({
                  cause: new Error("A withdrawal names no items"),
                });
              }
              const locked = yield* tx
                .select({ id: transactionProposalItems.id, state: transactionProposalItems.state })
                .from(transactionProposalItems)
                .where(
                  and(
                    eq(transactionProposalItems.userId, input.userId),
                    eq(transactionProposalItems.setId, input.setId),
                    anyOf(transactionProposalItems.id, ids),
                  ),
                )
                .for("update");
              const lockedById = new Map(locked.map((row) => [row.id, row.state] as const));
              if (locked.length !== ids.length || locked.some((row) => row.state !== "proposed")) {
                return {
                  status: "not_withdrawable" as const,
                  items: ids.map((id) => {
                    const state = lockedById.get(id);
                    return { item: id, ...(state === undefined ? {} : { state }) };
                  }),
                };
              }
              yield* tx
                .delete(transactionProposalSteps)
                .where(
                  and(
                    eq(transactionProposalSteps.userId, input.userId),
                    eq(transactionProposalSteps.setId, input.setId),
                    anyOf(transactionProposalSteps.itemId, ids),
                  ),
                );
              yield* tx
                .delete(transactionProposalItems)
                .where(
                  and(
                    eq(transactionProposalItems.userId, input.userId),
                    eq(transactionProposalItems.setId, input.setId),
                    anyOf(transactionProposalItems.id, ids),
                  ),
                );
              const planned = yield* applyChanges(tx, input);
              yield* tx
                .update(transactionProposalSets)
                .set({
                  fingerprint,
                  orders: input.orders.length === 0 ? null : [...input.orders],
                  updatedAt: DateTime.toDateUtc(input.at),
                })
                .where(
                  and(
                    eq(transactionProposalSets.userId, input.userId),
                    eq(transactionProposalSets.id, input.setId),
                  ),
                );
              return { status: "withdrawn" as const, items: planned };
            }),
          )
          .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
      });

      const dismissItems = Effect.fn("TransactionProposalRepository.dismissItems")(
        function* (input: {
          readonly userId: UserId;
          readonly setId: ProposalSetId;
          readonly items: ReadonlyArray<ProposalItemId>;
          readonly reason: string | undefined;
          readonly orders: ReadonlyArray<StoredProposalOrder>;
          readonly at: DateTime.Utc;
        }) {
          const ids = [...new Set(input.items)];
          if (!Array.isArrayNonEmpty(ids)) {
            return yield* ProposalPersistenceFailed.make({
              cause: new Error("A dismissal names no items"),
            });
          }
          const at = DateTime.toDateUtc(input.at);
          return yield* database
            .transaction((tx) =>
              Effect.gen(function* () {
                const setRows = yield* tx
                  .select({ id: transactionProposalSets.id })
                  .from(transactionProposalSets)
                  .where(
                    and(
                      eq(transactionProposalSets.userId, input.userId),
                      eq(transactionProposalSets.id, input.setId),
                    ),
                  )
                  .for("update");
                if (setRows[0] === undefined) {
                  return { status: "missing" as const };
                }
                const submissions = yield* tx
                  .select({ completedAt: transactionProposalSubmissions.completedAt })
                  .from(transactionProposalSubmissions)
                  .where(
                    and(
                      eq(transactionProposalSubmissions.userId, input.userId),
                      eq(transactionProposalSubmissions.setId, input.setId),
                    ),
                  );
                if (submissions.some((row) => row.completedAt === null)) {
                  return { status: "in_flight" as const };
                }
                const locked = yield* tx
                  .select({
                    id: transactionProposalItems.id,
                    state: transactionProposalItems.state,
                  })
                  .from(transactionProposalItems)
                  .where(
                    and(
                      eq(transactionProposalItems.userId, input.userId),
                      eq(transactionProposalItems.setId, input.setId),
                      anyOf(transactionProposalItems.id, ids),
                    ),
                  )
                  .for("update");
                const lockedById = new Map(locked.map((row) => [row.id, row.state] as const));
                const notOpen = ids.flatMap((id) => {
                  const state = lockedById.get(id);
                  return state !== undefined && isDismissibleItem(state)
                    ? []
                    : [{ item: id, ...(state === undefined ? {} : { state }) }];
                });
                if (notOpen.length > 0) {
                  return { status: "not_open" as const, items: notOpen };
                }
                const updated = yield* tx
                  .update(transactionProposalItems)
                  .set({
                    state: "dismissed",
                    settled: true,
                    outcomeDetail: input.reason ?? null,
                    updatedAt: at,
                  })
                  .where(
                    and(
                      eq(transactionProposalItems.userId, input.userId),
                      eq(transactionProposalItems.setId, input.setId),
                      anyOf(transactionProposalItems.id, ids),
                    ),
                  )
                  .returning();
                yield* tx
                  .update(transactionProposalSets)
                  .set({
                    orders: input.orders.length === 0 ? null : [...input.orders],
                    updatedAt: at,
                  })
                  .where(
                    and(
                      eq(transactionProposalSets.userId, input.userId),
                      eq(transactionProposalSets.id, input.setId),
                    ),
                  );
                const records = yield* Effect.forEach(updated, decodeItem);
                return { status: "dismissed" as const, items: records };
              }),
            )
            .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        },
      );

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
        const submissions = yield* loadSubmissions(userId, setId);
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
        return { set, submissions, items, steps };
      });

      const listForTeam = Effect.fn("TransactionProposalRepository.listForTeam")(function* (
        userId: UserId,
        input: {
          readonly team: TeamId;
          readonly state: "open" | "closed";
          readonly offset: number;
          readonly limit: number;
        },
      ) {
        const hasItemForTeam = exists(
          database
            .select({ id: transactionProposalItems.id })
            .from(transactionProposalItems)
            .where(
              and(
                eq(transactionProposalItems.setId, transactionProposalSets.id),
                eq(transactionProposalItems.userId, userId),
                eq(transactionProposalItems.teamId, input.team),
              ),
            ),
        );
        const hasOpenItem = exists(
          database
            .select({ id: transactionProposalItems.id })
            .from(transactionProposalItems)
            .where(
              and(
                eq(transactionProposalItems.setId, transactionProposalSets.id),
                eq(transactionProposalItems.userId, userId),
                eq(transactionProposalItems.settled, false),
              ),
            ),
        );
        const stateFilter = input.state === "open" ? hasOpenItem : not(hasOpenItem);
        const where = and(eq(transactionProposalSets.userId, userId), hasItemForTeam, stateFilter);
        const counted = yield* database
          .select({ total: count() })
          .from(transactionProposalSets)
          .where(where)
          .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        const total = counted[0]?.total ?? 0;
        const rows = yield* database
          .select()
          .from(transactionProposalSets)
          .where(where)
          .orderBy(desc(transactionProposalSets.updatedAt), desc(transactionProposalSets.id))
          .limit(input.limit)
          .offset(input.offset)
          .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        const sets = yield* Effect.forEach(rows, decodeSet);
        const ids = sets.map((set) => set.id);
        if (!Array.isArrayNonEmpty(ids)) {
          return { sets: [], total };
        }
        const itemRows = yield* database
          .select()
          .from(transactionProposalItems)
          .where(
            and(
              eq(transactionProposalItems.userId, userId),
              anyOf(transactionProposalItems.setId, ids),
              eq(transactionProposalItems.teamId, input.team),
            ),
          )
          .orderBy(asc(transactionProposalItems.setId), asc(transactionProposalItems.position))
          .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        const items = yield* Effect.forEach(itemRows, decodeItem);
        const itemsBySet = new Map<string, Array<ProposalItemRecord>>();
        for (const item of items) {
          const current = itemsBySet.get(item.setId) ?? [];
          current.push(item);
          itemsBySet.set(item.setId, current);
        }
        return {
          sets: sets.map((set) => ({ set, items: itemsBySet.get(set.id) ?? [] })),
          total,
        };
      });

      const loadItem = Effect.fn("TransactionProposalRepository.loadItem")(function* (
        userId: UserId,
        itemId: ProposalItemId,
      ) {
        const rows = yield* database
          .select()
          .from(transactionProposalItems)
          .where(
            and(
              eq(transactionProposalItems.userId, userId),
              eq(transactionProposalItems.id, itemId),
            ),
          )
          .limit(1)
          .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        const row = rows[0];
        return row === undefined ? undefined : yield* decodeItem(row);
      });

      const listDueApproved = Effect.fn("TransactionProposalRepository.listDueApproved")(
        function* (input: { readonly before: string; readonly limit: number }) {
          const rows = yield* database
            .select({
              item: transactionProposalItems.id,
              set: transactionProposalItems.setId,
              team: transactionProposalItems.teamId,
              user: transactionProposalItems.userId,
              provider: providerTeams.provider,
              window: transactionProposalItems.windowDate,
            })
            .from(transactionProposalItems)
            .innerJoin(
              providerTeams,
              and(
                eq(providerTeams.id, transactionProposalItems.teamId),
                eq(providerTeams.userId, transactionProposalItems.userId),
              ),
            )
            .where(
              and(
                eq(transactionProposalItems.state, "proposed"),
                isNotNull(transactionProposalItems.approvedAt),
                isNotNull(transactionProposalItems.windowDate),
                lte(transactionProposalItems.windowDate, input.before),
              ),
            )
            .orderBy(asc(transactionProposalItems.windowDate), asc(transactionProposalItems.id))
            .limit(input.limit)
            .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
          return yield* Effect.forEach(rows, (row) =>
            Schema.decodeUnknownEffect(DueProposalSelected)(row).pipe(
              Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })),
            ),
          );
        },
      );

      const saveChecks = Effect.fn("TransactionProposalRepository.saveChecks")(function* (input: {
        readonly userId: UserId;
        readonly setId: ProposalSetId;
        readonly changes: ReadonlyArray<ProposalItemChange>;
        readonly orders: ReadonlyArray<StoredProposalOrder>;
        readonly at: DateTime.Utc;
      }) {
        return yield* database
          .transaction((tx) =>
            Effect.gen(function* () {
              const planned = yield* applyChanges(tx, input);
              yield* tx
                .update(transactionProposalSets)
                .set({
                  orders: input.orders.length === 0 ? null : [...input.orders],
                  updatedAt: DateTime.toDateUtc(input.at),
                })
                .where(
                  and(
                    eq(transactionProposalSets.userId, input.userId),
                    eq(transactionProposalSets.id, input.setId),
                  ),
                );
              return planned;
            }),
          )
          .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
      });

      const recordLineups = Effect.fn("TransactionProposalRepository.recordLineups")(
        function* (input: {
          readonly userId: UserId;
          readonly setId: ProposalSetId;
          readonly lineups: ReadonlyArray<StoredProposalLineup>;
          readonly at: DateTime.Utc;
        }) {
          return yield* database
            .update(transactionProposalSets)
            .set({
              lineups: input.lineups.length === 0 ? null : [...input.lineups],
              updatedAt: DateTime.toDateUtc(input.at),
            })
            .where(
              and(
                eq(transactionProposalSets.userId, input.userId),
                eq(transactionProposalSets.id, input.setId),
              ),
            )
            .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        },
      );

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

      const saveTradeStates = Effect.fn("TransactionProposalRepository.saveTradeStates")(
        function* (input: {
          readonly userId: UserId;
          readonly changes: ReadonlyArray<ProposalTradeCommand>;
        }) {
          const changes = [...input.changes];
          if (!Array.isArrayNonEmpty(changes)) {
            return [];
          }
          const byId = new Map(changes.map((change) => [change.itemId, change] as const));
          const ids = [...byId.keys()];
          if (!Array.isArrayNonEmpty(ids)) {
            return [];
          }
          return yield* database
            .transaction((tx) =>
              mutateRows(tx, transactionProposalItems, {
                where: eq(transactionProposalItems.userId, input.userId),
                ids,
                codec: ProposalItemRow,
                plan: (locked) =>
                  Effect.sync(() => {
                    const planned: Array<ProposalItemRecord> = [];
                    for (const id of ids) {
                      const change = byId.get(id);
                      const record = locked.get(id);
                      if (change === undefined || record === undefined) {
                        continue;
                      }
                      planned.push({
                        ...record,
                        state: change.state,
                        trade: change.trade,
                        updatedAt: change.at,
                      });
                    }
                    return planned;
                  }),
              }),
            )
            .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        },
      );

      const claimSubmission = Effect.fn("TransactionProposalRepository.claimSubmission")(
        function* (input: {
          readonly userId: UserId;
          readonly setId: ProposalSetId;
          readonly at: DateTime.Utc;
        }) {
          const at = DateTime.toDateUtc(input.at);
          return yield* database
            .transaction((tx) =>
              Effect.gen(function* () {
                const setRows = yield* tx
                  .select({ id: transactionProposalSets.id })
                  .from(transactionProposalSets)
                  .where(
                    and(
                      eq(transactionProposalSets.userId, input.userId),
                      eq(transactionProposalSets.id, input.setId),
                    ),
                  )
                  .for("update");
                const setRow = setRows[0];
                if (setRow === undefined) {
                  return { status: "missing" as const };
                }
                const inFlight = yield* tx
                  .select({ id: transactionProposalSubmissions.id })
                  .from(transactionProposalSubmissions)
                  .where(
                    and(
                      eq(transactionProposalSubmissions.userId, input.userId),
                      eq(transactionProposalSubmissions.setId, input.setId),
                      isNull(transactionProposalSubmissions.completedAt),
                    ),
                  )
                  .limit(1);
                if (inFlight.length > 0) {
                  return { status: "in_flight" as const };
                }
                const ordinals = yield* tx
                  .select({ ordinal: transactionProposalSubmissions.ordinal })
                  .from(transactionProposalSubmissions)
                  .where(
                    and(
                      eq(transactionProposalSubmissions.userId, input.userId),
                      eq(transactionProposalSubmissions.setId, input.setId),
                    ),
                  );
                const ordinal = ordinals.reduce((next, row) => Math.max(next, row.ordinal), 0) + 1;
                const submissionId = yield* newId;
                const inserted = yield* tx
                  .insert(transactionProposalSubmissions)
                  .values({
                    id: submissionId,
                    setId: input.setId,
                    userId: input.userId,
                    ordinal,
                    submittedAt: at,
                  })
                  .returning({ id: transactionProposalSubmissions.id });
                const submission = inserted[0];
                if (submission === undefined) {
                  return yield* ProposalPersistenceFailed.make({
                    cause: new Error("A claimed submission was not returned"),
                  });
                }
                return { status: "claimed" as const, submissionId: submission.id };
              }),
            )
            .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
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
                          settled: outcome.settled,
                          ...(outcome.position === undefined
                            ? {}
                            : { executionPosition: outcome.position }),
                          ...(outcome.trade === undefined ? {} : { trade: outcome.trade }),
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
          readonly submissionId: string;
          readonly at: DateTime.Utc;
        }) {
          yield* database
            .update(transactionProposalSubmissions)
            .set({ completedAt: DateTime.toDateUtc(input.at) })
            .where(
              and(
                eq(transactionProposalSubmissions.userId, input.userId),
                eq(transactionProposalSubmissions.setId, input.setId),
                eq(transactionProposalSubmissions.id, input.submissionId),
                isNull(transactionProposalSubmissions.completedAt),
              ),
            )
            .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        },
      );

      function loadSubmissions(
        userId: UserId,
        setId: ProposalSetId,
      ): Effect.Effect<ReadonlyArray<StoredProposalSubmission>, ProposalPersistenceFailed> {
        return database
          .select()
          .from(transactionProposalSubmissions)
          .where(
            and(
              eq(transactionProposalSubmissions.userId, userId),
              eq(transactionProposalSubmissions.setId, setId),
            ),
          )
          .orderBy(asc(transactionProposalSubmissions.ordinal))
          .pipe(
            Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })),
            Effect.flatMap((rows) => Effect.forEach(rows, decodeSubmission)),
          );
      }

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
        append,
        withdraw,
        dismissItems,
        newItemId,
        newSetId,
        load,
        loadItem,
        listDueApproved,
        listForTeam,
        listTeams,
        loadTeams,
        saveChecks,
        saveTradeStates,
        claimSubmission,
        recordItemOutcomes,
        completeSubmission,
        recordLineups,
      };

      function applyChanges(
        tx: Pick<Parameters<Parameters<typeof database.transaction>[0]>[0], "select" | "update">,
        input: {
          readonly userId: UserId;
          readonly setId: ProposalSetId;
          readonly changes: ReadonlyArray<ProposalItemChange>;
          readonly at: DateTime.Utc;
        },
      ): Effect.Effect<ReadonlyArray<ProposalItemRecord>, ProposalPersistenceFailed> {
        const ids = input.changes.map((change) => change.id);
        if (!Array.isArrayNonEmpty(ids)) {
          return Effect.succeed([]);
        }
        const changeById = new Map(input.changes.map((change) => [change.id, change] as const));
        return mutateRows(tx, transactionProposalItems, {
          where: and(
            eq(transactionProposalItems.userId, input.userId),
            eq(transactionProposalItems.setId, input.setId),
          ),
          ids,
          codec: ProposalItemRow,
          plan: (locked) =>
            Effect.sync(() => {
              const records: Array<ProposalItemRecord> = [];
              for (const id of ids) {
                const change = changeById.get(id);
                const record = locked.get(id);
                if (change === undefined || record === undefined) {
                  continue;
                }
                records.push({
                  ...record,
                  adds: change.adds,
                  drops: change.drops,
                  reserveMove: change.reserveMove,
                  placement: change.placement,
                  staleness: change.staleness,
                  ...(change.trade === undefined ? {} : { trade: change.trade }),
                  ...(change.state === undefined ? {} : { state: change.state }),
                  ...(change.effectiveDate === undefined
                    ? {}
                    : { effectiveDate: change.effectiveDate }),
                  ...(change.approvedAt === undefined || record.approvedAt !== undefined
                    ? {}
                    : { approvedAt: change.approvedAt }),
                  updatedAt: input.at,
                });
              }
              return records;
            }),
        }).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
      }

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
          const submissions = yield* loadSubmissions(userId, set.id);
          return { set, submissions, items, steps, created: false };
        });
      }
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

function persistenceFailure(cause: unknown): ProposalPersistenceFailed {
  return Schema.is(ProposalPersistenceFailed)(cause)
    ? cause
    : ProposalPersistenceFailed.make({ cause });
}

function storeRow(
  input: { readonly userId: UserId; readonly at: DateTime.Utc },
  setId: ProposalSetId,
  item: ProposalItemStore,
  position: number,
): typeof transactionProposalItems.$inferInsert {
  const command = item.command;
  return {
    id: item.id,
    setId,
    position,
    userId: input.userId,
    teamId: command.team,
    connectionId: command.connection,
    kind: command.kind,
    addPlayers: command.adds,
    fallbackPlayers: command.fallbacks,
    dropPlayers: command.drops,
    picks: command.picks,
    slotMove: command.slotMove ?? null,
    reserveMove: item.reserveMove ?? null,
    intent: command.intent ?? null,
    placement: item.placement ?? null,
    counterpartyTeamKey: command.counterpartyKey ?? null,
    counterpartyName: command.counterpartyName ?? null,
    bid: command.bid ?? null,
    windowDate: command.window ?? null,
    effectiveDate: item.effectiveDate ?? null,
    reason: command.reason,
    state: "proposed" as const,
    settled: false,
    staleness: item.check.status,
    staleReasons: item.check.reasons,
    checkedAt: item.check.checkedAt === undefined ? null : DateTime.toDateUtc(item.check.checkedAt),
    createdAt: DateTime.toDateUtc(input.at),
    updatedAt: DateTime.toDateUtc(input.at),
  };
}

const teamColumns = {
  id: providerTeams.id,
  connectionId: providerTeams.connectionId,
  name: providerTeams.name,
  provider: providerTeams.provider,
  providerLeagueKey: providerTeams.providerLeagueKey,
  league: providerTeams.league,
  sport: providerTeams.sport,
  season: providerTeams.season,
};

const DueProposalSelected = Schema.Struct({
  item: ProposalItemId,
  set: ProposalSetId,
  team: TeamId,
  user: UserId,
  provider: ProviderKey,
  window: Schema.String.pipe(Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u))),
});

const ProposalTeamSelected = Schema.Struct({
  id: Schema.String,
  connectionId: Schema.String,
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
        connection: yield* Schema.decodeEffect(ConnectionId)(team.connectionId).pipe(
          Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })),
        ),
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

function decodeSubmission(
  row: typeof transactionProposalSubmissions.$inferSelect,
): Effect.Effect<StoredProposalSubmission, ProposalPersistenceFailed> {
  return Schema.decodeEffect(ProposalSubmissionRow)(row).pipe(
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
