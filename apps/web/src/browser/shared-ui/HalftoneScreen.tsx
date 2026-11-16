import type { JSX } from "@solidjs/web";

import { cx } from "./cx";

export function HalftoneScreen(props: HalftoneScreenProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      data-print="halftone"
      class={cx(
        "pointer-events-none hidden md:block motion-reduce:hidden",
        props.variant === "title" ? "absolute end-0 top-4 h-28 w-56" : "h-10 w-48 shrink-0",
      )}
    />
  );
}

type HalftoneScreenProps = {
  readonly variant: "title" | "strip";
};
