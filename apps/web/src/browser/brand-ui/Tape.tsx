import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

export function Tape(props: TapeProps): JSX.Element {
  return (
    <Show
      when={props.size === "glyph"}
      fallback={<span class={sizeClass[props.size]}>{props.children}</span>}
    >
      <span aria-hidden="true" class={sizeClass.glyph}>
        {props.children}
      </span>
    </Show>
  );
}

const sizeClass = {
  caption: "rounded-tape bg-accent px-2 py-1 text-caption font-bold text-on-accent",
  cue: "inline-flex min-h-cue items-center justify-self-start rounded-tape bg-accent px-2.5 text-metadata font-bold text-on-accent",
  glyph:
    "grid size-glyph shrink-0 place-items-center rounded-tape bg-accent font-display text-glyph font-bold text-on-accent",
};

type TapeProps = {
  readonly size: keyof typeof sizeClass;
  readonly children: Element;
};
