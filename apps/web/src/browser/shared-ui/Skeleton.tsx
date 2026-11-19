import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

import { Card } from "./Card";
import { cx } from "./cx";

function Skeleton(props: { readonly class?: string }): JSX.Element {
  return (
    <span
      aria-hidden="true"
      class={cx("block animate-pulse bg-rule motion-reduce:animate-none", props.class)}
    />
  );
}

export function CardSkeletonList(props: {
  readonly count?: number;
  readonly cards?: ReadonlyArray<SkeletonCard>;
  readonly label?: string;
}): JSX.Element {
  const cards = (): ReadonlyArray<SkeletonCard> =>
    props.cards ?? Array.from({ length: props.count ?? 3 }, () => ({}));
  return (
    <ol aria-busy="true" aria-label={props.label ?? "Loading teams"} class="grid w-full gap-6">
      <For each={cards()}>{(card) => <CardSkeleton title={card.title} meta={card.meta} />}</For>
    </ol>
  );
}

function CardSkeleton(props: SkeletonCard): JSX.Element {
  return (
    <Card
      as="li"
      badge={<Skeleton class="h-5 w-16" />}
      footer={<Skeleton class="h-8 w-28" />}
      header={
        props.title === undefined ? (
          <Skeleton class="h-5 w-40" />
        ) : (
          <span class="text-card-title text-ink">{props.title}</span>
        )
      }
      meta={
        props.meta === undefined ? (
          <Skeleton class="h-3 w-52" />
        ) : (
          <span class="text-meta text-ink-muted">{props.meta}</span>
        )
      }
    >
      <Skeleton class="h-3 w-full" />
      <Skeleton class="h-3 w-4/5" />
    </Card>
  );
}

export function TransactionsSkeleton(): JSX.Element {
  return (
    <div aria-label="Loading moves" role="status" class="grid gap-8">
      <div class="grid gap-5">
        <Skeleton class="h-6 w-24" />
        <CardSkeletonList count={2} label="Loading moves" />
      </div>
      <div class="grid gap-5">
        <Skeleton class="h-6 w-32" />
        <CardSkeletonList count={1} label="Loading moves" />
      </div>
    </div>
  );
}

type SkeletonCard = {
  readonly title?: string;
  readonly meta?: string;
};
