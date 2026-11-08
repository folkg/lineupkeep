import { createEffect, createSignal } from "solid-js";
import type { Accessor } from "solid-js";

export function createSettle(present: Accessor<boolean>): Accessor<boolean> {
  const [settling, setSettling] = createSignal(false);
  let wasPresent: boolean | undefined;

  createEffect(
    () => present(),
    (now) => {
      if (wasPresent === false && now) {
        setSettling(true);
      }
      wasPresent = now;
    },
  );

  return settling;
}
