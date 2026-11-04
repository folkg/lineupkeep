export type ThemePreference = "system" | "light" | "dark";

type ResolvedTheme = "light" | "dark";

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

function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference;
}

export function applyTheme(preference: ThemePreference): void {
  document.documentElement.classList.toggle("dark", resolveTheme(preference) === "dark");
}

export function readStoredTheme(): ThemePreference | undefined {
  const stored = localStorage.getItem(themeStorageKey);
  return stored === "system" || stored === "light" || stored === "dark" ? stored : undefined;
}

export function storeTheme(preference: ThemePreference): void {
  localStorage.setItem(themeStorageKey, preference);
}

function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
