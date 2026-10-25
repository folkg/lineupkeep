import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { IconButton } from "#browser/shared-ui/IconButton.tsx";
import { MoonIcon, SunIcon } from "#browser/shared-ui/icons.tsx";

import { useTheme } from "./useTheme";

export function ThemeToggle(): JSX.Element {
  const theme = useTheme();
  return (
    <IconButton
      label={theme.isDark() ? "Switch to light theme" : "Switch to dark theme"}
      onClick={theme.toggle}
    >
      <Show fallback={<MoonIcon size="md" />} when={theme.isDark()}>
        <SunIcon size="md" />
      </Show>
    </IconButton>
  );
}
