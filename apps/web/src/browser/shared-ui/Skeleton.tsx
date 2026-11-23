import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { Card } from "./Card";
import { cx } from "./cx";
import { SeasonArea } from "./SeasonArea";
import { SectionTitle } from "./SectionTitle";
import { Stack } from "./Stack";

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
  readonly season?: boolean;
}): JSX.Element {
  const cards = (): ReadonlyArray<SkeletonCard> =>
    props.cards ?? Array.from({ length: props.count ?? 3 }, () => ({}));
  return (
    <ol aria-busy="true" aria-label={props.label ?? "Loading teams"} class="grid w-full gap-6">
      <For each={cards()}>
        {(card) => <CardSkeleton title={card.title} meta={card.meta} season={props.season} />}
      </For>
    </ol>
  );
}

function CardSkeleton(props: SkeletonCard): JSX.Element {
  return (
    <Card
      as="li"
      footer={<Skeleton class="h-11 w-28" />}
      header={
        props.title === undefined ? (
          <Skeleton class="h-[21.75px] w-40" />
        ) : (
          <span class="text-card-title text-ink">{props.title}</span>
        )
      }
      meta={
        props.meta === undefined ? (
          <Skeleton class="h-[1.125rem] w-52" />
        ) : (
          <span class="text-meta text-ink-muted">{props.meta}</span>
        )
      }
    >
      <Stack gap="xs">
        <Show when={props.season === true}>
          <SeasonArea loading />
        </Show>
        <Skeleton class="h-[3.125rem] w-full" />
        <Skeleton class="h-[1.125rem] w-4/5" />
        <Skeleton class="h-[1.125rem] w-3/5" />
      </Stack>
    </Card>
  );
}

export function TransactionsSkeleton(): JSX.Element {
  return (
    <div aria-label="Loading moves" role="status" class="grid gap-8">
      <section class="grid gap-4">
        <SectionTitle action={<Skeleton class="h-3 w-28" />}>Today</SectionTitle>
        <div class="grid min-h-[96px] content-center justify-items-start gap-1.5 border-t border-rule py-5">
          <Skeleton class="h-[1.125rem] w-40" />
          <Skeleton class="h-3 w-64 max-w-full" />
        </div>
      </section>
      <section class="grid gap-4">
        <SectionTitle action={<Skeleton class="h-6 w-8" />}>Earlier</SectionTitle>
        <Skeleton class="h-3 w-16" />
      </section>
    </div>
  );
}

export function SummaryLoadingRows(props: { readonly count: number }): JSX.Element {
  return (
    <div aria-hidden="true" class="grid gap-1">
      <For each={Array.from({ length: props.count })}>
        {() => <Skeleton class="h-5 w-2/3 max-w-full" />}
      </For>
    </div>
  );
}

export function OverviewLoadingRows(props: {
  readonly count: number;
  readonly paired?: boolean;
}): JSX.Element {
  return (
    <div
      aria-hidden="true"
      class={cx(
        "grid gap-y-1 pt-3",
        props.paired === true ? "grid-cols-2 gap-x-4" : "gap-x-8 sm:grid-cols-2",
      )}
    >
      <For each={Array.from({ length: props.count })}>
        {() => (
          <div class="grid min-w-0 gap-1 py-[3.5px]">
            <Skeleton class="h-3 w-20 max-w-full" />
            <Skeleton class="h-5 w-28 max-w-full" />
          </div>
        )}
      </For>
    </div>
  );
}

type SkeletonCard = {
  readonly title?: string;
  readonly meta?: string;
  readonly season?: boolean;
};
