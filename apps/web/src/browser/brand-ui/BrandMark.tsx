import type { JSX } from "@solidjs/web";

export function BrandMark(): JSX.Element {
  return (
    <svg aria-hidden="true" class="size-5 shrink-0 text-on-accent" viewBox="0 0 64 64">
      <rect width="64" height="64" fill="var(--theme-accent)" />
      <path
        d="M21 17v30M33 17v30M46 29 34 39l14 8"
        fill="none"
        stroke="currentColor"
        stroke-linecap="square"
        stroke-linejoin="miter"
        stroke-width="5"
      />
    </svg>
  );
}
