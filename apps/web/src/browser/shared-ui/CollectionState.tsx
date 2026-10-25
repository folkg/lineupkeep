import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function EmptyState(props: EmptyStateProps): JSX.Element {
  return (
    <div class={stateClass}>
      <strong class="font-display text-section-title font-bold text-ink">{props.title}</strong>
      <span>{props.children}</span>
    </div>
  );
}

export function LoadingState(props: LoadingStateProps): JSX.Element {
  return (
    <div aria-label={props.label} role="status" class={stateClass}>
      <span class="h-2 w-[120px] animate-pulse rounded-tape bg-rule" />
      <span>{props.children}</span>
    </div>
  );
}

const stateClass =
  "grid min-h-[150px] content-center justify-items-start gap-1.5 rounded-surface border border-dashed border-rule-strong p-7 text-supporting text-ink-soft";

type EmptyStateProps = {
  readonly title: string;
  readonly children: Element;
};

type LoadingStateProps = {
  readonly label: string;
  readonly children: Element;
};
