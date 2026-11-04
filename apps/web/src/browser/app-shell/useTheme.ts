import { createContext, createSignal, onCleanup, onSettled, useContext } from "solid-js";
import type { Accessor } from "solid-js";

import { applyTheme, readStoredTheme, storeTheme } from "./theme";
import type { ThemePreference } from "./theme";

export const ThemeContext = createContext<ThemeController>();

export function createThemeController(): ThemeController {
  const stored = typeof window === "undefined" ? "system" : (readStoredTheme() ?? "system");
  const [preference, setPreference] = createSignal<ThemePreference>(stored);
  const media =
    typeof window === "undefined" ? undefined : window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = (): void => {
    if (preference() === "system") {
      applyTheme("system");
    }
  };

  onSettled(() => {
    applyTheme(preference());
    media?.addEventListener("change", onSystemChange);
  });
  onCleanup(() => media?.removeEventListener("change", onSystemChange));

  return {
    preference,
    setPreference: (next) => {
      setPreference(next);
      storeTheme(next);
      applyTheme(next);
    },
  };
}

export function useTheme(): ThemeController {
  return useContext(ThemeContext);
}

type ThemeController = {
  readonly preference: Accessor<ThemePreference>;
  readonly setPreference: (preference: ThemePreference) => void;
};
