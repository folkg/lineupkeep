import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Element } from "solid-js";

import { Heading } from "./Heading";
import { Text } from "./Text";

export function Page(props: PageProps): JSX.Element {
  return (
    <section class="w-full max-w-[48rem] pt-[clamp(34px,4vw,52px)] pb-[max(40px,env(safe-area-inset-bottom))] max-sm:pt-9">
      <header class="mb-[clamp(28px,4vw,44px)] grid max-w-[760px] gap-3">
        <Heading level={1} size="headline">
          {props.title}
        </Heading>
        <Show when={props.lede}>
          {(lede) => (
            <Text size="lede" tone="muted">
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
  readonly title: string;
  readonly lede?: string;
  readonly children: Element;
};
