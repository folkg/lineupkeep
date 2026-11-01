import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { Array, Context, Crypto, DateTime, Effect, Layer, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type {
  FeedbackFilter,
  FeedbackSubmission,
  FeedbackSubmitter,
} from "#contexts/feedback/Feedback.ts";
import { FeedbackPersistenceFailed } from "#contexts/feedback/Feedback.ts";
import { addedToExcluded, anyOf, maxInsertRows } from "#database/dbUtilities.ts";
import { chunked } from "#utilities/collections.ts";

import { FeedbackDatabase } from "./FeedbackDatabase.ts";
import type { FeedbackRecord } from "./FeedbackRecord.ts";
import { feedback, feedbackQuota, FeedbackRow } from "./FeedbackTables.ts";

const listLimit = 50;

type FeedbackInsertRow = typeof feedback.$inferInsert & { readonly id: string };

type QuotaReservation = {
  readonly key: string;
  readonly amount: number;
  readonly limit: number;
  readonly windowStartedAt: DateTime.Utc;
};

export class FeedbackRepository extends Context.Service<FeedbackRepository>()(
  "@lineupkeep/backend/contexts/feedback/internal/FeedbackRepository",
  {
    make: Effect.gen(function* () {
      const database = yield* FeedbackDatabase;
      const crypto = yield* Crypto.Crypto;
      const newId = crypto
        .randomUUIDv7()
        .pipe(Effect.mapError((cause) => FeedbackPersistenceFailed.make({ cause })));

      const reserve = Effect.fn("FeedbackRepository.reserve")(function* (
        entries: ReadonlyArray<QuotaReservation>,
      ) {
        if (entries.length === 0) {
          return true;
        }
        const limits = new Map(entries.map((entry) => [entry.key, entry.limit] as const));
        const counted = yield* database
          .insert(feedbackQuota)
          .values(
            entries.map((entry) => ({
              key: entry.key,
              windowStartedAt: DateTime.toDateUtc(entry.windowStartedAt),
              count: entry.amount,
            })),
          )
          .onConflictDoUpdate({
            target: feedbackQuota.key,
            set: { count: addedToExcluded(feedbackQuota.count) },
          })
          .returning({ key: feedbackQuota.key, count: feedbackQuota.count })
          .pipe(Effect.mapError((cause) => FeedbackPersistenceFailed.make({ cause })));
        let allowed = counted.length === entries.length;
        for (const row of counted) {
          const limit = limits.get(row.key);
          if (limit === undefined) {
            return yield* FeedbackPersistenceFailed.make({
              cause: new Error("The feedback quota counter was not requested"),
            });
          }
          allowed &&= row.count <= limit;
        }
        return allowed;
      });

      const create = Effect.fn("FeedbackRepository.create")(function* (input: {
        readonly userId: UserId;
        readonly submitter: FeedbackSubmitter;
        readonly submissions: ReadonlyArray<FeedbackSubmission>;
        readonly at: DateTime.Utc;
      }) {
        const ids = yield* Effect.replicateEffect(input.submissions.length)(newId);
        const rows = Array.zipWith(ids, input.submissions, (id, submission) =>
          toRow(id, input, submission),
        ).toSorted((left, right) => left.id.localeCompare(right.id));
        const inserted = yield* chunked(rows, maxInsertRows(feedback), (chunk) =>
          database
            .insert(feedback)
            .values([...chunk])
            .returning(),
        ).pipe(Effect.mapError((cause) => FeedbackPersistenceFailed.make({ cause })));
        const decoded = yield* Effect.forEach(inserted, (row) =>
          Schema.decodeEffect(FeedbackRow)(row).pipe(
            Effect.mapError((cause) => FeedbackPersistenceFailed.make({ cause })),
          ),
        );
        const byId = new Map<string, FeedbackRecord>(decoded.map((record) => [record.id, record]));
        return Array.map(ids, (id) => {
          const record = byId.get(id);
          if (record === undefined) {
            throw new Error("A created feedback record was not returned");
          }
          return record;
        });
      });

      const list = Effect.fn("FeedbackRepository.list")(function* (input: {
        readonly userId: UserId;
        readonly filter: FeedbackFilter;
      }) {
        const statuses = nonEmpty(input.filter.statuses);
        const kinds = nonEmpty(input.filter.kinds);
        const rows = yield* database
          .select()
          .from(feedback)
          .where(
            and(
              eq(feedback.userId, input.userId),
              statuses === undefined ? undefined : anyOf(feedback.status, statuses),
              kinds === undefined ? undefined : anyOf(feedback.kind, kinds),
              input.filter.since === undefined
                ? undefined
                : gte(feedback.createdAt, DateTime.toDateUtc(input.filter.since)),
            ),
          )
          .orderBy(desc(feedback.createdAt), desc(feedback.id))
          .limit(input.filter.limit ?? listLimit)
          .pipe(Effect.mapError((cause) => FeedbackPersistenceFailed.make({ cause })));
        return yield* Effect.forEach(rows, (row) =>
          Schema.decodeEffect(FeedbackRow)(row).pipe(
            Effect.mapError((cause) => FeedbackPersistenceFailed.make({ cause })),
          ),
        );
      });

      const expired = Effect.fn("FeedbackRepository.expired")(function* (input: {
        readonly closedBefore: DateTime.Utc;
        readonly quotasBefore: DateTime.Utc;
        readonly limit: number;
      }) {
        return yield* Effect.gen(function* () {
          const closed = yield* database
            .select({ id: feedback.id })
            .from(feedback)
            .where(
              and(
                anyOf(feedback.status, ["resolved", "wontfix"]),
                lte(feedback.closedAt, DateTime.toDateUtc(input.closedBefore)),
              ),
            )
            .orderBy(asc(feedback.closedAt))
            .limit(input.limit);
          const closedIds = closed.map((row) => row.id);
          const reports = Array.isArrayNonEmpty(closedIds)
            ? (yield* database
                .delete(feedback)
                .where(anyOf(feedback.id, closedIds))
                .returning({ id: feedback.id })).length
            : 0;
          const windows = yield* database
            .select({ key: feedbackQuota.key })
            .from(feedbackQuota)
            .where(lte(feedbackQuota.windowStartedAt, DateTime.toDateUtc(input.quotasBefore)))
            .orderBy(asc(feedbackQuota.windowStartedAt))
            .limit(input.limit);
          const windowKeys = windows.map((row) => row.key);
          const quotas = Array.isArrayNonEmpty(windowKeys)
            ? (yield* database
                .delete(feedbackQuota)
                .where(anyOf(feedbackQuota.key, windowKeys))
                .returning({ key: feedbackQuota.key })).length
            : 0;
          return { reports, quotas };
        }).pipe(Effect.mapError((cause) => FeedbackPersistenceFailed.make({ cause })));
      });

      return { reserve, create, list, expired };
    }),
  },
) {
  static readonly layer = Layer.effect(this)(this.make);
}

function nonEmpty<A>(
  values: ReadonlyArray<A> | undefined,
): Array.NonEmptyReadonlyArray<A> | undefined {
  if (values === undefined) {
    return undefined;
  }
  const first = values[0];
  return first === undefined ? undefined : [first, ...values.slice(1)];
}

function toRow(
  id: string,
  input: {
    readonly userId: UserId;
    readonly submitter: FeedbackSubmitter;
    readonly at: DateTime.Utc;
  },
  submission: FeedbackSubmission,
): FeedbackInsertRow {
  return {
    id,
    userId: input.userId,
    submitterKind: input.submitter.kind,
    submitterReference: input.submitter.reference,
    kind: submission.kind,
    status: "open",
    title: submission.title,
    body: submission.body,
    toolName: submission.context?.tool ?? null,
    teamReference: submission.context?.team ?? null,
    clientName: submission.context?.client ?? null,
    surface: submission.context?.surface ?? null,
    resolutionNote: null,
    closedAt: null,
    createdAt: DateTime.toDateUtc(input.at),
    updatedAt: DateTime.toDateUtc(input.at),
  };
}
