import { expect, it } from "vitest";

import { checkFeedbackDraft, emptyFeedbackDraft } from "./feedbackDraft";

const team = "018f79ea-7d86-7c18-9b4a-8b4d0c9164a2";

it("turns a filled draft into a trimmed submission with its context", () => {
  const checked = checkFeedbackDraft({
    kind: "bug",
    title: "  Week is wrong  ",
    body: "  The run used the next week.\n",
    context: { surface: "team", team },
  });

  expect(checked).toEqual({
    valid: true,
    submission: {
      kind: "bug",
      title: "Week is wrong",
      body: "The run used the next week.",
      context: { surface: "team", team },
    },
  });
});

it("omits an empty context and reports every missing field", () => {
  const checked = checkFeedbackDraft(emptyFeedbackDraft());

  expect(checked).toEqual({
    valid: false,
    errors: {
      kind: "Choose what kind of report this is.",
      title: "Add a short title.",
      body: "Describe what happened.",
    },
  });
});

it("rejects a whitespace-only title and details", () => {
  const checked = checkFeedbackDraft({
    kind: "friction",
    title: "   ",
    body: "\n\t ",
    context: {},
  });

  expect(checked.valid).toBe(false);
  if (!checked.valid) {
    expect(checked.errors.title).toBeDefined();
    expect(checked.errors.body).toBeDefined();
    expect(checked.errors.kind).toBeUndefined();
  }
});

it("rejects content beyond the published length limits", () => {
  const checked = checkFeedbackDraft({
    kind: "other",
    title: "a".repeat(121),
    body: "b".repeat(4_001),
    context: {},
  });

  expect(checked.valid).toBe(false);
  if (!checked.valid) {
    expect(checked.errors.title).toBe("Keep the title to 120 characters or fewer.");
    expect(checked.errors.body).toBe("Keep the details to 4000 characters or fewer.");
  }
});
