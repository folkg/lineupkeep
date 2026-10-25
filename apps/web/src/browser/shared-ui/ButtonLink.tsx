import type { JSX } from "@solidjs/web";
import { createLink } from "@tanstack/solid-router";
import { omit } from "solid-js";

import { buttonClass } from "./Button";
import type { ButtonOptions } from "./Button";
import { cx } from "./cx";

export const ButtonLink = createLink(ButtonAnchor);

function ButtonAnchor(props: ButtonAnchorProps): JSX.Element {
  const rest = omit(props, "variant", "tone", "class", "children");
  return (
    <a {...rest} class={cx(buttonClass(props), props.class)}>
      {props.children}
    </a>
  );
}

type ButtonAnchorProps = ButtonOptions &
  Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "class"> & { readonly class?: string };
