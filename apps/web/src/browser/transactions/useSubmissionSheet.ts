import { createSignal, onSettled } from "solid-js";
import type { Accessor } from "solid-js";

export function useSubmissionSheet(): SubmissionSheetController {
  const [pageIsLong, setPageIsLong] = createSignal(false);

  onSettled(() => {
    const measure = (): void => {
      setPageIsLong(document.documentElement.scrollHeight > window.innerHeight + 200);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  });

  return {
    pageIsLong,
    scrollToPageEnd: () => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: reduced ? "auto" : "smooth",
      });
    },
  };
}

export type SubmissionSheetController = {
  readonly pageIsLong: Accessor<boolean>;
  readonly scrollToPageEnd: () => void;
};
