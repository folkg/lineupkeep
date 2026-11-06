import { createEffect, createSignal, onSettled } from "solid-js";
import type { Accessor } from "solid-js";

const minuteMillis = 60_000;

export function createMinuteClock(refreshed: Accessor<unknown>): MinuteClock {
  const [now, setNow] = createSignal(new Date());
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (): void => {
    clearTimeout(timer);
    timer = setTimeout(read, millisUntilNextMinute(new Date()));
  };
  const read = (): void => {
    setNow(new Date());
    schedule();
  };
  const onVisibilityChange = (): void => {
    if (!document.hidden) {
      read();
    }
  };

  onSettled(() => {
    schedule();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  });
  createEffect(
    () => refreshed(),
    () => read(),
    { defer: true },
  );

  return { now };
}

function millisUntilNextMinute(at: Date): number {
  return minuteMillis - (at.getTime() % minuteMillis);
}

export type MinuteClock = {
  readonly now: Accessor<Date>;
};
