import type { JSX } from "@solidjs/web";

import { cx } from "./cx";

export function FormMessage(props: FormMessageProps): JSX.Element {
  return (
    <p
      role="status"
      class={cx(
        "text-feedback",
        props.children === undefined ? "sr-only" : "mt-3 min-h-[18px]",
        props.tone === "danger" ? "text-danger" : "text-ink-soft",
      )}
    >
      {props.children}
    </p>
  );
}

type FormMessageProps = {
  readonly children?: JSX.Element;
  readonly tone?: "danger" | "neutral";
};
