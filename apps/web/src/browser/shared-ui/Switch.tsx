import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";

export function Switch(props: SwitchProps): JSX.Element {
  const handleClick = (): void => {
    if (props.busy === true) {
      return;
    }
    props.onToggle();
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked ? "true" : "false"}
      aria-busy={props.busy === true ? "true" : undefined}
      aria-disabled={props.busy === true ? "true" : undefined}
      aria-label={props.name}
      class="inline-flex min-h-tap-target items-center gap-2.5 rounded-control text-control font-semibold text-ink focus-visible:outline-none focus-visible:shadow-focus aria-disabled:cursor-progress"
      onClick={handleClick}
    >
      <span>{props.children}</span>
      <span
        aria-hidden="true"
        class={cx(
          "inline-flex h-[1.375rem] w-[2.5rem] shrink-0 items-center rounded-full transition-colors duration-quick ease-out-cubic",
          props.checked ? "bg-action" : "bg-rule-strong",
          props.busy === true && "animate-pulse",
        )}
      >
        <span
          class={cx(
            "size-4 rounded-full bg-paper transition-transform duration-quick ease-out-cubic",
            props.checked ? "translate-x-[1.3125rem]" : "translate-x-[0.1875rem]",
          )}
        />
      </span>
    </button>
  );
}

type SwitchProps = {
  readonly checked: boolean;
  readonly busy?: boolean;
  readonly name: string;
  readonly onToggle: () => void;
  readonly children: Element;
};
