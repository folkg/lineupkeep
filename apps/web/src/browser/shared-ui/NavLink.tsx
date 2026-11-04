import type { JSX } from "@solidjs/web";
import { createLink } from "@tanstack/solid-router";
import { omit } from "solid-js";

import { cx } from "./cx";

export const NavLink = createLink(NavAnchor);

function NavAnchor(props: NavAnchorProps): JSX.Element {
  const rest = omit(props, "class", "children");
  return (
    <a {...rest} class={cx(navLinkClass, props.class)}>
      {props.children}
    </a>
  );
}

const navLinkClass =
  "relative inline-flex min-h-tap-target items-center text-control leading-none font-semibold uppercase tracking-label text-ink-soft transition-[color] duration-quick ease-out-cubic after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-transparent after:content-[''] hover:text-ink focus-visible:outline-none focus-visible:shadow-focus data-[status=active]:text-ink data-[status=active]:after:bg-rule-strong data-[status=active]:hover:text-ink";

type NavAnchorProps = Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "class"> & {
  readonly class?: string;
};
