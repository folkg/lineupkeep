import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

export function ActionBar(props: {
  readonly primary?: Element;
  readonly secondary?: Element;
  readonly tertiary?: Element;
  readonly destructive?: Element;
  readonly disabled?: boolean;
}): JSX.Element {
  return (
    <fieldset
      disabled={props.disabled === true}
      class="m-0 grid w-full grid-flow-col auto-cols-fr items-stretch gap-2 border-0 p-0 max-[559px]:[&_button]:w-full max-[559px]:[&_button]:min-w-0 max-[559px]:[&_button]:px-2 min-[560px]:flex min-[560px]:flex-wrap min-[560px]:items-center min-[560px]:gap-3"
    >
      <Show when={props.destructive}>
        {(destructive) => <div class="max-[559px]:grid min-[560px]:me-auto">{destructive()}</div>}
      </Show>
      <Show when={props.tertiary}>
        {(tertiary) => <div class="max-[559px]:grid">{tertiary()}</div>}
      </Show>
      <Show when={props.secondary}>
        {(secondary) => <div class="max-[559px]:grid">{secondary()}</div>}
      </Show>
      <Show when={props.primary}>
        {(primary) => <div class="max-[559px]:grid">{primary()}</div>}
      </Show>
    </fieldset>
  );
}
