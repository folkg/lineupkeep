import { createSignal, onCleanup } from "solid-js";
import type { Accessor } from "solid-js";

export function createCountdown(): Countdown {
  const [remaining, setRemaining] = createSignal(0);
  let timer: ReturnType<typeof setInterval> | undefined;

  const stop = (): void => {
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  const start = (seconds: number): void => {
    stop();
    setRemaining(seconds);
    timer = setInterval(() => {
      setRemaining((value) => {
        const next = Math.max(0, value - 1);
        if (next === 0) {
          stop();
        }
        return next;
      });
    }, 1000);
  };

  onCleanup(stop);

  return { remaining, start };
}

export function formatCountdown(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export type Countdown = {
  readonly remaining: Accessor<number>;
  readonly start: (seconds: number) => void;
};
