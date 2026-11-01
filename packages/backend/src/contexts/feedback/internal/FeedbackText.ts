import type {
  FeedbackContext,
  FeedbackContextInput,
  FeedbackSubmission,
} from "#contexts/feedback/Feedback.ts";

export function normalizedSubmission(submission: FeedbackSubmission): FeedbackSubmission {
  const context = normalizedContext(submission.context);
  return {
    kind: submission.kind,
    title: singleLine(submission.title),
    body: multiLine(submission.body),
    ...(context === undefined ? {} : { context }),
  };
}

function normalizedContext(
  context: FeedbackContextInput | null | undefined,
): FeedbackContext | undefined {
  if (context === null || context === undefined) {
    return undefined;
  }
  return {
    ...(context.tool === null || context.tool === undefined
      ? {}
      : { tool: singleLine(context.tool) }),
    ...(context.team === null || context.team === undefined ? {} : { team: context.team }),
    ...(context.client === null || context.client === undefined
      ? {}
      : { client: singleLine(context.client) }),
    ...(context.surface === null || context.surface === undefined
      ? {}
      : { surface: context.surface }),
  };
}

function stripControlCharacters(value: string): string {
  let stripped = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    const allowedWhitespace = code === 0x09 || code === 0x0a || code === 0x0d;
    const control = (code < 0x20 && !allowedWhitespace) || (code >= 0x7f && code <= 0x9f);
    if (!control) {
      stripped += character;
    }
  }
  return stripped;
}

function singleLine(value: string): string {
  return stripControlCharacters(value).replace(/\s+/gu, " ").trim();
}

function multiLine(value: string): string {
  return stripControlCharacters(value.replace(/\r\n?/gu, "\n")).trim();
}
