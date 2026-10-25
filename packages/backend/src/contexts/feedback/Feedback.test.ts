import * as NodeCrypto from "@effect/platform-node-shared/NodeCrypto";
import { assert, it } from "@effect/vitest";
import { decodeUserId } from "@lineupkeep/backend/auth/User";
import { Array, DateTime, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";

import {
  Feedback,
  FeedbackContentInvalid,
  FeedbackId,
  FeedbackRateLimited,
  TeamReference,
} from "./Feedback.ts";
import type { FeedbackSubmission, FeedbackTriageResult } from "./Feedback.ts";
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
    const acknowledged = Array.getUnsafe(
      yield* feedback.submit(user, { kind: "user", reference: "web" }, [
        submission({ kind: "bug", title: "Slow run" }),
      ]),
      0,
    );
    yield* feedback.triage(user, [{ feedback: acknowledged.id, action: "acknowledge" }]);

    const bugs = yield* feedback.list(user, { kinds: ["bug"] });
    const acknowledgedReports = yield* feedback.list(user, { statuses: ["acknowledged"] });
    const open = yield* feedback.list(user, { statuses: ["open"] });
    const recent = yield* feedback.list(user, { since, limit: 10 });

    assert.deepStrictEqual(
      bugs.map((report) => report.title),
      ["Slow run", "Broken roster"],
    );
    assert.deepStrictEqual(
      acknowledgedReports.map((report) => report.title),
      ["Slow run"],
    );
    assert.deepStrictEqual(
      open.map((report) => report.title),
      ["Export a season", "Broken roster"],
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

it.effect("acknowledges, resolves with a note, and treats repeats as unchanged", () =>
  Effect.gen(function* () {
    const feedback = yield* Feedback;
    const report = Array.getUnsafe(
      yield* feedback.submit(user, { kind: "user", reference: "web" }, [submission()]),
      0,
    );

    const acknowledged = triaged(
      yield* feedback.triage(user, [{ feedback: report.id, action: "acknowledge" }]),
    );
    assert.strictEqual(acknowledged.outcome, "changed");
    assert.strictEqual(acknowledged.feedback.status, "acknowledged");
    assert.isUndefined(acknowledged.feedback.closedAt);

    const repeated = triaged(
      yield* feedback.triage(user, [{ feedback: report.id, action: "acknowledge" }]),
    );
    assert.strictEqual(repeated.outcome, "unchanged");
    assert.strictEqual(repeated.feedback.status, "acknowledged");

    yield* TestClock.adjust(1_000);
    const resolved = triaged(
      yield* feedback.triage(user, [
        { feedback: report.id, action: "resolve", note: "Fixed the week mapping." },
      ]),
    );
    assert.strictEqual(resolved.outcome, "changed");
    assert.strictEqual(resolved.feedback.status, "resolved");
    assert.strictEqual(resolved.feedback.resolutionNote, "Fixed the week mapping.");
    assert.isDefined(resolved.feedback.closedAt);

    const again = triaged(
      yield* feedback.triage(user, [
        { feedback: report.id, action: "resolve", note: "A different note." },
      ]),
    );
    assert.strictEqual(again.outcome, "unchanged");
    assert.strictEqual(again.feedback.resolutionNote, "Fixed the week mapping.");

    const reopened = triaged(
      yield* feedback.triage(user, [{ feedback: report.id, action: "acknowledge" }]),
    );
    assert.strictEqual(reopened.outcome, "rejected");
    if (reopened.outcome === "rejected") {
      assert.strictEqual(reopened.rejection, "already-closed");
    }

    const stored = Array.getUnsafe(yield* feedback.list(user, { statuses: ["resolved"] }), 0);
    assert.strictEqual(stored.status, "resolved");
    assert.strictEqual(stored.resolutionNote, "Fixed the week mapping.");
  }).pipe(Effect.provide(FeedbackTestLayer)),
);

it.effect("closes a report as not planned once and refuses changes to another owner", () =>
  Effect.gen(function* () {
    const feedback = yield* Feedback;
    const report = Array.getUnsafe(
      yield* feedback.submit(user, { kind: "user", reference: "web" }, [submission()]),
      0,
    );

    const closed = triaged(
      yield* feedback.triage(user, [{ feedback: report.id, action: "wontfix" }]),
    );
    assert.strictEqual(closed.outcome, "changed");
    assert.strictEqual(closed.feedback.status, "wontfix");
    assert.isUndefined(closed.feedback.resolutionNote);

    const repeated = triaged(
      yield* feedback.triage(user, [{ feedback: report.id, action: "wontfix" }]),
    );
    assert.strictEqual(repeated.outcome, "unchanged");

    const refused = triaged(
      yield* feedback.triage(user, [{ feedback: report.id, action: "resolve", note: "Late fix." }]),
    );
    assert.strictEqual(refused.outcome, "rejected");

    const foreign = Array.getUnsafe(
      yield* feedback.triage(other, [{ feedback: report.id, action: "acknowledge" }]),
      0,
    );
    assert.strictEqual(foreign.outcome, "not_found");

    const unknownId = yield* Schema.decodeEffect(FeedbackId)(
      "018f79ea-7d86-7c18-9b4a-8b4d0c9169ff",
    );
    const missing = Array.getUnsafe(
      yield* feedback.triage(user, [{ feedback: unknownId, action: "acknowledge" }]),
      0,
    );
    assert.strictEqual(missing.outcome, "not_found");

    assert.deepStrictEqual(
      (yield* feedback.list(other, {})).map((candidate) => candidate.id),
      [],
    );
    assert.strictEqual(Array.getUnsafe(yield* feedback.list(user, {}), 0).status, "wontfix");
  }).pipe(Effect.provide(FeedbackTestLayer)),
);

it.effect("serves one owner's report in one batch and keeps a repeated id once", () =>
  Effect.gen(function* () {
    const feedback = yield* Feedback;
    const submitted = yield* feedback.submit(user, { kind: "agent", reference: "mcp" }, [
      submission({ title: "First" }),
      submission({ title: "Second" }),
    ]);
    const firstId = Array.getUnsafe(submitted, 0).id;
    const secondId = Array.getUnsafe(submitted, 1).id;

    const results = yield* feedback.triage(user, [
      { feedback: firstId, action: "acknowledge" },
      { feedback: secondId, action: "wontfix" },
      { feedback: firstId, action: "resolve", note: "Duplicate input." },
    ]);

    assert.deepStrictEqual(
      results.map((result) => [result.action, result.outcome]),
      [
        ["acknowledge", "changed"],
        ["wontfix", "changed"],
      ],
    );
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

function triaged(
  results: ReadonlyArray<FeedbackTriageResult>,
): Exclude<FeedbackTriageResult, { readonly outcome: "not_found" }> {
  const result = Array.getUnsafe(results, 0);
  if (result.outcome === "not_found") {
    throw new Error("expected a report, received not_found");
  }
  return result;
}

function submission(overrides: Partial<FeedbackSubmission> = {}): FeedbackSubmission {
  return {
    kind: "friction",
    title: "A report",
    body: "Something was harder than it should be.",
    ...overrides,
  };
}
