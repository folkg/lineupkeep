import type { JSX } from "@solidjs/web";
import { onSettled } from "solid-js";

import { Panel } from "#browser/brand-ui/Panel.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { PlusIcon } from "#browser/shared-ui/icons.tsx";
import { TextArea } from "#browser/shared-ui/TextArea.tsx";
import { TextField } from "#browser/shared-ui/TextField.tsx";

import type { NoteRemote } from "./noteRemote";
import { useNoteComposer } from "./useNoteComposer";

export function NoteComposer(props: NoteComposerProps): JSX.Element {
  const composer = useNoteComposer(props);
  let titleInput: HTMLInputElement | undefined;
  let bodyInput: HTMLTextAreaElement | undefined;

  const submit = (): void => {
    composer.submit();
    onSettled(() => {
      if (composer.titleError() !== undefined) {
        titleInput?.focus();
      } else if (composer.bodyError() !== undefined) {
        bodyInput?.focus();
      }
    });
  };

  return (
    <Panel description="Write enough to find it again." marker="+" title="Add a note">
      <Form gap="md" novalidate onSubmit={submit}>
        <TextField
          ref={(element: HTMLInputElement) => {
            titleInput = element;
          }}
          error={composer.titleError()}
          label="Title"
          placeholder="Name the thought"
          value={composer.title()}
          weight="strong"
          onInput={(event) => composer.changeTitle(event.currentTarget.value)}
        />
        <TextArea
          ref={(element: HTMLTextAreaElement) => {
            bodyInput = element;
          }}
          description="Press ⌘ or Ctrl + Enter to add."
          error={composer.bodyError()}
          label="Note"
          placeholder="What do you want to remember?"
          value={composer.body()}
          onInput={(event) => composer.changeBody(event.currentTarget.value)}
          onKeyDown={submitOnModifiedEnter}
        />
        <Button
          disabled={composer.isUnconfirmed()}
          pending={composer.isSubmitting()}
          pendingLabel="Adding note…"
          type="submit"
          variant="accent"
        >
          <PlusIcon size="md" />
          Add note
        </Button>
      </Form>
      <ActionFeedback feedback={composer.feedback()} />
    </Panel>
  );
}

function submitOnModifiedEnter(
  event: KeyboardEvent & { currentTarget: HTMLTextAreaElement },
): void {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }
}

type NoteComposerProps = {
  readonly remote: NoteRemote;
  readonly onRefresh: () => Promise<void>;
};
