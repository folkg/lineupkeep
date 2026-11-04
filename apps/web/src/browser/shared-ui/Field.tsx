import type { JSX } from "@solidjs/web";
import { Show, createUniqueId, untrack } from "solid-js";
import type { Accessor } from "solid-js";

import { cx } from "./cx";

export function Field(props: FieldProps): JSX.Element {
  const id = createUniqueId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  const describedBy = (): string | undefined => {
    const ids = [
      props.description !== undefined && descriptionId,
      props.error !== undefined && errorId,
    ]
      .filter((value) => typeof value === "string")
      .join(" ");
    return ids.length > 0 ? ids : undefined;
  };

  const control = untrack(() => props.children(id, describedBy));
  const messages = (): JSX.Element => (
    <FieldMessages
      description={props.description}
      descriptionId={props.description !== undefined ? descriptionId : undefined}
      error={props.error}
      errorId={props.error !== undefined ? errorId : undefined}
    />
  );

  return (
    <Show
      fallback={
        <>
          {control}
          {messages()}
        </>
      }
      when={props.label !== undefined}
    >
      <div class="grid gap-2 text-label text-ink">
        <label class="font-semibold uppercase tracking-label" for={id}>
          {props.label}
        </label>
        {control}
      </div>
      {messages()}
    </Show>
  );
}

export function fieldControlClass(options: FieldControlOptions = {}): string {
  const border = options.invalid === true ? "border-danger" : "border-rule-strong";

  const interaction =
    options.invalid === true
      ? "hover:border-danger focus:border-danger"
      : "hover:border-action focus:border-action";

  return cx(
    "w-full select-text border bg-paper px-3 text-body text-ink transition-[border-color,box-shadow] duration-quick ease-out-cubic placeholder:text-ink-faint focus:outline-none focus-visible:shadow-focus",
    border,
    interaction,
  );
}

function FieldMessages(props: FieldMessageProps): JSX.Element {
  return (
    <>
      <Show when={props.description !== undefined}>
        <span id={props.descriptionId} class="text-caption font-normal text-ink-faint">
          {props.description}
        </span>
      </Show>
      <Show when={props.error !== undefined}>
        <span id={props.errorId} role="alert" class="text-feedback font-normal text-danger">
          {props.error}
        </span>
      </Show>
    </>
  );
}

type FieldControlOptions = {
  readonly invalid?: boolean;
};

type FieldProps = {
  readonly children: (id: string, describedBy: Accessor<string | undefined>) => JSX.Element;
  readonly description?: string;
  readonly error?: string;
  readonly label?: string;
};

type FieldMessageProps = {
  readonly description?: string;
  readonly descriptionId?: string;
  readonly error?: string;
  readonly errorId?: string;
};
