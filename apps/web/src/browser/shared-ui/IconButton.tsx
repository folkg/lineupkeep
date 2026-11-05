import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { iconButtonClass, iconButtonFrameClass } from "./Button";

export function IconButton(props: IconButtonProps): JSX.Element {
  const blocked = (): boolean => props.busy === true || props.disabled === true;
  const label = (): string =>
    props.busy === true && props.busyLabel !== undefined ? props.busyLabel : props.label;

  const handleClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (event) => {
    if (blocked()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    props.onClick();
  };

  return (
    <span class="inline-flex" title={props.title ?? label()}>
      <button
        aria-label={label()}
        aria-busy={props.busy === true ? "true" : undefined}
        aria-disabled={blocked() ? "true" : undefined}
        class={iconButtonClass}
        title={props.title ?? label()}
        type="button"
        onClick={handleClick}
      >
        <span aria-hidden="true" class={iconButtonFrameClass} />
        <span class="relative">{props.children}</span>
      </button>
    </span>
  );
}

type IconButtonProps = {
  readonly label: string;
  readonly busyLabel?: string;
  readonly onClick: () => void;
  readonly children: Element;
  readonly title?: string;
  readonly busy?: boolean;
  readonly disabled?: boolean;
};
