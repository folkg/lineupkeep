import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function EmptyState(props: EmptyStateProps): JSX.Element {
  return (
    <div class={stateClass}>
      <strong class="text-body-strong text-ink">{props.title}</strong>
      <span>{props.children}</span>
    </div>
  );
}

export function LoadingState(props: LoadingStateProps): JSX.Element {
  return (
    <div aria-label={props.label} role="status" class={stateClass}>
      <span aria-hidden="true" class="relative block h-1 w-[120px] overflow-hidden bg-rule">
        <span class="absolute inset-y-0 w-1/3 animate-loading-slide bg-action" />
      </span>
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
