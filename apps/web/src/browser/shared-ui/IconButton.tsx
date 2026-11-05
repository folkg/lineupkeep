import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

import { ConfirmedMark, WorkMark } from "./ActionMarks";
import type { ActionState } from "./actionState";
import { iconButtonClass, iconButtonFrameClass } from "./Button";

export function IconButton(props: IconButtonProps): JSX.Element {
  const state = (): ActionState => props.state ?? "idle";
  const working = (): boolean => state() === "working";
  const disabled = (): boolean => !working() && props.disabled === true;
  const handleClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (event) => {
    if (working() || disabled()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    props.onClick();
  };

  return (
    <span class="inline-flex" title={props.title ?? props.label}>
      <button
        aria-busy={working() ? "true" : undefined}
        aria-disabled={disabled() ? "true" : undefined}
        aria-label={props.label}
        class={iconButtonClass}
        data-state={state()}
        disabled={working()}
        title={props.title ?? props.label}
        type="button"
        onClick={handleClick}
      >
        <span aria-hidden="true" class={iconButtonFrameClass} />
        <span class="relative">{props.children}</span>
        <Show when={working()}>
          <span class="pointer-events-none absolute inset-x-2 bottom-[calc(0.5rem+1px)] h-px overflow-hidden">
            <WorkMark class="start-0 top-0 w-[34%]" />
          </span>
        </Show>
        <Show when={state() === "done" && props.confirmed === true}>
          <ConfirmedMark class="inset-0 grid place-items-center" />
        </Show>
      </button>
    </span>
  );
}

type IconButtonProps = {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: Element;
  readonly title?: string;
  readonly state?: ActionState;
  readonly confirmed?: boolean;
  readonly disabled?: boolean;
};
