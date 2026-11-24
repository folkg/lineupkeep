import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";

export function StatusIcon(props: StatusIconProps): JSX.Element {
  return (
    <span
      aria-label={props.label}
      class={cx("inline-flex shrink-0", toneClass[props.tone])}
      role="img"
      title={props.label}
    >
      {props.children}
    </span>
  );
}

const toneClass = {
  action: "text-action",
  danger: "text-danger",
  muted: "text-ink-soft",
} as const;

type StatusIconProps = {
  readonly label: string;
  readonly tone: keyof typeof toneClass;
  readonly children: Element;
};
