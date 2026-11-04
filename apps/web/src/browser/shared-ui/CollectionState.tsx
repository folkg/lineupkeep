import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function EmptyState(props: EmptyStateProps): JSX.Element {
  return (
    <div class={stateClass}>
      <strong class="font-semibold text-body text-ink">{props.title}</strong>
      <span>{props.children}</span>
    </div>
  );
}

export function LoadingState(props: LoadingStateProps): JSX.Element {
  return (
    <div aria-label={props.label} role="status" class={stateClass}>
      <span class="h-2 w-[120px] animate-pulse bg-rule" />
      <span>{props.children}</span>
    </div>
  );
}

const stateClass =
  "grid min-h-[96px] content-center justify-items-start gap-1.5 border-t border-rule py-5 text-body text-ink-soft";

type EmptyStateProps = {
  readonly title: string;
  readonly children: Element;
};

type LoadingStateProps = {
  readonly label: string;
  readonly children: Element;
};
