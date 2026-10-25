import type { JSX } from "@solidjs/web";
import { Show, createEffect, createSignal } from "solid-js";

import { scheduleDelay } from "#browser/timing/delay.ts";

import { ActionFeedback } from "./ActionFeedback";
import type { ActionFeedbackState } from "./ActionFeedback";
import { Field, fieldControlClass } from "./Field";
import { LoaderCircleIcon, XIcon } from "./icons";

const loadingIndicatorDelay = 150;
const searchActionClass =
  "grid h-tap-target w-tap-target place-items-center rounded-control border-0 bg-transparent text-ink-soft transition-colors duration-quick ease-out-cubic hover:bg-action-soft hover:text-ink focus-visible:outline-none focus-visible:shadow-focus";

export function SearchField(props: SearchFieldProps): JSX.Element {
  const [showLoading, setShowLoading] = createSignal(false);
  let input: HTMLInputElement | undefined;

  createEffect(
    () => props.status.type === "loading",
    (isLoading) => {
      if (!isLoading) {
        setShowLoading(false);
        return;
      }

      return scheduleDelay(() => setShowLoading(true), loadingIndicatorDelay);
    },
  );

  const clear = (): void => {
    props.onClear();
    input?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") {
      return;
    }

    event.stopPropagation();
    if (props.value.length === 0) {
      return;
    }

    event.preventDefault();
    props.onClear();
  };

  const feedback = (): ActionFeedbackState | undefined => {
    const status = props.status;
    if (status.type === "error") {
      return {
        type: "attention",
        message: status.message,
        recovery: {
          label: status.recovery?.label ?? "Retry search",
          pendingLabel: status.recovery?.pendingLabel ?? "Retrying search…",
          onAction: status.onRetry,
        },
      };
    }
    if (status.type === "idle" || (status.type === "loading" && !showLoading())) {
      return undefined;
    }
    return { type: status.type === "loading" ? "pending" : "success", message: status.message };
  };

  return (
    <search class="min-w-0">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          props.onSubmit();
        }}
      >
        <Field label={props.label}>
          {(id) => (
            <div class="relative min-w-0">
              <input
                ref={(element) => {
                  input = element;

                  element.addEventListener("keydown", handleKeyDown);
                }}
                id={id}
                disabled={props.disabled}
                aria-label={props.ariaLabel}
                autocomplete="off"
                class={`min-h-field pr-search-trailing ${fieldControlClass()}`}
                inputmode="search"
                name={props.name}
                placeholder={props.placeholder}
                role="searchbox"
                type="text"
                value={props.value}
                onInput={(event) => props.onValueChange(event.currentTarget.value)}
              />
              <div class="absolute inset-y-0 right-0 flex w-search-trailing items-center justify-end">
                <span
                  aria-hidden="true"
                  class="grid h-tap-target w-tap-target shrink-0 place-items-center"
                >
                  <Show when={props.status.type === "loading" && showLoading()}>
                    <LoaderCircleIcon size="md" spin />
                  </Show>
                </span>
                <span class="grid h-tap-target w-tap-target shrink-0 place-items-center">
                  <Show when={props.value.length > 0}>
                    <button
                      disabled={props.disabled}
                      aria-label="Clear search"
                      class={searchActionClass}
                      type="button"
                      onClick={clear}
                    >
                      <XIcon size="md" />
                    </button>
                  </Show>
                </span>
              </div>
            </div>
          )}
        </Field>
      </form>
      <ActionFeedback feedback={feedback()} />
    </search>
  );
}

export type SearchFieldStatus =
  | { readonly type: "idle" }
  | { readonly message: string; readonly type: "loading" }
  | { readonly message: string; readonly type: "message" }
  | {
      readonly message: string;
      readonly onRetry: () => void | Promise<void>;
      readonly recovery?: { readonly label: string; readonly pendingLabel: string };
      readonly type: "error";
    };

type SearchFieldProps = {
  readonly disabled?: boolean;
  readonly name?: string;
  readonly onClear: () => void;

  readonly onSubmit: () => void;
  readonly onValueChange: (value: string) => void;
  readonly placeholder?: string;
  readonly status: SearchFieldStatus;
  readonly value: string;
} & (
  | { readonly ariaLabel?: undefined; readonly label: string }
  | { readonly ariaLabel: string; readonly label?: undefined }
);
