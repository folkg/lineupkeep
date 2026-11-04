import * as AlertDialog from "@kobalte/core/alert-dialog";
import type { JSX } from "@solidjs/web";
import { Show, createEffect, createOptimistic, createSignal, merge } from "solid-js";

import { Button, buttonClass } from "./Button";

const dialogContentClass =
  "animate-dialog-in fixed left-1/2 top-1/2 z-50 max-h-[calc(100svh-2rem)] w-[min(calc(100vw-2rem),26rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto border border-rule-strong bg-paper p-6 focus:outline-none";

export function ConfirmDialog(props: ConfirmDialogProps): JSX.Element {
  const [open, setOpen] = createSignal(false);
  const [closing, setClosing] = createOptimistic(false);
  const visibleOpen = (): boolean => (props.open ?? open()) && !closing();
  let dialogElement: HTMLDivElement | undefined;
  let triggerElement: HTMLElement | undefined;

  const close = (): false => setOpen(false);
  const restoreFocus = (): void =>
    queueMicrotask(() => triggerElement?.focus({ preventScroll: true }));

  const confirm = (): void => {
    setClosing(true);
    close();
    props.onConfirm();
    restoreFocus();
  };

  const cancel = (): void => {
    close();
    props.onCancel?.();
    restoreFocus();
  };

  createEffect(
    () => visibleOpen(),
    (isOpen) => {
      if (!isOpen) {
        return;
      }

      if (props.trigger === undefined && document.activeElement instanceof HTMLElement) {
        triggerElement = document.activeElement;
        triggerElement.blur();
      }
      queueMicrotask(() => dialogElement?.focus());

      const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== "Escape") {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        cancel();
      };
      window.addEventListener("keydown", onKeyDown, true);
      return () => window.removeEventListener("keydown", onKeyDown, true);
    },
  );

  const cancelLabel = (): string => props.cancelLabel ?? "Cancel";
  const renderTrigger = (triggerProps: TriggerProps): JSX.Element => {
    const mergedTriggerProps = merge(triggerProps, {
      onClick: (event: MouseEvent & { currentTarget: HTMLButtonElement; target: Element }) => {
        triggerElement = event.currentTarget;
        const triggerClick = triggerProps.onClick;
        if (typeof triggerClick === "function") {
          triggerClick(event);
        } else {
          triggerClick?.[0](triggerClick[1], event);
        }
        event.currentTarget.blur();
      },
    });
    return props.trigger?.(mergedTriggerProps);
  };

  return (
    <AlertDialog.Root
      open={visibleOpen()}
      onOpenChange={(value) => (value ? setOpen(true) : cancel())}
    >
      <Show when={props.trigger !== undefined}>
        <AlertDialog.Trigger as={renderTrigger} />
      </Show>
      <AlertDialog.Portal>
        <AlertDialog.Overlay class="animate-overlay-in fixed inset-0 z-40 bg-scrim" />
        <AlertDialog.Content
          ref={(element) => {
            dialogElement = element;
          }}
          class={dialogContentClass}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const trigger =
              triggerElement ??
              (dialogElement?.id !== undefined && dialogElement.id.length > 0
                ? document.querySelector<HTMLButtonElement>(`[aria-controls="${dialogElement.id}"]`)
                : undefined);
            trigger?.focus({ preventScroll: true });
          }}
        >
          <AlertDialog.Title class="font-display text-subtitle font-semibold text-ink">
            {props.title}
          </AlertDialog.Title>
          <AlertDialog.Description class="mt-2 text-body text-ink-soft">
            {props.description}
          </AlertDialog.Description>
          <div class="mt-6 flex justify-end gap-2">
            {}
            <AlertDialog.CloseButton
              aria-label={cancelLabel()}
              class={buttonClass({ variant: "secondary" })}
              onClick={(event) => {
                event.preventDefault();
                cancel();
              }}
            >
              {cancelLabel()}
            </AlertDialog.CloseButton>
            <Button tone="danger" variant="primary" onClick={confirm}>
              {props.confirmLabel}
            </Button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

type TriggerProps = Omit<
  JSX.ButtonHTMLAttributes<HTMLButtonElement>,
  "class" | "children" | "type"
> & {
  readonly class?: string;
  readonly children?: JSX.Element;
  readonly type?: "button" | "reset" | "submit";
  readonly "aria-controls"?: string;
  readonly "aria-expanded"?: "true" | "false";
  readonly "aria-haspopup"?: "dialog";
  readonly "data-closed"?: string;
  readonly "data-expanded"?: string;
};

export type ConfirmDialogProps = {
  readonly cancelLabel?: string;
  readonly confirmLabel: string;
  readonly description: string;
  readonly onConfirm: () => void;
  readonly title: string;
} & (
  | {
      readonly trigger: (props: TriggerProps) => JSX.Element;
      readonly open?: never;
      readonly onCancel?: never;
    }
  | { readonly open: boolean; readonly onCancel: () => void; readonly trigger?: never }
);
