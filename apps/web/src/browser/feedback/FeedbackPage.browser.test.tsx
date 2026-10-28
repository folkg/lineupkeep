import { render } from "@solidjs/web";
import { QueryClientProvider } from "@tanstack/solid-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
} from "@tanstack/solid-router";
import { expect, it } from "vitest";
import { page } from "vitest/browser";

import type { RouterContext } from "#browser/app-shell/routerContext.ts";
import { createQueryClient } from "#browser/query/queryClient.ts";
import type { SessionRemote } from "#browser/session/sessionRemote.ts";
import type {
  FeedbackContextView,
  FeedbackDraftData,
  FeedbackReportView,
  FeedbackSubmissionData,
} from "#contracts/feedback/feedbackContract.ts";

import { requireFeedbackSuccess } from "./feedbackFailure";
import { FeedbackPage } from "./FeedbackPage";
import { feedbackQueries } from "./feedbackQueries";
import type { FeedbackRemote } from "./feedbackRemote";

const team = "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2";
const reportedAt = "2026-10-25T08:00:00.000Z";

const baseReport: FeedbackReportView = {
  id: "018f79ea-7d86-7c18-9b4a-8b4d0c9164b3",
  submitter: "user",
  kind: "bug",
  status: "open",
  title: "Week is wrong",
  body: "The roster view says week 3 but the run used week 4.",
  context: { surface: "team", team },
  createdAt: reportedAt,
  updatedAt: reportedAt,
};

it("sends a report and lists it with its status", async () => {
  const submissions: Array<FeedbackDraftData> = [];
  using _app = setupFeedbackPage([], {
    submit: (input) => {
      submissions.push(input);
      const report: FeedbackReportView = {
        ...baseReport,
        kind: input.kind,
        title: input.title,
        body: input.body,
        context: {
          ...(input.context?.tool === null || input.context?.tool === undefined
            ? {}
            : { tool: input.context.tool }),
          ...(input.context?.team === null || input.context?.team === undefined
            ? {}
            : { team: input.context.team }),
          ...(input.context?.client === null || input.context?.client === undefined
            ? {}
            : { client: input.context.client }),
          ...(input.context?.surface === null || input.context?.surface === undefined
            ? {}
            : { surface: input.context.surface }),
        },
      };
      return Promise.resolve(
        requireFeedbackSuccess({ type: "success", data: { report, reports: [report] } } satisfies {
          type: "success";
          data: FeedbackSubmissionData;
        }),
      );
    },
  });

  await expect.element(page.getByText("No reports yet.")).toBeVisible();
  await page.getByLabelText("Kind").selectOptions("bug");
  await page.getByLabelText("Title").fill("  Week is wrong  ");
  await page.getByLabelText("Details").fill("The roster view says week 3 but the run used week 4.");
  await page.getByRole("button", { name: "Send feedback" }).click();

  await expect.element(page.getByText("Thanks, your report is recorded.")).toBeVisible();
  await expect.element(page.getByText("Week is wrong")).toBeVisible();
  await expect.element(page.getByText("Bug · Open")).toBeVisible();
  expect(submissions).toEqual([
    {
      kind: "bug",
      title: "Week is wrong",
      body: "The roster view says week 3 but the run used week 4.",
    },
  ]);
  expect(page.getByLabelText("Title")).toHaveDisplayValue("");
});

it("keeps the draft and explains a rate-limited submission", async () => {
  using _app = setupFeedbackPage([], {
    submit: () =>
      Promise.resolve(
        requireFeedbackSuccess({
          type: "error",
          error: { type: "feedback.rate_limited" },
        }),
      ),
  });

  await page.getByLabelText("Kind").selectOptions("friction");
  await page.getByLabelText("Title").fill("Slow refresh");
  await page.getByLabelText("Details").fill("Refreshing teams takes a long time.");
  await page.getByRole("button", { name: "Send feedback" }).click();

  await expect.element(page.getByText(/You have sent several reports/)).toBeVisible();
  expect(page.getByLabelText("Title")).toHaveDisplayValue("Slow refresh");
  expect(page.getByText("No reports yet.")).toBeVisible();
});

it("renders report text as text instead of markup", async () => {
  using _app = setupFeedbackPage([
    {
      ...baseReport,
      title: "Markup in a report",
      body: "<b>bold</b><img src=x onerror=alert(1)>",
    },
  ]);

  await expect.element(page.getByText("<b>bold</b><img src=x onerror=alert(1)>")).toBeVisible();
  expect(document.querySelector("img")).toBeNull();
  expect(document.body.textContent).toContain("<b>bold</b>");
});

