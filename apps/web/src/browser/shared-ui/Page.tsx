import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

import { Heading } from "./Heading";
import { Text } from "./Text";

export function Page(props: PageProps): JSX.Element {
  return (
    <section class="w-full pt-[clamp(32px,4vw,48px)] pb-[max(48px,env(safe-area-inset-bottom))] max-sm:pt-8">
      <Show when={props.back}>{(back) => <div class="mb-6">{back()}</div>}</Show>
      <header class="mb-8 grid max-w-[42.5rem] gap-2">
        <Heading level={1} size="headline">
          {props.title}
        </Heading>
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

type PageProps = {
  readonly back?: Element;
  readonly title: string;
  readonly lede?: string;
  readonly children: Element;
};
