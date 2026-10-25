import type {
  FeedbackContext,
  FeedbackSubmission,
  FeedbackTriageInput,
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

export function normalizedTriage(input: FeedbackTriageInput): FeedbackTriageInput {
  switch (input.action) {
    case "acknowledge":
      return input;
    case "resolve":
      return { ...input, note: multiLine(input.note) };
    case "wontfix":
      return input.note === undefined ? input : { ...input, note: multiLine(input.note) };
  }
}

function normalizedContext(context: FeedbackContext | undefined): FeedbackContext | undefined {
  if (context === undefined) {
    return undefined;
  }
  return {
    ...(context.tool === undefined ? {} : { tool: singleLine(context.tool) }),
    ...(context.team === undefined ? {} : { team: context.team }),
    ...(context.client === undefined ? {} : { client: singleLine(context.client) }),
    ...(context.surface === undefined ? {} : { surface: context.surface }),
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
