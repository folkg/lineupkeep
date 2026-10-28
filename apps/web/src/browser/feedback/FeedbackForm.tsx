import type { JSX } from "@solidjs/web";

import { Button } from "#browser/shared-ui/Button.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { SelectField } from "#browser/shared-ui/SelectField.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextArea } from "#browser/shared-ui/TextArea.tsx";
import { TextField } from "#browser/shared-ui/TextField.tsx";

import { bodyLimit, feedbackKinds, titleLimit } from "./feedbackDraft";
import type { FeedbackDraft, FeedbackDraftErrors } from "./feedbackDraft";
import { feedbackKindLabel } from "./feedbackLabels";

export function FeedbackForm(props: FeedbackFormProps): JSX.Element {
  return (
    <Form gap="md" onSubmit={props.onSubmit}>
      <SelectField
        description="Pick the closest match, or choose Other."
        error={props.errors.kind}
        label="Kind"
        onChange={(event) => props.onKind(event.currentTarget.value)}
        options={feedbackKinds.map((kind) => ({ value: kind, label: feedbackKindLabel(kind) }))}
        placeholder="Choose a kind"
        value={props.draft.kind}
      />
      <TextField
        autocomplete="off"
        description={`A short summary, up to ${titleLimit} characters.`}
        error={props.errors.title}
        label="Title"
        onInput={(event) => props.onTitle(event.currentTarget.value)}
        value={props.draft.title}
      />
      <TextArea
        description={`What you did, what happened, and what you expected. Up to ${bodyLimit} characters.`}
        error={props.errors.body}
        label="Details"
        onInput={(event) => props.onBody(event.currentTarget.value)}
        value={props.draft.body}
      />
      <Text size="caption" tone="faint">
        Never include passwords, sign-in cookies, or account identifiers. Reports are stored as
        plain text and read back only by this account.
      </Text>
      <Inline gap="sm">
        <Button pending={props.submitting} pendingLabel="Sending…" type="submit">
          Send feedback
        </Button>
      </Inline>
    </Form>
  );
}

type FeedbackFormProps = {
  readonly draft: FeedbackDraft;
  readonly errors: FeedbackDraftErrors;
  readonly submitting: boolean;
  readonly onKind: (kind: string) => void;
  readonly onTitle: (title: string) => void;
  readonly onBody: (body: string) => void;
  readonly onSubmit: () => void;
};
