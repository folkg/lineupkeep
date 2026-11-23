import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

export function ActionBar(props: {
  readonly primary?: Element;
  readonly secondary?: Element;
  readonly destructive?: Element;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <fieldset
      disabled={props.disabled === true}
      class="m-0 flex w-full min-w-0 flex-wrap items-center gap-3 border-0 p-0 max-[559px]:flex-col max-[559px]:items-stretch"
    >
      <div class="flex flex-wrap items-center gap-3">
        {props.primary}
        {props.secondary}
      </div>
      <Show when={props.destructive}>
        {(destructive) => (
          <div class="ms-auto flex flex-wrap items-center gap-3">{destructive()}</div>
        )}
      </Show>
    </fieldset>
  );
}
