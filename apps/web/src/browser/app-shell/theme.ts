export type ThemePreference = "light" | "dark";

const themeStorageKey = "theme-preference";

export const themeBootstrapScript = `(function () {
  var stored;
  try {
    stored = localStorage.getItem("${themeStorageKey}");
  } catch {}
  var dark = stored === "dark" ||
    (stored !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
})();`;

export function applyTheme(theme: ThemePreference): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function readStoredTheme(): ThemePreference | undefined {
  const stored = localStorage.getItem(themeStorageKey);
  return stored === "light" || stored === "dark" ? stored : undefined;
}

export function storeTheme(theme: ThemePreference): void {
  localStorage.setItem(themeStorageKey, theme);
}

export function systemTheme(): ThemePreference {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
