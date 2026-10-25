import { Feedback, FeedbackSubmission } from "@lineupkeep/backend/feedback/Feedback";
import { createServerFn } from "@tanstack/solid-start";
import { getRequest } from "@tanstack/solid-start/server";
import { Effect, Schema } from "effect";

import type {
  FeedbackDraftData,
  FeedbackListData,
  FeedbackSubmissionData,
} from "#contracts/feedback/feedbackContract.ts";
import { runUseCase } from "#server/backendEntry.ts";
import {
  FeedbackInputInvalid,
  mapFeedbackError,
  toFeedbackReportView,
} from "#server/feedback/feedbackPresentation.ts";

export const listFeedbackServerFn = createServerFn({ method: "GET" }).handler(() =>
  runUseCase(
    getRequest(),
    "feedback.list",
    (userId) =>
      Feedback.use((feedback) => feedback.list(userId, { limit: 50 })).pipe(
        Effect.map((reports): FeedbackListData => ({ reports: reports.map(toFeedbackReportView) })),
      ),
    mapFeedbackError,
  ),
);

export const submitFeedbackServerFn = createServerFn({ method: "POST" })
  .validator((raw: FeedbackDraftData) => Schema.decodeResult(FeedbackSubmission)(raw))
  .handler(({ data }) => {
    const request = getRequest();
    return runUseCase(
      request,
      "feedback.submit",
      (userId) =>
        Effect.gen(function* () {
          const input = yield* Effect.fromResult(data).pipe(
            Effect.mapError(() => FeedbackInputInvalid.make({})),
          );
          yield* Effect.annotateCurrentSpan({ "feedback.kind": input.kind });
          const reports = yield* Feedback.use((feedback) =>
            feedback.submit(userId, { kind: "user", reference: "web" }, [input]),
          );
          const report = reports[0];
          if (report === undefined) {
            return yield* FeedbackInputInvalid.make({});
          }
          const all = yield* Feedback.use((feedback) => feedback.list(userId, { limit: 50 }));
          return {
            report: toFeedbackReportView(report),
            reports: all.map(toFeedbackReportView),
          } satisfies FeedbackSubmissionData;
        }),
      (error) =>
        error._tag === "FeedbackInputInvalid"
          ? { type: "feedback.input_invalid", outcome: "rejected" }
          : mapFeedbackError(error),
    );
  });
