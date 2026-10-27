import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import type { HostedBrowserKey } from "#contracts/connections/hostedBrowserProtocol.ts";
import { defaultProviderName } from "#contracts/connections/providerLabels.ts";

import { Button } from "./Button";
import { Text } from "./Text";

export function BrowserFrame(props: BrowserFrameProps): JSX.Element {
  const handlePointerDown: JSX.EventHandler<HTMLButtonElement, PointerEvent> = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return;
    }
    const x = Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 1);
    const y = Math.min(Math.max((event.clientY - bounds.top) / bounds.height, 0), 1);
    props.onPointer(x, y);
  };

  const handleKeyDown: JSX.EventHandler<HTMLButtonElement, KeyboardEvent> = (event) => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      props.onText(event.key);
      return;
    }
    const key = hostedKey(event.key);
    if (key !== undefined) {
      event.preventDefault();
      props.onKey(key);
    }
  };

  const handleWheel: JSX.EventHandler<HTMLButtonElement, WheelEvent> = (event) => {
    event.preventDefault();
    props.onScroll(Math.max(Math.min(event.deltaY, 2_000), -2_000));
  };

  return (
    <div class="overflow-hidden rounded-surface border border-rule-strong bg-paper shadow-lift">
      <div class="flex items-center gap-2 border-b border-rule px-3.5 py-2.5">
        <span class="size-2.5 rounded-full bg-danger" aria-hidden="true" />
        <span class="size-2.5 rounded-full bg-accent" aria-hidden="true" />
        <span class="size-2.5 rounded-full bg-ink/20" aria-hidden="true" />
        <Text size="caption" tone="muted">
          Private browser session
        </Text>
        <span class="ml-auto">
          <Button
            pending={props.ready}
            pendingLabel="Connected"
            variant="link"
            onClick={props.onCancel}
          >
            Cancel
          </Button>
        </span>
      </div>
      <button
        type="button"
        ref={(element) => element.focus()}
        class="relative block aspect-[1100/720] w-full cursor-crosshair touch-none overflow-hidden bg-ink/5 p-0 text-left outline-none focus-visible:shadow-focus"
        aria-label={`${defaultProviderName()} sign-in browser`}
        onClick={(event) => event.preventDefault()}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onWheel={handleWheel}
      >
        <Show
          fallback={
            <span class="grid h-full place-items-center">
              <Text size="caption" tone="muted">
                {props.statusLabel}
              </Text>
            </span>
          }
          when={props.frameUrl}
        >
          {(frame) => (
            <img
              alt={`${defaultProviderName()} sign-in page`}
              class="h-full w-full select-none object-contain"
              draggable={false}
              src={frame()}
            />
          )}
        </Show>
      </button>
    </div>
  );
}

function hostedKey(key: string): HostedBrowserKey | undefined {
  switch (key) {
    case "Enter":
    case "Tab":
    case "Backspace":
    case "Delete":
    case "Escape":
    case "ArrowUp":
    case "ArrowDown":
    case "ArrowLeft":
    case "ArrowRight":
    case "Home":
    case "End":
    case "PageUp":
    case "PageDown":
      return key;
    default:
      return undefined;
  }
}

type BrowserFrameProps = {
  readonly frameUrl: string | undefined;
  readonly statusLabel: string;
  readonly ready: boolean;
  readonly onCancel: () => void;
  readonly onPointer: (x: number, y: number) => void;
  readonly onText: (text: string) => void;
  readonly onKey: (key: HostedBrowserKey) => void;
  readonly onScroll: (deltaY: number) => void;
};
