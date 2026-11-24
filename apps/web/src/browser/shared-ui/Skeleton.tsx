import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { Card, CardNote } from "./Card";
import { cx } from "./cx";
import { Inline } from "./Inline";
import { RuleList, RuleListItem } from "./RuleList";
import { SectionTitle } from "./SectionTitle";
import { Stack } from "./Stack";
import { typeClass } from "./type";
import type { TextType } from "./type";

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

export function TextSkeleton(props: {
  readonly type: Extract<
    TextType,
    "card-title" | "section-title" | "body" | "body-strong" | "meta" | "label"
  >;
  readonly width?: string;
  readonly hideWide?: boolean;
}): JSX.Element {
  return (
    <span
      aria-hidden="true"
      class={cx(
        "relative",
        props.hideWide === true ? "max-[559px]:block min-[560px]:hidden" : "block",
        typeClass[props.type],
      )}
    >
      <span class="invisible whitespace-nowrap">Aa</span>
      <span
        class={cx(
          "absolute left-0 top-1/2 h-[0.62em] -translate-y-1/2 animate-pulse bg-rule motion-reduce:animate-none",
          props.width ?? "w-24",
        )}
      />
    </span>
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
      badge={<Skeleton class="h-6 w-24" />}
      footer={<Skeleton class="h-11 w-28" />}
      header={
        props.title === undefined ? (
          <TextSkeleton type="card-title" width="w-40" />
        ) : (
          <span class="text-card-title text-ink">{props.title}</span>
        )
      }
      meta={
        props.meta === undefined ? (
          <TextSkeleton type="meta" width="w-52" />
        ) : (
          <span class="text-meta text-ink-muted">{props.meta}</span>
        )
      }
    >
      <Show
        fallback={
          <Stack gap="xs">
            <TextSkeleton type="body-strong" width="w-3/4" />
            <TextSkeleton type="meta" width="w-4/5" />
            <TextSkeleton type="meta" width="w-3/5" />
          </Stack>
        }
        when={props.season === true}
      >
        <Stack gap="sm">
          <Stack gap="2xs">
            <TextSkeleton type="meta" width="w-16" />
            <TextSkeleton type="body-strong" width="w-24" />
            <TextSkeleton type="meta" width="w-40" />
            <TextSkeleton type="meta" width="w-32" />
            <TextSkeleton type="meta" width="w-40" />
          </Stack>
          <CardNote>
            <Stack gap="2xs">
              <TextSkeleton type="meta" width="w-32" />
              <TextSkeleton type="body-strong" width="w-28" />
              <TextSkeleton type="meta" width="w-36" />
              <TextSkeleton type="meta" width="w-48" />
              <TextSkeleton type="meta" width="w-32" />
            </Stack>
          </CardNote>
          <CardNote>
            <Stack gap="xs">
              <Inline gap="lg" justify="between">
                <Stack gap="2xs">
                  <TextSkeleton type="meta" width="w-16" />
                  <TextSkeleton type="body-strong" width="w-20" />
                  <TextSkeleton type="meta" width="w-24" />
                </Stack>
                <Stack gap="2xs">
                  <TextSkeleton type="meta" width="w-16" />
                  <TextSkeleton type="body-strong" width="w-20" />
                  <TextSkeleton type="meta" width="w-24" />
                </Stack>
              </Inline>
            </Stack>
          </CardNote>
        </Stack>
      </Show>
    </Card>
  );
}

export function TransactionsSkeleton(): JSX.Element {
  return (
    <div aria-label="Loading moves" role="status" class="grid gap-8">
      <section class="grid gap-4">
        <SectionTitle action={<Skeleton class="h-3 w-28" />}>Today</SectionTitle>
        <div class="grid content-center justify-items-start gap-1.5 border-t border-rule py-5">
          <TextSkeleton type="meta" width="w-40" />
          <TextSkeleton type="meta" width="w-64 max-w-full" />
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
                <TextSkeleton type="body-strong" width="w-3/4" />
                <TextSkeleton type="meta" width="w-1/2" />
                <TextSkeleton type="meta" width="w-2/3" />
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
