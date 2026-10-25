import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";
import { useSurface } from "./Surface";
import type { Surface } from "./Surface";

export function Text(props: TextProps): JSX.Element {
  const surface = useSurface();
  return (
    <p
      class={cx(
        sizeClass[props.size ?? "body"],
        toneClass[surface][props.tone ?? "default"],
        props.wrap === "preserve" && "break-words whitespace-pre-wrap",
      )}
    >
      {props.children}
    </p>
  );
}

const sizeClass = {
  lede: "max-w-[48ch] text-lede",
  body: "max-w-[68ch] text-supporting",
  caption: "max-w-[56ch] text-caption",
};

const toneClass: Record<Surface, Record<TextTone, string>> = {
  page: { default: "", muted: "text-ink-soft", faint: "text-ink-faint" },
  panel: { default: "", muted: "text-on-panel-soft", faint: "text-on-panel-soft" },
};

type TextTone = "default" | "muted" | "faint";

type TextProps = {
  readonly size?: keyof typeof sizeClass;
  readonly tone?: TextTone;

  readonly wrap?: "preserve";
  readonly children: Element;
};
