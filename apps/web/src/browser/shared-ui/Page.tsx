import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

import { Heading } from "./Heading";
import { Inline } from "./Inline";
import { Text } from "./Text";

export function Page(props: PageProps): JSX.Element {
  const variant = (): TitleVariant => props.titleVariant ?? "page";
  return (
    <section class="relative w-full pt-[clamp(32px,4vw,48px)] pb-[max(48px,env(safe-area-inset-bottom))] max-sm:pt-8">
      <div
        aria-hidden="true"
        data-print="halftone"
        class="pointer-events-none absolute end-0 top-4 hidden h-28 w-56 md:block motion-reduce:hidden"
      />
      <Show when={props.back}>{(back) => <div class="relative mb-6">{back()}</div>}</Show>
      <header class="relative mb-8 grid max-w-[42.5rem] gap-3">
        <Show
          when={props.titleAside}
          fallback={<PageTitle variant={variant()}>{props.title}</PageTitle>}
        >
          {(aside) => (
            <Inline gap="sm" align="baseline" nowrap>
              <PageTitle variant={variant()}>{props.title}</PageTitle>
              {aside()}
            </Inline>
          )}
        </Show>
        <Show when={props.lede}>
          {(lede) => (
            <Text size="body" tone="muted">
              {lede()}
            </Text>
          )}
        </Show>
      </header>
      {props.children}
    </section>
  );
}

function PageTitle(props: PageTitleProps): JSX.Element {
  return (
    <Heading level={1} size={props.variant === "name" ? "name" : "page"}>
      {props.children}
    </Heading>
  );
}

type TitleVariant = "page" | "name";

type PageProps = {
  readonly back?: Element;
  readonly title: string;
  readonly titleAside?: Element;
  readonly titleVariant?: TitleVariant;
  readonly lede?: string;
  readonly children: Element;
};

type PageTitleProps = {
  readonly variant: TitleVariant;
  readonly children: string;
};
