import type { JSX } from "@solidjs/web";
import { dynamic } from "@solidjs/web";
import type { Element } from "solid-js";

import { cx } from "./cx";
import { typeClass } from "./type";
import type { TextType } from "./type";

export function Text(props: TextProps): JSX.Element {
  const Tag = dynamic(() => props.as ?? "p");
  return (
    <Tag
      id={props.id}
      role={props.role}
      aria-live={props.live}
      class={cx(
        "max-w-[42.5rem] text-pretty",
        typeClass[props.type ?? "body"],
        props.type === "label" && "uppercase",
        toneClass[props.tone ?? "default"],
        props.numeric === true && "tabular-nums",
        props.wrap === "words" && "break-words",
        props.wrap === "preserve" && "break-words whitespace-pre-wrap",
        props.reserve === "two-lines" && "min-h-[2lh]",
        props.srOnly === true && "sr-only",
      )}
    >
      {props.children}
    </Tag>
  );
}

const toneClass: Record<TextTone, string> = {
  default: "",
  muted: "text-ink-soft",
  danger: "text-danger",
  spot: "text-spot",
};

type TextTone = "default" | "muted" | "danger" | "spot";

type TextProps = {
  readonly type?: Extract<TextType, "body" | "body-strong" | "meta" | "label">;
  readonly id?: string;
  readonly role?: "status";
  readonly live?: "polite";
  readonly tone?: TextTone;

  readonly wrap?: "words" | "preserve";
  readonly reserve?: "two-lines";
  readonly srOnly?: boolean;
  readonly as?: "p" | "span";
  readonly numeric?: boolean;
  readonly children: Element;
};
