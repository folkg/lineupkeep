import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

import { Heading } from "./Heading";
import { Text } from "./Text";

export function Page(props: PageProps): JSX.Element {
  return (
    <section class="w-full pt-[clamp(34px,4vw,52px)] pb-[max(40px,env(safe-area-inset-bottom))] max-sm:pt-9">
      <header class="mb-[clamp(28px,4vw,44px)] grid max-w-[760px] gap-3">
        <Heading level={1} size="headline">
          {props.title}
        </Heading>
        <Text size="lede" tone="muted">
          {props.lede}
        </Text>
      </header>
      {props.children}
    </section>
  );
}

type PageProps = {
  readonly title: string;
  readonly lede: string;
  readonly children: Element;
};
