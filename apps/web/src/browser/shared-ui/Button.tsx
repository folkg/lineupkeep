import type { JSX } from "@solidjs/web";
import { omit } from "solid-js";

import { cx } from "./cx";

export function Button(props: ButtonProps): JSX.Element {
  const rest = omit(
    props,
    "variant",
    "tone",
    "type",
    "children",
    "disabled",
    "pending",
    "pendingLabel",
    "onClick",
  );

  const handleClick: JSX.EventHandler<HTMLButtonElement, MouseEvent> = (event) => {
    if (event.currentTarget.getAttribute("aria-disabled") === "true") {
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
    <button
      {...rest}
      type={props.type ?? "button"}
      class={buttonClass(props)}
      aria-busy={props.pending === true ? "true" : undefined}
      aria-disabled={props.pending === true || props.disabled === true ? "true" : undefined}
      onClick={handleClick}
    >
      {props.pending === true ? props.pendingLabel : props.children}
    </button>
  );
}

export function buttonClass(options: ButtonOptions = {}): string {
  if (options.variant === "accent" || options.variant === "google") {
    return buttonStyles[`${options.variant}:neutral`];
  }

  return buttonStyles[`${options.variant ?? "primary"}:${options.tone ?? "neutral"}`];
}

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-control border text-control no-underline transition-[color,background-color,border-color,transform] duration-quick ease-out-cubic focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50";

const buttonBorderless = "border-transparent";

const filledShape = "min-h-button px-4.5 font-semibold";

const quietShape = "min-h-tap-target px-2.5 font-semibold";

const linkShape = "min-h-tap-target p-0 font-semibold underline decoration-1 underline-offset-4";

const quietNeutral = "text-ink-soft hover:bg-action-soft hover:text-ink";

export const iconButtonClass = cx(
  buttonBase,
  buttonBorderless,
  "size-tap-target font-semibold",
  quietNeutral,
);

const buttonStyles: Record<ButtonStyleKey, string> = {
  "accent:neutral": cx(
    buttonBase,
    buttonBorderless,
    filledShape,
    "bg-accent text-on-accent hover:bg-accent-hover",
  ),

  "google:neutral": cx(
    "inline-flex min-h-button items-center justify-center gap-2.5 rounded-control border border-google-stroke bg-google-fill px-3 font-google text-google font-medium text-google-ink no-underline transition-transform duration-quick ease-out-cubic focus-visible:outline-none focus-visible:shadow-focus aria-disabled:pointer-events-none aria-disabled:opacity-50",
  ),
  "link:danger": cx(
    buttonBase,
    buttonBorderless,
    linkShape,
    "bg-transparent text-danger hover:bg-transparent hover:text-danger-hover",
  ),
  "link:neutral": cx(
    buttonBase,
    buttonBorderless,
    linkShape,
    "bg-transparent text-action-hover hover:bg-transparent hover:text-action",
  ),
  "primary:danger": cx(
    buttonBase,
    buttonBorderless,
    filledShape,
    "bg-danger text-paper hover:bg-danger-hover",
  ),
  "primary:neutral": cx(
    buttonBase,
    buttonBorderless,
    filledShape,
    "bg-action text-paper hover:bg-action-hover",
  ),
  "quiet:danger": cx(
    buttonBase,
    buttonBorderless,
    quietShape,
    "text-danger hover:bg-danger-soft hover:text-danger-hover",
  ),
  "quiet:neutral": cx(buttonBase, buttonBorderless, quietShape, quietNeutral),
  "secondary:danger": cx(
    buttonBase,
    filledShape,
    "border-danger text-danger hover:bg-danger hover:text-paper",
  ),
  "secondary:neutral": cx(
    buttonBase,
    filledShape,
    "border-ink text-ink hover:bg-ink hover:text-paper",
  ),
};

type ButtonVariant = "primary" | "secondary" | "quiet" | "accent" | "google" | "link";

type ButtonVariantWithTone = Exclude<ButtonVariant, "accent" | "google">;

type ButtonTone = "neutral" | "danger";

type ButtonStyleKey =
  | `${ButtonVariantWithTone}:${ButtonTone}`
  | "accent:neutral"
  | "google:neutral";

export type ButtonOptions =
  | {
      readonly tone?: ButtonTone;
      readonly variant?: ButtonVariantWithTone;
    }
  | {
      readonly tone?: "neutral";

      readonly variant: "accent" | "google";
    };

type ButtonProps = ButtonOptions &
  PendingButtonProps & {
    readonly children?: JSX.Element;
    readonly type?: "button" | "submit" | "reset";
  } & Omit<
    JSX.ButtonHTMLAttributes<HTMLButtonElement>,
    "class" | "children" | "type" | "aria-busy" | "aria-disabled"
  >;

type PendingButtonProps =
  | { readonly pending?: never; readonly pendingLabel?: never }
  | { readonly pending: boolean; readonly pendingLabel: string };
