import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

export function QueuePanel(props: QueuePanelProps): JSX.Element {
  return (
    <section
      aria-labelledby={props.labelledBy}
      class="border-2 border-rule-strong bg-paper shadow-panel"
    >
      <header class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b-2 border-rule-strong bg-action-soft px-4 py-3">
        {props.header}
        <Show when={props.badge}>
          {(badge) => <span class="ms-auto max-[559px]:ms-0">{badge()}</span>}
        </Show>
      </header>
      {props.children}
      <Show when={props.action !== undefined || props.note !== undefined}>
        <footer class="flex flex-wrap items-center gap-x-4 gap-y-2 border-t-2 border-rule-strong px-4 py-3 max-[559px]:flex-col max-[559px]:items-stretch">
          <Show when={props.action}>
            {(action) => <div class="max-[559px]:grid">{action()}</div>}
          </Show>
          <Show when={props.note}>
            {(note) => (
              <div class="grid gap-1 max-[559px]:text-center">
                {note()}
                {props.support}
              </div>
            )}
          </Show>
        </footer>
      </Show>
    </section>
  );
}

export function QueuePanelNote(props: { readonly children: Element }): JSX.Element {
  return <div class="border-t border-rule px-4 py-3">{props.children}</div>;
}

export function QueuePanelStatus(props: { readonly children: Element }): JSX.Element {
  return <div class="grid gap-1 border-b border-rule px-4 py-3">{props.children}</div>;
}

type QueuePanelProps = {
  readonly labelledBy: string;
  readonly header: Element;
  readonly badge?: Element;
  readonly action?: Element;
  readonly note?: Element;
  readonly support?: Element;
  readonly children: Element;
};
