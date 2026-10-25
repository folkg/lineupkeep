import type { JSX } from "@solidjs/web";
import { Show, onSettled } from "solid-js";

import { Entry } from "#browser/brand-ui/Entry.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { ConfirmDialog } from "#browser/shared-ui/ConfirmDialog.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { PencilIcon, RotateCcwIcon, Trash2Icon } from "#browser/shared-ui/icons.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextArea } from "#browser/shared-ui/TextArea.tsx";
import { TextField } from "#browser/shared-ui/TextField.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import type { NoteView } from "#contracts/notes/noteContract.ts";

import type { NoteRemote } from "./noteRemote";
import { useNoteCard } from "./useNoteCard";

export function NoteCard(props: NoteCardProps): JSX.Element {
  const card = useNoteCard(props);
  let editButton: HTMLButtonElement | undefined;
  let titleInput: HTMLInputElement | undefined;

  const edit = (): void => {
    card.edit();
    onSettled(() => titleInput?.focus());
  };
  const cancel = (): void => {
    card.cancel();
    onSettled(() => editButton?.focus());
  };

  const save = () =>
    void card.save().then(() =>
      onSettled(() => {
        const focused = document.activeElement;
        if (!card.isEditing() && (focused === null || focused === document.body)) {
          editButton?.focus();
        }
      }),
    );
  const onEditorKeyDown = (event: KeyboardEvent & { currentTarget: HTMLElement }): void => {
    if (event.key === "Escape" && !card.isSaving()) {
      event.preventDefault();
      cancel();
    }
  };

  return (
    <Entry
      actions={
        <Show
          fallback={
            <>
              <Button
                disabled={props.changesDisabled}
                pending={props.pendingChange === "restore"}
                pendingLabel="Restoring…"
                variant="quiet"
                onClick={() => props.onRestore()}
              >
                <RotateCcwIcon size="sm" />
                Restore
              </Button>
              <ConfirmDialog
                confirmLabel="Delete"
                description="This cannot be undone. The note will no longer appear in Trash."
                title={`Delete “${props.note.title}”?`}
                trigger={(triggerProps) => (
                  <Button
                    disabled={props.changesDisabled}
                    pending={props.pendingChange === "delete"}
                    pendingLabel="Deleting…"
                    tone="danger"
                    variant="quiet"
                    {...triggerProps}
                  >
                    <Trash2Icon size="sm" />
                    Delete
                  </Button>
                )}
                onConfirm={() => props.onDeletePermanently()}
              />
            </>
          }
          when={props.note.lifecycle === "active"}
        >
          <Show when={!card.isEditing()}>
            <Button
              ref={(element: HTMLButtonElement) => {
                editButton = element;
              }}
              variant="quiet"
              onClick={edit}
            >
              <PencilIcon size="sm" />
              Edit
            </Button>
            <Button
              disabled={props.changesDisabled}
              tone="danger"
              variant="quiet"
              onClick={() => props.onMoveToTrash()}
            >
              <Trash2Icon size="sm" />
              Move to trash
            </Button>
          </Show>
        </Show>
      }
      cue={`Note ${formatNoteIndex(props.index)}`}
      editing={card.isEditing()}
      meta={
        <Time datetime={props.note.updatedAt}>
          {props.note.lifecycle === "trashed" ? "Moved to trash" : "Updated"}{" "}
          {formatUpdatedAt(props.note.trashedAt ?? props.note.updatedAt)}
        </Time>
      }
    >
      <Show
        fallback={
          <Stack gap="sm">
            <Heading level={3} size="item">
              {props.note.title}
            </Heading>
            <Text tone="muted" wrap="preserve">
              {props.note.body}
            </Text>
          </Stack>
        }
        when={card.isEditing()}
      >
        <Form gap="md" novalidate onSubmit={save}>
          <TextField
            ref={(element: HTMLInputElement) => {
              titleInput = element;
            }}
            ariaLabel="Note title"
            error={card.titleError()}
            value={card.title()}
            weight="strong"
            onInput={(event) => card.changeTitle(event.currentTarget.value)}
            onKeyDown={onEditorKeyDown}
          />
          <TextArea
            ariaLabel="Note body"
            error={card.bodyError()}
            value={card.body()}
            onInput={(event) => card.changeBody(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
                return;
              }
              onEditorKeyDown(event);
            }}
          />
          <Inline gap="sm">
            <Button pending={card.isSaving()} pendingLabel="Saving…" type="submit">
              Save
            </Button>
            <Button disabled={card.isSaving()} variant="secondary" onClick={cancel}>
              Cancel
            </Button>
          </Inline>
        </Form>
      </Show>
      <ActionFeedback feedback={card.feedback()} />
    </Entry>
  );
}

function formatNoteIndex(index: number): string {
  return String(index + 1).padStart(3, "0");
}

function formatUpdatedAt(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

type NoteCardProps = {
  readonly index: number;
  readonly note: NoteView;
  readonly remote: NoteRemote;
  readonly onRefresh: () => Promise<void>;
  readonly onEditingChange: (note: NoteView | undefined) => void;

  readonly pendingChange: "restore" | "delete" | undefined;

  readonly changesDisabled: boolean;
  readonly onMoveToTrash: () => void;
  readonly onRestore: () => void;
  readonly onDeletePermanently: () => void;
};
