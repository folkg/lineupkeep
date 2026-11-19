import { useRouter } from "@tanstack/solid-router";
import { onCleanup, onSettled } from "solid-js";

let prefetched = false;

export function usePrimaryRoutePrefetch(): void {
  const router = useRouter();
  let cancel = (): void => {};

  onSettled(() => {
    if (prefetched) {
      return;
    }
    prefetched = true;
    const prefetch = (): void => {
      void Promise.allSettled([
        router.preloadRoute({ to: "/teams" }),
        router.preloadRoute({ to: "/transactions" }),
      ]);
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(prefetch, { timeout: 1_000 });
      cancel = () => window.cancelIdleCallback(handle);
      return;
    }
    const handle = window.requestAnimationFrame(prefetch);
    cancel = () => window.cancelAnimationFrame(handle);
  });
  onCleanup(() => cancel());
}
