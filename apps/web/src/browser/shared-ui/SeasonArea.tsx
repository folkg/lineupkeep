import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";

export function SeasonArea(props: SeasonAreaProps): JSX.Element {
  return (
    <div class={props.height === undefined ? undefined : cx(heightClass[props.height])}>
      {props.children}
    </div>
  );
}

const heightClass = {
  compact: "min-h-[6.5rem]",
  open: "min-h-[9rem]",
  standard: "min-h-[15.5rem]",
  extended: "min-h-[17rem]",
} as const;

export type SeasonAreaHeight = keyof typeof heightClass;

type SeasonAreaProps = {
  readonly height: SeasonAreaHeight | undefined;
  readonly children: Element;
};
