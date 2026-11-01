import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { Array, DateTime, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";

import {
  Feedback,
  FeedbackContentInvalid,
  FeedbackRateLimited,
  TeamReference,
} from "./Feedback.ts";
import type { FeedbackSubmission } from "./Feedback.ts";
import { FeedbackDatabaseTest } from "./internal/FeedbackDatabaseTest.ts";
import { FeedbackLive } from "./internal/FeedbackLive.ts";
import { FeedbackRepository } from "./internal/FeedbackRepository.ts";

it.effect("records an owner's submission with normalized text and an open status", () =>
  Effect.gen(function* () {
    const feedback = yield* Feedback;
    const report = Array.getUnsafe(
      yield* feedback.submit(user, { kind: "user", reference: "web" }, [
        {
          kind: "bug",
          title: "  Lineup\r\n  shows\u0000 the wrong   week ",
          body: "\u0007The roster view says week 3 but the run used week 4.\r\n",
          context: { surface: "team", team, tool: "list_teams" },
        },
      ]),
      0,
    );

    assert.strictEqual(report.status, "open");
    assert.deepStrictEqual(report.submitter, { kind: "user", reference: "web" });
    assert.strictEqual(report.title, "Lineup shows the wrong week");
    assert.strictEqual(report.body, "The roster view says week 3 but the run used week 4.");
    assert.deepStrictEqual(report.context, { surface: "team", team, tool: "list_teams" });
    assert.strictEqual(report.resolutionNote, undefined);
    assert.strictEqual(report.closedAt, undefined);
    assert.deepStrictEqual(report.createdAt, report.updatedAt);
    assert.deepStrictEqual(Object.keys(report).sort(), [
      "body",
      "context",
      "createdAt",
      "id",
      "kind",
      "status",
      "submitter",
      "title",
      "updatedAt",
    ]);
  }).pipe(Effect.provide(FeedbackTestLayer)),
);

it.effect("accepts null context fields and stores only the provided context", () =>
  Effect.gen(function* () {
    const feedback = yield* Feedback;

    const [withNullFields, withNullContext] = yield* feedback.submit(
      user,
      { kind: "agent", reference: "mcp" },
      [
        {
          kind: "bug",
          title: "Null context fields",
          body: "The published schema allows null optional fields.",
          context: { tool: null, team: null, client: null, surface: null },
        },
        {
          kind: "bug",
          title: "Null context",
          body: "The published schema allows a null context object.",
          context: null,
        },
      ],
    );

    assert.deepStrictEqual(withNullFields?.context, {});
    assert.deepStrictEqual(withNullContext?.context, {});
  }).pipe(Effect.provide(FeedbackTestLayer)),
);

it.effect("returns only the owner's reports, newest first", () =>
  Effect.gen(function* () {
    const feedback = yield* Feedback;
    yield* feedback.submit(user, { kind: "user", reference: "web" }, [
      submission({ title: "First report" }),
    ]);
    yield* TestClock.adjust(1_000);
    yield* feedback.submit(user, { kind: "agent", reference: "mcp" }, [
      submission({ title: "Second report" }),
    ]);

    const reports = yield* feedback.list(user, {});
    const otherReports = yield* feedback.list(other, {});

    assert.deepStrictEqual(
      reports.map((report) => report.title),
      ["Second report", "First report"],
    );
    assert.deepStrictEqual(
      reports.map((report) => report.submitter.kind),
      ["agent", "user"],
    );
    assert.deepStrictEqual(otherReports, []);
  }).pipe(Effect.provide(FeedbackTestLayer)),
);

it.effect("filters the owner's reports by status, kind, and start time", () =>
  Effect.gen(function* () {
    const feedback = yield* Feedback;
    yield* feedback.submit(user, { kind: "user", reference: "web" }, [
      submission({ kind: "bug", title: "Broken roster" }),
    ]);
    yield* TestClock.adjust(1_000);
    yield* feedback.submit(user, { kind: "user", reference: "web" }, [
      submission({ kind: "wishlist", title: "Export a season" }),
    ]);
    yield* TestClock.adjust(1_000);
    const since = yield* DateTime.now;
    yield* TestClock.adjust(1_000);
    yield* feedback.submit(user, { kind: "user", reference: "web" }, [
      submission({ kind: "bug", title: "Slow run" }),
    ]);

    const bugs = yield* feedback.list(user, { kinds: ["bug"] });
    const open = yield* feedback.list(user, { statuses: ["open"] });
    const recent = yield* feedback.list(user, { since, limit: 10 });

    assert.deepStrictEqual(
      bugs.map((report) => report.title),
      ["Slow run", "Broken roster"],
    );
    assert.deepStrictEqual(
      open.map((report) => report.title),
      ["Slow run", "Export a season", "Broken roster"],
    );
    assert.deepStrictEqual(
      recent.map((report) => report.title),
      ["Slow run"],
    );
  }).pipe(Effect.provide(FeedbackTestLayer)),
);

it.effect("limits submissions per acting client and per owner", () =>
  Effect.gen(function* () {
    const feedback = yield* Feedback;
    const muse = { kind: "agent" as const, reference: "mcp" };

    for (let sent = 0; sent < 10; sent++) {
      yield* feedback.submit(user, muse, [
        submission({ context: { client: "Muse", surface: "mcp" } }),
      ]);
    }
    const clientLimited = yield* Effect.flip(
      feedback.submit(user, muse, [submission({ context: { client: "Muse", surface: "mcp" } })]),
    );
    assert.instanceOf(clientLimited, FeedbackRateLimited);
    assert.strictEqual(clientLimited.retryAfterSeconds, 3_600);

    const otherClient = { kind: "agent" as const, reference: "mcp" };
    for (let sent = 0; sent < 9; sent++) {
      yield* feedback.submit(user, otherClient, [
        submission({ context: { client: "OpenCode", surface: "mcp" } }),
      ]);
    }
    const ownerLimited = yield* Effect.flip(
      feedback.submit(user, otherClient, [
        submission({ context: { client: "OpenCode", surface: "mcp" } }),
      ]),
    );
    assert.instanceOf(ownerLimited, FeedbackRateLimited);

    yield* feedback.submit(other, muse, [submission()]);
    yield* TestClock.adjust(3_600_000);
    const accepted = Array.getUnsafe(
      yield* feedback.submit(user, muse, [
        submission({ context: { client: "Muse", surface: "mcp" } }),
      ]),
      0,
    );
    assert.strictEqual(accepted.status, "open");
  }).pipe(Effect.provide(FeedbackTestLayer)),
);

it.effect("refuses content that is blank or too long once control characters are removed", () =>
  Effect.gen(function* () {
    const feedback = yield* Feedback;
    const blank = yield* Effect.flip(
      feedback.submit(user, { kind: "user", reference: "web" }, [
        submission({ title: "\u0000\u0007 " }),
      ]),
    );
    const tooLong = yield* Effect.flip(
      feedback.submit(user, { kind: "user", reference: "web" }, [
        submission({ body: "x".repeat(4_001) }),
      ]),
    );

    assert.instanceOf(blank, FeedbackContentInvalid);
    assert.instanceOf(tooLong, FeedbackContentInvalid);
    assert.deepStrictEqual(yield* feedback.list(user, {}), []);
  }).pipe(Effect.provide(FeedbackTestLayer)),
);

const user = decodeUserId("owner");
const other = decodeUserId("other");
const team = Schema.decodeSync(TeamReference)("018f79ea-7d86-7c18-9b4a-8b4d0c9164a2");
const FeedbackTestLayer = FeedbackLive.pipe(
  Layer.provide(FeedbackRepository.layer),
  Layer.provideMerge(FeedbackDatabaseTest),
  Layer.provide(NodeCrypto.layer),
  Layer.orDie,
);

function submission(overrides: Partial<FeedbackSubmission> = {}): FeedbackSubmission {
  return {
    kind: "friction",
    title: "A report",
    body: "Something was harder than it should be.",
    ...overrides,
  };
}
