import type { JSX } from "@solidjs/web";
import { createLink } from "@tanstack/solid-router";
import { Show, omit } from "solid-js";

import { ConfirmedMark, WorkMark } from "./ActionMarks";
import type { ActionState } from "./actionState";
import { buttonClass } from "./Button";
import type { ButtonOptions } from "./Button";
import { cx } from "./cx";

export const ButtonLink = createLink(ButtonAnchor);

function ButtonAnchor(props: ButtonAnchorProps): JSX.Element {
  const rest = omit(
    props,
    "variant",
    "tone",
    "class",
    "children",
    "actionState",
    "confirmed",
    "onClick",
  );
  const state = (): ActionState => props.actionState ?? "idle";
  const working = (): boolean => state() === "working";

  const handleClick: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    if (working()) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const handler = props.onClick;
    if (typeof handler === "function") {
      handler(event);
    } else if (handler !== undefined) {
      handler[0](handler[1], event);
    }
  };

  return (
    <a
      {...rest}
      href={props.href}
      class={cx(
        buttonClass(props),
        props.confirmed === true && "ps-9 pe-9",
        working() && "pointer-events-none",
        props.class,
      )}
      data-state={state()}
      aria-busy={working() ? "true" : undefined}
      aria-disabled={working() ? "true" : undefined}
      onClick={handleClick}
    >
      {props.children}
      <Show when={working()}>
        <WorkMark class="inset-x-0 bottom-0 w-[34%]" />
      </Show>
      <Show when={state() === "done" && props.confirmed === true}>
        <ConfirmedMark class="start-3 top-1/2 -translate-y-1/2" />
      </Show>
    </a>
  );
}

type ButtonAnchorProps = ButtonOptions &
  Omit<JSX.AnchorHTMLAttributes<HTMLAnchorElement>, "class"> & {
    readonly class?: string;
    readonly actionState?: ActionState;
    readonly confirmed?: boolean;
  };
