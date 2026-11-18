import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { Heading } from "./Heading";

export function SectionTitle(props: SectionTitleProps): JSX.Element {
  return (
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b-section pb-3">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Heading
          id={props.id}
          level={props.level ?? 2}
          type="section-title"
          focusable={props.focusable === true}
        >
          {props.children}
        </Heading>
        {props.aside}
      </div>
      {props.action}
    </div>
  );
}

type SectionTitleProps = {
  readonly id?: string;
  readonly level?: 2 | 3;
  readonly focusable?: boolean;
  readonly aside?: Element;
  readonly action?: Element;
  readonly children: Element;
};
