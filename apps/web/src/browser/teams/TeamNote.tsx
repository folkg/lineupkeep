import type { JSX } from "@solidjs/web";

import { ActionBar } from "#browser/shared-ui/ActionBar.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextArea } from "#browser/shared-ui/TextArea.tsx";

import type { TeamNoteController } from "./useTeamNote";

export function TeamNote(props: { readonly note: TeamNoteController }): JSX.Element {
  return (
    <Stack as="section" gap="sm" labelledBy="team-note-title">
      <SectionTitle id="team-note-title">Owner note</SectionTitle>
      <Text type="body" tone="muted">
        This note is private and never sent to your league.
      </Text>
      <Form gap="md" onSubmit={props.note.submit}>
        <TextArea
          ariaLabel="Note for this team"
          error={props.note.error()}
          onInput={(event) => props.note.edit(event.currentTarget.value)}
          rows={5}
          value={props.note.draft()}
        />
        <Text type="meta" tone="muted">
          {props.note.count()} of {props.note.limit()} characters
        </Text>
        <ActionBar
          primary={
            <Button confirmed state={props.note.saveState()} type="submit">
              Save note
            </Button>
          }
        />
      </Form>
      <Text as="span" role="status" srOnly>
        {props.note.saveState() === "done" ? "Note saved." : ""}
      </Text>
      <ActionFeedback feedback={props.note.feedback()} />
    </Stack>
  );
}
