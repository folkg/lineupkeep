import type { JSX } from "@solidjs/web";

import { cx } from "./cx";
import { useSurface } from "./Surface";

export function FormMessage(props: FormMessageProps): JSX.Element {
  const surface = useSurface();
  return (
    <p
      role="status"
      class={cx(
        "mt-3.5 min-h-[21px] text-feedback",
        surface === "panel"
          ? props.tone === "neutral"
            ? "text-on-panel-soft"
            : "text-danger-on-panel"
          : props.tone === "neutral"
            ? "text-ink-soft"
            : "text-danger",
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
