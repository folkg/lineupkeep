import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { Heading } from "./Heading";

export function SectionTitle(props: SectionTitleProps): JSX.Element {
  return (
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule pb-2">
      <Heading
        id={props.id}
        level={props.level ?? 2}
        size="section"
        focusable={props.focusable === true}
      >
        {props.children}
      </Heading>
      {props.action}
    </div>
  );
}

type SectionTitleProps = {
  readonly id?: string;
  readonly level?: 2 | 3;
  readonly focusable?: boolean;
  readonly action?: Element;
  readonly children: Element;
};
