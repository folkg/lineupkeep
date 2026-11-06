import type { JSX } from "@solidjs/web";

export function BrandMark(): JSX.Element {
  return (
    <svg aria-hidden="true" class="size-5 shrink-0 text-on-accent" viewBox="0 0 64 64">
      <rect width="64" height="64" fill="var(--theme-accent)" />
      <path
        d="M14 12v32M14 44h12M34 22v16a6 6 0 0 0 6 6h8V22"
        fill="none"
        stroke="currentColor"
        stroke-width="6"
      />
    </svg>
  );
}