it("shows the report's context and sends the linked team reference", async () => {
  const submissions: Array<FeedbackDraftData> = [];
  using _app = setupFeedbackPage(
    [],
    {
      submit: (input) => {
        submissions.push(input);
        return Promise.resolve(
          requireFeedbackSuccess({
            type: "success",
            data: { report: baseReport, reports: [baseReport] },
          }),
        );
      },
    },
    { surface: "team", team },
  );

  await expect.element(page.getByText("About this team")).toBeVisible();
  await page.getByLabelText("Kind").selectOptions("data-issue");
  await page.getByLabelText("Title").fill("Standings are wrong");
  await page.getByLabelText("Details").fill("The category totals do not add up.");
  await page.getByRole("button", { name: "Send feedback" }).click();

  await expect.element(page.getByText("Thanks, your report is recorded.")).toBeVisible();
  expect(submissions).toEqual([
    {
      kind: "data-issue",
      title: "Standings are wrong",
      body: "The category totals do not add up.",
      context: { surface: "team", team },
    },
  ]);
});

it("explains each missing field without sending a request", async () => {
  const submissions: Array<FeedbackDraftData> = [];
  using _app = setupFeedbackPage([], {
    submit: (input) => {
      submissions.push(input);
      return Promise.reject(new Error("Unexpected submission"));
    },
  });

  await page.getByRole("button", { name: "Send feedback" }).click();

  await expect.element(page.getByText("Choose what kind of report this is.")).toBeVisible();
  await expect.element(page.getByText("Add a short title.")).toBeVisible();
  await expect.element(page.getByText("Describe what happened.")).toBeVisible();
  expect(submissions).toEqual([]);
});

it("shows a resolved report with its note and a not-planned report", async () => {
  using _app = setupFeedbackPage([
    {
      ...baseReport,
      id: "018f79ea-7d86-7c18-9b4a-8b4d0c9164b4",
      status: "resolved",
      resolutionNote: "Fixed the week mapping.",
      closedAt: "2026-10-26T08:00:00.000Z",
    },
    {
      ...baseReport,
      id: "018f79ea-7d86-7c18-9b4a-8b4d0c9164b5",
      title: "Export a season",
      kind: "wishlist",
      status: "wontfix",
    },
  ]);

  await expect.element(page.getByText("Bug · Resolved")).toBeVisible();
  await expect.element(page.getByText("Resolved: Fixed the week mapping.")).toBeVisible();
  await expect.element(page.getByText("Idea · Not planned")).toBeVisible();
  await expect.element(page.getByText("Closed as not planned.")).toBeVisible();
});

function setupFeedbackPage(
  reports: ReadonlyArray<FeedbackReportView>,
  overrides: Partial<FeedbackRemote> = {},
  initialContext: FeedbackContextView = {},
): { [Symbol.dispose](): void } {
  const queryClient = createQueryClient();
  const remote: FeedbackRemote = {
    list: overrides.list ?? (() => Promise.resolve({ reports })),
    submit: overrides.submit ?? (() => Promise.reject(new Error("Unexpected submission"))),
  };
  const reportsQuery = feedbackQueries.list(remote);
  const sessionRemote: SessionRemote = {
    load: () => Promise.resolve({ status: "anonymous" }),
    signOut: () => Promise.resolve(),
  };
  const rootRoute = createRootRouteWithContext<RouterContext>()({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <Outlet />
      </QueryClientProvider>
    ),
  });
  const feedbackRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/feedback",
    component: () => (
      <FeedbackPage
        reportsQuery={() => reportsQuery}
        remote={remote}
        initialContext={() => initialContext}
        onRefresh={() => Promise.resolve()}
      />
    ),
  });
  const teamsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/teams",
    component: () => <p>Teams</p>,
  });
  const router = createRouter({
    context: { queryClient, sessionRemote },
    history: createMemoryHistory({ initialEntries: ["/feedback"] }),
    routeTree: rootRoute.addChildren([feedbackRoute, teamsRoute]),
  });
  const host = document.body.appendChild(document.createElement("div"));
  const dispose = render(() => <RouterProvider router={router} />, host);

  return {
    [Symbol.dispose](): void {
      dispose();
      queryClient.clear();
      host.remove();
    },
  };
}
