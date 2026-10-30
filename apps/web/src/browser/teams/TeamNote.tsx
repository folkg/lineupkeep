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
      <Text size="caption" tone="muted">
        Keeper rules, dynasty cost, salary, or why a player is held. Only this account sees it, and
        it is not sent to the provider.
      </Text>
      <Form gap="md" onSubmit={props.note.submit}>
        <TextArea
          description={`Up to ${String(props.note.limit())} characters.`}
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
      <Text size="caption" tone="faint">
        Do not store passwords, tokens, or sign-in cookies here. Lineupkeep refuses a note that
        looks like one.
      </Text>
      <ActionFeedback feedback={props.note.feedback()} />
    </Stack>
  );
}
