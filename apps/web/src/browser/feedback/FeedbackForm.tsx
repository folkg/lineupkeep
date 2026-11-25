import { EffectArray } from "@lineupkeep/collections";
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
        description="Choose the closest match."
        error={props.errors.kind}
        label="Kind"
        onChange={(event) => props.onKind(event.currentTarget.value)}
        options={EffectArray.map(feedbackKinds, (kind) => ({
          value: kind,
          label: feedbackKindLabel(kind),
        }))}
        placeholder="Choose a kind"
        value={props.draft.kind}
      />
      <TextField
        autocomplete="off"
        description={`Keep it short, up to ${titleLimit} characters.`}
        error={props.errors.title}
        label="Title"
        onInput={(event) => props.onTitle(event.currentTarget.value)}
        value={props.draft.title}
      />
      <TextArea
        description={`What you did, what happened, and what you expected, up to ${bodyLimit} characters.`}
        error={props.errors.body}
        label="Details"
        onInput={(event) => props.onBody(event.currentTarget.value)}
        value={props.draft.body}
      />
      <Text type="meta" tone="muted">
        Do not include passwords or sign-in details. Reports are stored as plain text, and only this
        account can read them.
      </Text>
      <Inline gap="sm">
        <Button state={props.submitting ? "working" : "idle"} type="submit">
          Send report
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
