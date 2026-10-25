import { createSignal, onSettled } from "solid-js";

import { applyTheme, readStoredTheme, storeTheme, systemTheme } from "./theme";
import type { ThemePreference } from "./theme";

export function useTheme(): {
  isDark: () => boolean;
  toggle: () => void;
} {
  const [theme, setTheme] = createSignal<ThemePreference>("light");

  onSettled(() => {
    setTheme(readStoredTheme() ?? systemTheme());
  });

  return {
    isDark: () => theme() === "dark",
    toggle: () => {
      const next: ThemePreference = theme() === "dark" ? "light" : "dark";
      setTheme(next);
      storeTheme(next);
      applyTheme(next);
    },
  };
}
