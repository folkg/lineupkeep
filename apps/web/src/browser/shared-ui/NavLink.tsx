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
  "inline-flex min-h-tap-target items-center rounded-control px-3.5 text-control font-semibold text-ink-soft transition-[color,background-color] duration-quick ease-out-cubic hover:bg-paper hover:text-ink focus-visible:outline-none focus-visible:shadow-focus data-[status=active]:bg-ink data-[status=active]:text-paper data-[status=active]:hover:bg-ink data-[status=active]:hover:text-paper max-sm:px-2.5";

type NavAnchorProps = Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "class"> & {
  readonly class?: string;
};
