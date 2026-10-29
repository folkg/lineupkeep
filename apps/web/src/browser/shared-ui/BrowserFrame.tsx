import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import type { HostedBrowserKey } from "#contracts/connections/hostedBrowserProtocol.ts";
import { defaultProviderName } from "#contracts/connections/providerLabels.ts";

import { Button } from "./Button";
import { Text } from "./Text";

export function BrowserFrame(props: BrowserFrameProps): JSX.Element {
  let surface: HTMLInputElement | undefined;
  let composing = false;

  const forwardTypedText = (): void => {
    const element = surface;
    if (element === undefined) {
      return;
    }
    const text = element.value;
    if (text === "") {
      return;
    }
    element.value = "";
    props.onText(text);
  };

  const handlePointerDown: JSX.EventHandler<HTMLInputElement, PointerEvent> = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) {
      return;
    }
    const x = Math.min(Math.max((event.clientX - bounds.left) / bounds.width, 0), 1);
    const y = Math.min(Math.max((event.clientY - bounds.top) / bounds.height, 0), 1);
    props.onPointer(x, y);
  };

  const handleKeyDown: JSX.EventHandler<HTMLInputElement, KeyboardEvent> = (event) => {
    if (composing || event.isComposing) {
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    const key = hostedKey(event.key);
    if (key === undefined) {
      return;
    }
    event.preventDefault();
    props.onKey(key);
  };

  const handleBeforeInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (event) => {
    if (composing || event.isComposing) {
      return;
    }
    switch (event.inputType) {
      case "insertText":
        if (event.data !== null && event.data !== "") {
          event.preventDefault();
          props.onText(event.data);
        }
        return;
      case "insertLineBreak":
      case "insertParagraph":
        event.preventDefault();
        props.onKey("Enter");
        return;
      case "deleteContentBackward":
        event.preventDefault();
        props.onKey("Backspace");
        return;
      case "deleteContentForward":
        event.preventDefault();
        props.onKey("Delete");
        return;
      default:
        return;
    }
  };

  const handleInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (event) => {
    if (composing || event.isComposing) {
      return;
    }
    forwardTypedText();
  };

  const handleCompositionStart: JSX.EventHandler<HTMLInputElement, CompositionEvent> = () => {
    composing = true;
  };

  const handleCompositionEnd: JSX.EventHandler<HTMLInputElement, CompositionEvent> = () => {
    composing = false;
    forwardTypedText();
  };

  const handlePaste: JSX.EventHandler<HTMLInputElement, ClipboardEvent> = (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text !== "") {
      props.onText(text);
    }
  };

  const handleWheel: JSX.EventHandler<HTMLInputElement, WheelEvent> = (event) => {
    event.preventDefault();
    props.onScroll(Math.max(Math.min(event.deltaY, 2_000), -2_000));
  };

  return (
    <div class="overflow-hidden rounded-surface border border-rule-strong bg-paper shadow-lift focus-within:shadow-focus">
      <div class="flex items-center gap-2 border-b border-rule px-3.5 py-2.5">
        <span class="size-2.5 shrink-0 rounded-full bg-danger" aria-hidden="true" />
        <span class="size-2.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <span class="size-2.5 shrink-0 rounded-full bg-ink/20" aria-hidden="true" />
        <Text size="caption" tone="muted">
          Private to this session. Closes when you finish or cancel.
        </Text>
        <span class="ml-auto shrink-0">
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
      <div
        class="relative w-full overflow-hidden bg-ink/5"
        style={{ "aspect-ratio": `${props.viewport.width} / ${props.viewport.height}` }}
      >
        <Show when={props.frameUrl}>
          {(frame) => (
            <img
              alt={`${defaultProviderName()} sign-in page`}
              class="pointer-events-none absolute inset-0 h-full w-full select-none object-contain"
              draggable={false}
              src={frame()}
            />
          )}
        </Show>
        <Show when={props.frameUrl === undefined}>
          <span class="pointer-events-none absolute inset-0 grid place-items-center">
            <Text size="caption" tone="muted">
              {props.statusLabel}
            </Text>
          </span>
        </Show>
        <input
          ref={(element) => {
            surface = element;
            element.focus({ preventScroll: true });
          }}
          type="text"
          aria-label={`${defaultProviderName()} sign-in browser`}
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck={false}
          class="absolute inset-0 h-full w-full cursor-text touch-auto appearance-none border-0 bg-transparent p-0 text-base text-transparent caret-transparent outline-none"
          onBeforeInput={handleBeforeInput}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onPointerDown={handlePointerDown}
          onWheel={handleWheel}
        />
      </div>
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
  readonly viewport: { readonly width: number; readonly height: number };
  readonly onCancel: () => void;
  readonly onPointer: (x: number, y: number) => void;
  readonly onText: (text: string) => void;
  readonly onKey: (key: HostedBrowserKey) => void;
  readonly onScroll: (deltaY: number) => void;
};
