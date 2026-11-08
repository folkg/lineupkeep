import type { JSX } from "@solidjs/web";

import { cx } from "./cx";

export function WorkMark(props: { readonly class?: string }): JSX.Element {
  return (
    <span aria-hidden="true" class="pointer-events-none absolute inset-0" data-action-track>
      <span class={cx("absolute h-px bg-current", props.class)} data-action-mark="work" />
    </span>
  );
}

export function ConfirmedMark(props: { readonly class?: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      class={cx("pointer-events-none absolute", props.class)}
      data-action-mark="tick"
    >
      <svg fill="none" height="12" viewBox="0 0 14 14" width="12">
        <path
          d="M2.5 7.4 5.6 10.4 11.4 3.4"
          stroke="currentColor"
          stroke-linecap="square"
          stroke-width="1.7"
        />
      </svg>
    </span>
  );
}
