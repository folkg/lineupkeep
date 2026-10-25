import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { Tape } from "./Tape";

export function Entry(props: EntryProps): JSX.Element {
  return (
    <article
      ref={props.ref}
      class="grid select-text gap-4 rounded-surface border border-rule-strong bg-paper p-4.5 transition-[border-color,background-color] duration-quick ease-out-cubic data-[editing=true]:border-ink md:gap-[18px] md:p-surface"
      data-editing={props.editing ? "true" : undefined}
    >
      <div class="flex items-start justify-between gap-[18px] max-md:grid max-md:gap-2.5">
        <Tape size="cue">{props.cue}</Tape>
        <div class="flex flex-wrap justify-end gap-0.5 max-md:justify-start">{props.actions}</div>
      </div>
      {props.children}
      {props.meta}
    </article>
  );
}

type EntryProps = {
  readonly cue: string;
  readonly actions: Element;
  readonly editing: boolean;
  readonly meta: Element;
  readonly ref?: (element: HTMLElement) => void;
  readonly children: Element;
};
