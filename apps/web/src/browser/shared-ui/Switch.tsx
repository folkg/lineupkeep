import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

import { WorkMark } from "./ActionMarks";
import type { ActionState } from "./actionState";
import { cx } from "./cx";

export function Switch(props: SwitchProps): JSX.Element {
  const state = (): ActionState => props.state ?? "idle";
  const working = (): boolean => state() === "working";
  const blocked = (): boolean => working() || props.disabled === true;

  const handleClick = (): void => {
    if (blocked()) {
      return;
    }
    props.onToggle();
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked ? "true" : "false"}
      aria-busy={working() ? "true" : undefined}
      aria-disabled={props.disabled === true ? "true" : undefined}
      aria-label={props.name}
      class="group inline-flex min-h-tap-target items-center gap-2.5 text-control leading-none font-semibold uppercase tracking-label text-ink focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-70"
      data-state={state()}
      disabled={blocked()}
      onClick={handleClick}
    >
      <span class={props.compact === true ? "sr-only" : undefined}>{props.children}</span>
      <span
        aria-hidden="true"
        class={cx(
          "relative inline-flex h-[1.375rem] w-[2.5rem] shrink-0 items-center overflow-hidden p-[3px] transition-colors duration-quick ease-out-cubic",
          props.checked ? "bg-action" : "bg-rule",
        )}
      >
        <span
          class={cx(
            "size-4 transition-transform duration-quick ease-out-cubic",
            props.checked ? "translate-x-[1.125rem] bg-on-action" : "translate-x-0 bg-paper",
          )}
        />
        <Show when={working()}>
          <WorkMark
            class={cx(
              "inset-x-0 bottom-0 w-[34%]",
              props.checked ? "bg-on-action" : "bg-rule-strong",
            )}
          />
        </Show>
      </span>
    </button>
  );
}

type SwitchProps = {
  readonly checked: boolean;
  readonly compact?: boolean;
  readonly disabled?: boolean;
  readonly name: string;
  readonly onToggle: () => void;
  readonly state?: ActionState;
  readonly children: Element;
};
