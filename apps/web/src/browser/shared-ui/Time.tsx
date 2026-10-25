import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function Time(props: TimeProps): JSX.Element {
  return (
    <time class="text-metadata font-semibold text-ink-faint" datetime={props.datetime}>
      {props.children}
    </time>
  );
}

type TimeProps = {
  readonly datetime: string;
  readonly children: Element;
};
