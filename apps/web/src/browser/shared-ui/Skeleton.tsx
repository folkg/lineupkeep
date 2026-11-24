import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { Card } from "./Card";
import { cx } from "./cx";
import { RuleList, RuleListItem } from "./RuleList";
import { SeasonArea } from "./SeasonArea";
import { SectionTitle } from "./SectionTitle";
import { Stack } from "./Stack";

export function Skeleton(props: {
  readonly class?: string;
  readonly width?: string;
  readonly height?: string;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      class={cx(
        "block animate-pulse bg-rule motion-reduce:animate-none",
        props.class,
        props.width,
        props.height,
      )}
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
    </div>
  );
}

export function ListSkeleton(props: {
  readonly count: number;
  readonly label: string;
  readonly fade?: boolean;
}): JSX.Element {
  const rows = (): number => Math.min(props.count, 3);
  return (
    <div
      aria-label={props.label}
      class={props.fade === true ? "relative" : undefined}
      role="status"
    >
      <RuleList busy>
        <For each={Array.from({ length: rows() }, () => undefined)}>
          {() => (
            <RuleListItem dense>
              <Stack gap="2xs">
                <Skeleton height="h-[1.125rem]" width="w-3/4" />
                <Skeleton height="h-3" width="w-1/2" />
                <Skeleton height="h-3" width="w-2/3" />
              </Stack>
            </RuleListItem>
          )}
        </For>
      </RuleList>
      <Show when={props.fade === true && rows() > 0}>
        <div
          aria-hidden="true"
          class="fade-to-canvas pointer-events-none absolute inset-x-0 bottom-0 h-16"
        />
      </Show>
    </div>
  );
}

type SkeletonCard = {
  readonly title?: string;
  readonly meta?: string;
  readonly season?: boolean;
};
