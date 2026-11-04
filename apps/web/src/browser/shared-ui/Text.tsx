import type { JSX } from "@solidjs/web";
import { dynamic } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";

export function Text(props: TextProps): JSX.Element {
  const Tag = dynamic(() => props.as ?? "p");
  return (
    <Tag
      id={props.id}
      role={props.role}
      aria-live={props.live}
      class={cx(
        sizeClass[props.size ?? "body"],
        toneClass[props.tone ?? "default"],
        props.weight === "semibold" && "font-semibold",
        props.numeric === true && "tabular-nums",
        props.wrap === "words" && "break-words",
        props.wrap === "preserve" && "break-words whitespace-pre-wrap",
      )}
    >
      {props.children}
    </Tag>
  );
}

const sizeClass = {
  lede: "max-w-[42.5rem] text-pretty text-lede",
  body: "max-w-[42.5rem] text-pretty text-body",
  item: "max-w-[42.5rem] text-pretty text-item",
  caption: "max-w-[42.5rem] text-caption",
};

const toneClass: Record<TextTone, string> = {
  default: "",
  muted: "text-ink-soft",
  faint: "text-ink-faint",
  danger: "text-danger",
};

type TextTone = "default" | "muted" | "faint" | "danger";

type TextProps = {
  readonly size?: keyof typeof sizeClass;
  readonly id?: string;
  readonly role?: "status";
  readonly live?: "polite";
  readonly tone?: TextTone;

  readonly wrap?: "words" | "preserve";
  readonly as?: "p" | "span";
  readonly weight?: "normal" | "semibold";
  readonly numeric?: boolean;
  readonly children: Element;
};
