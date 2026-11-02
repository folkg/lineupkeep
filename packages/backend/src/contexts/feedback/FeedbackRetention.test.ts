import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { DateTime, Effect, Layer } from "effect";
import { TestClock } from "effect/testing";

import { Feedback } from "./Feedback.ts";
import { FeedbackRetention } from "./FeedbackRetention.ts";
import { FeedbackDatabase } from "./internal/FeedbackDatabase.ts";
import { FeedbackDatabaseTest } from "./internal/FeedbackDatabaseTest.ts";
import { FeedbackLive } from "./internal/FeedbackLive.ts";
import { FeedbackRepository } from "./internal/FeedbackRepository.ts";
import { FeedbackRetentionLive } from "./internal/FeedbackRetentionLive.ts";
import { feedback as feedbackTable, feedbackQuota } from "./internal/FeedbackTables.ts";

it.effect("removes closed reports once their retention window ends", () =>
  Effect.gen(function* () {
    const feedback = yield* Feedback;
    const database = yield* FeedbackDatabase;
    const retention = yield* FeedbackRetention;
    yield* feedback.submit(user, { kind: "user", reference: "web" }, [
      { kind: "wishlist", title: "Keep this", body: "An open wishlist item." },
    ]);
    const closedAt = DateTime.toDateUtc(yield* DateTime.now);
    yield* database.insert(feedbackTable).values({
      id: "018f79ea-7d86-7c18-9b4a-8b4d0c9164b3",
      userId: user,
      submitterKind: "user",
      submitterReference: "web",
      kind: "bug",
      status: "resolved",
      title: "Drop this",
      body: "A closed bug report.",
      resolutionNote: "Fixed and deployed.",
      closedAt,
      createdAt: closedAt,
      updatedAt: closedAt,
    });

    yield* TestClock.adjust(aYearMillis - 1_000);
    const retained = yield* retention.run(10, yield* DateTime.now);
    assert.deepStrictEqual(retained.reports, 0);
    assert.strictEqual((yield* feedback.list(user, {})).length, 2);

    yield* TestClock.adjust(2_000);
    const deleted = yield* retention.run(10, yield* DateTime.now);
    const remaining = yield* feedback.list(user, {});

    assert.strictEqual(deleted.reports, 1);
    assert.deepStrictEqual(
      remaining.map((report) => report.title),
      ["Keep this"],
    );
  }).pipe(Effect.provide(FeedbackRetentionTestLayer)),
);

it.effect("removes quota windows that can no longer accept submissions", () =>
  Effect.gen(function* () {
    const feedback = yield* Feedback;
    const retention = yield* FeedbackRetention;
    const database = yield* FeedbackDatabase;
    yield* feedback.submit(user, { kind: "user", reference: "web" }, [
      { kind: "other", title: "One report", body: "Counts against the hour." },
    ]);

    const windows = yield* database.select().from(feedbackQuota);
    assert.strictEqual(windows.length, 2);

    yield* TestClock.adjust(25 * 60 * 60 * 1000);
    const deleted = yield* retention.run(10, yield* DateTime.now);

    assert.strictEqual(deleted.quotas, 2);
    assert.deepStrictEqual(yield* database.select().from(feedbackQuota), []);
  }).pipe(Effect.provide(FeedbackRetentionTestLayer)),
);

const user = decodeUserId("owner");
const aYearMillis = 365 * 24 * 60 * 60 * 1000;
const FeedbackRetentionTestLayer = Layer.mergeAll(FeedbackLive, FeedbackRetentionLive).pipe(
  Layer.provide(FeedbackRepository.layer),
  Layer.provideMerge(FeedbackDatabaseTest),
  Layer.provide(NodeCrypto.layer),
  Layer.orDie,
);
