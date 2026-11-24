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
      class="m-0 flex w-full min-w-0 flex-wrap items-center gap-3 border-0 p-0 max-[559px]:flex-col max-[559px]:items-stretch"
    >
      <div class="order-1 flex flex-wrap items-center gap-3 max-[559px]:w-full max-[559px]:flex-col max-[559px]:items-stretch min-[560px]:order-2 min-[560px]:ms-auto">
        <Show when={props.tertiary}>
          {(tertiary) => <div class="max-[559px]:self-start">{tertiary()}</div>}
        </Show>
        <Show when={props.secondary}>
          {(secondary) => <div class="max-[559px]:self-start">{secondary()}</div>}
        </Show>
        <Show when={props.primary}>
          {(primary) => <div class="max-[559px]:grid max-[559px]:w-full">{primary()}</div>}
        </Show>
      </div>
      <Show when={props.destructive}>
        {(destructive) => (
          <div class="order-2 flex w-full flex-wrap items-center gap-3 max-[559px]:order-2 max-[559px]:grid max-[559px]:w-full min-[560px]:order-1 min-[560px]:w-auto min-[560px]:me-auto">
            {destructive()}
          </div>
        )}
      </Show>
    </fieldset>
  );
}
