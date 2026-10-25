import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { iconButtonClass } from "./Button";

export function IconButton(props: IconButtonProps): JSX.Element {
  return (
    <button
      aria-label={props.label}
      class={iconButtonClass}
      type="button"
      onClick={() => props.onClick()}
    >
      {props.children}
    </button>
  );
}

type IconButtonProps = {
  readonly label: string;
  readonly onClick: () => void;
  readonly children: Element;
};
