import { expect, signUp, test } from "./support";
import { captureCheckpoint } from "./verify/capture";

test("submits feedback from the app and keeps it listed with its status", async ({
  page,
}, info) => {
  await signUp(page);
  await page.goto("/feedback");

  await expect(page.getByRole("heading", { name: "Feedback", exact: true })).toBeVisible();
  await expect(page.getByText("No reports yet.", { exact: true })).toBeVisible();

  await page.getByLabel("Kind").selectOption("friction");
  await page.getByLabel("Title").fill("Refresh is slow");
  await page.getByLabel("Details").fill("Refreshing teams took a long time after linking Yahoo.");
  await page.getByRole("button", { name: "Send feedback" }).click();

  await expect(page.getByText("Thanks, your report is recorded.")).toBeVisible();
  await expect(page.getByText("Refresh is slow")).toBeVisible();
  await expect(page.getByText("Difficult to use · Open")).toBeVisible();
  await captureCheckpoint(page, info, "feedback-submitted");

  await page.reload();

  await expect(page.getByText("Refresh is slow")).toBeVisible();
  await expect(page.getByText("Difficult to use · Open")).toBeVisible();
  await expect(page.getByText("Received. Nobody has reviewed it yet.")).toBeVisible();
});

test("carries a team's context into the feedback form from the team page", async ({
  page,
  services,
}) => {
  await signUp(page);
  await services.exercise(
    page,
    "link the provider fake and discover teams",
    "connectYahooAndDiscoverTeams",
    {},
  );
  await page.goto("/teams");
  await page.getByRole("link", { name: "Embedded Browser Team", exact: true }).click();
  await page.getByRole("link", { name: "Report a problem with this team" }).click();

  await expect(page).toHaveURL(/\/feedback\?/u);
  await expect(page.getByText("Report about Embedded Browser Team.")).toBeVisible();
  await expect(page.getByLabel("Title")).toHaveValue("Problem with Embedded Browser Team");

  await page.getByLabel("Kind").selectOption("data-issue");
  await page.getByLabel("Title").fill("Roster totals look wrong");
  await page.getByLabel("Details").fill("The category totals do not match the provider page.");
  await page.getByRole("button", { name: "Send feedback" }).click();

  await expect(page.getByText("Thanks, your report is recorded.")).toBeVisible();
  await expect(page.getByText("Wrong data · Open")).toBeVisible();
  await expect(page.getByRole("listitem").getByText("Report about this team.")).toBeVisible();
});
