import type { JSX } from "@solidjs/web";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextArea } from "#browser/shared-ui/TextArea.tsx";

import type { TeamNoteController } from "./useTeamNote";

export function TeamNote(props: { readonly note: TeamNoteController }): JSX.Element {
  return (
    <Stack as="section" gap="sm" labelledBy="team-note-title">
      <Heading id="team-note-title" level={2} size="section">
        Owner note
      </Heading>
      <Text size="body" tone="muted">
        Only this account sees this note, and it is not sent to the provider.
      </Text>
      <Form gap="md" onSubmit={props.note.submit}>
        <TextArea
          error={props.note.error()}
          label="Note for this team"
          onInput={(event) => props.note.edit(event.currentTarget.value)}
          rows={5}
          value={props.note.draft()}
        />
        <Inline gap="sm" justify="between">
          <Button pending={props.note.saving()} pendingLabel="Saving…" type="submit">
            Save note
          </Button>
          <Text size="caption" tone="faint">
            {props.note.count()} of {props.note.limit()} characters
          </Text>
        </Inline>
      </Form>
      <ActionFeedback feedback={props.note.feedback()} />
    </Stack>
  );
}
