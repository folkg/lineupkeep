import { createEffect, createSignal, onCleanup, untrack } from "solid-js";
import type { Accessor } from "solid-js";

import { scheduleDelay } from "#browser/timing/delay.ts";

export function useMinimumLoading(loading: Accessor<boolean>, minimumMs = 400): Accessor<boolean> {
  const [visible, setVisible] = createSignal(false);
  let startedAt = 0;
  let cancel: (() => void) | undefined;
  const stopPending = (): void => {
    cancel?.();
    cancel = undefined;
  };
  createEffect(
    () => loading(),
    (active) => {
      stopPending();
      if (active) {
        if (!untrack(visible)) {
          startedAt = performance.now();
          setVisible(true);
        }
        return;
      }
      if (!untrack(visible)) {
        return;
      }
      const remaining = minimumMs - (performance.now() - startedAt);
      if (remaining <= 0) {
        setVisible(false);
        return;
      }
      cancel = scheduleDelay(() => {
        cancel = undefined;
        setVisible(false);
      }, remaining);
    },
  );
  onCleanup(stopPending);
  return visible;
}
