import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { ThemeContext, createThemeController } from "./useTheme";

export function ThemeProvider(props: { readonly children: Element }): JSX.Element {
  const theme = createThemeController();
  return <ThemeContext value={theme}>{props.children}</ThemeContext>;
}
