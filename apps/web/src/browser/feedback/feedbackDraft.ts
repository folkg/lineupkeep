import type { FeedbackKind } from "@lineupkeep/backend/feedback/Feedback";

import type {
  FeedbackContextView,
  FeedbackDraftData,
} from "#contracts/feedback/feedbackContract.ts";

export const feedbackKinds = [
  "bug",
  "data-issue",
  "friction",
  "wishlist",
  "other",
] as const satisfies ReadonlyArray<FeedbackKind>;

export type FeedbackDraft = {
  readonly kind: FeedbackKind | "";
  readonly title: string;
  readonly body: string;
  readonly context: FeedbackContextView;
};

export type FeedbackDraftErrors = {
  readonly kind?: string;
  readonly title?: string;
  readonly body?: string;
};

export type FeedbackDraftCheck =
  | { readonly valid: true; readonly submission: FeedbackDraftData }
  | { readonly valid: false; readonly errors: FeedbackDraftErrors };

export const titleLimit = 120;
export const bodyLimit = 4_000;

export function emptyFeedbackDraft(context: FeedbackContextView = {}): FeedbackDraft {
  return { kind: "", title: "", body: "", context };
}

export function checkFeedbackDraft(draft: FeedbackDraft): FeedbackDraftCheck {
  const title = draft.title.trim();
  const body = draft.body.trim();
  const errors: FeedbackDraftErrors = {
    ...(draft.kind === "" ? { kind: "Choose what kind of report this is." } : {}),
    ...(title.length === 0
      ? { title: "Add a short title." }
      : title.length > titleLimit
        ? { title: `Keep the title to ${titleLimit} characters or fewer.` }
        : {}),
    ...(body.length === 0
      ? { body: "Describe what happened." }
      : body.length > bodyLimit
        ? { body: `Keep the details to ${bodyLimit} characters or fewer.` }
        : {}),
  };

  if (draft.kind === "") {
    return { valid: false, errors };
  }
  if (title.length === 0 || title.length > titleLimit) {
    return { valid: false, errors };
  }
  if (body.length === 0 || body.length > bodyLimit) {
    return { valid: false, errors };
  }
  const kind: FeedbackKind = draft.kind;
  return {
    valid: true,
    submission: {
      kind,
      title,
      body,
      ...(hasContext(draft.context) ? { context: draft.context } : {}),
    },
  };
}

function hasContext(context: FeedbackContextView): boolean {
  return (
    context.tool !== undefined ||
    context.team !== undefined ||
    context.client !== undefined ||
    context.surface !== undefined
  );
}
