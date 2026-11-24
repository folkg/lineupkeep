import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

import { Heading } from "./Heading";
import { Inline } from "./Inline";
import { Text } from "./Text";
import { typeClass } from "./type";

export function Page(props: PageProps): JSX.Element {
  const variant = (): TitleVariant => props.titleVariant ?? "page";
  return (
    <section class="w-full pt-8 pb-[max(48px,env(safe-area-inset-bottom))] max-sm:pt-6">
      <Show when={props.back}>{(back) => <div class="mb-4">{back()}</div>}</Show>
      <header class="mb-6 grid max-w-[42.5rem] gap-3">
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
        <Show when={props.kicker}>
          {(kicker) => <div class={`${typeClass.meta} text-ink-muted`}>{kicker()}</div>}
        </Show>
        <Show when={props.lede}>
          {(lede) => (
            <Text type="body" tone="muted">
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
    <Heading
      level={1}
      type={
        props.variant === "name"
          ? "name-title"
          : props.variant === "display"
            ? "display"
            : "page-title"
      }
    >
      {props.children}
    </Heading>
  );
}

type TitleVariant = "page" | "name" | "display";

type PageProps = {
  readonly back?: Element;
  readonly kicker?: Element;
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
