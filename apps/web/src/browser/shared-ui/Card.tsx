import type { JSX } from "@solidjs/web";
import { dynamic } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

const frameClass = "border-2 border-rule-strong bg-paper";
const headerClass =
  "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 border-b-2 border-rule-strong bg-action-soft px-4 py-3";
const bodyClass = "grid gap-3 px-4 py-3";
const footerClass =
  "flex flex-wrap items-center gap-x-4 gap-y-2 border-t-2 border-rule-strong px-4 py-3 max-[559px]:flex-col max-[559px]:items-stretch [&>form]:w-full";

export function Card(props: CardProps): JSX.Element {
  const Tag = dynamic(() => props.as ?? "section");
  return (
    <Tag aria-labelledby={props.labelledBy} class={frameClass} data-card>
      <header class={headerClass} data-card-header>
        <div class="grid min-w-0 gap-1">
          {props.header}
          <Show when={props.meta}>
            {(meta) => (
              <div class="grid gap-1" data-card-meta>
                {meta()}
              </div>
            )}
          </Show>
        </div>
        <Show when={props.badge}>
          {(badge) => (
            <span class="justify-self-end" data-card-badge>
              {badge()}
            </span>
          )}
        </Show>
      </header>
      <div class={bodyClass} data-card-body>
        {props.children}
      </div>
      <Show when={props.footer}>
        {(footer) => (
          <footer class={footerClass} data-card-footer>
            {footer()}
          </footer>
        )}
      </Show>
    </Tag>
  );
}

export function CardNote(props: { readonly children: Element }): JSX.Element {
  return <div class="border-t border-rule pt-3">{props.children}</div>;
}

type CardProps = {
  readonly as?: "section" | "li";
  readonly labelledBy?: string;
  readonly header: Element;
  readonly meta?: Element;
  readonly badge?: Element;
  readonly footer?: Element;
  readonly children: Element;
};
