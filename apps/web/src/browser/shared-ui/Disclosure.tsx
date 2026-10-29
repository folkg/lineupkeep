import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";

export function Disclosure(props: DisclosureProps): JSX.Element {
  return (
    <details class={cx(props.bordered !== false && "border-t border-rule pt-2")}>
      <summary class={disclosureSummaryClass}>{props.summary}</summary>
      <div class="pt-2">{props.children}</div>
    </details>
  );
}

const disclosureSummaryClass = cx(
  "cursor-pointer text-control font-semibold text-ink-soft",
  "underline decoration-1 underline-offset-4",
  "focus-visible:outline-none focus-visible:shadow-focus",
);

type DisclosureProps = {
  readonly summary: string;
  readonly bordered?: boolean;
  readonly children: Element;
};
