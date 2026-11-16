import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

export function QueueList(props: { readonly children: Element }): JSX.Element {
  return <ol>{props.children}</ol>;
}

export function QueueListItem(props: QueueListItemProps): JSX.Element {
  return (
    <li class="border-b border-rule last:border-b-0">
      <div class="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 px-4 py-3">
        <span aria-hidden="true" class="text-caption font-semibold tabular-nums text-action">
          {String(props.number)}
        </span>
        <div class="grid min-w-0 gap-2">
          <div class="grid gap-2 min-[560px]:grid-cols-[minmax(0,1fr)_auto] min-[560px]:items-start">
            <div class="grid gap-0.5">{props.children}</div>
            <Show when={props.actions}>
              {(actions) => (
                <div class="flex flex-wrap items-baseline justify-end gap-2 max-[559px]:justify-start">
                  {actions()}
                </div>
              )}
            </Show>
          </div>
          {props.details}
        </div>
      </div>
    </li>
  );
}

export function QueueListNote(props: { readonly children: Element }): JSX.Element {
  return <li class="border-b border-rule py-3 ps-12 pe-4">{props.children}</li>;
}

type QueueListItemProps = {
  readonly number: number;
  readonly actions?: Element;
  readonly details?: Element;
  readonly children: Element;
};
