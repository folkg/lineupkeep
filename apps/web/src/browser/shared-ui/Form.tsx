import type { JSX } from "@solidjs/web";
import { isServer } from "@solidjs/web";
import { createSignal, isHydrating, onSettled } from "solid-js";
import type { Element } from "solid-js";

import { cx } from "./cx";
import { gapClass } from "./space";
import type { Space } from "./space";

export function Form(props: FormProps): JSX.Element {
  const [ready, setReady] = createSignal(!isServer && !isHydrating());
  onSettled(() => {
    setReady(true);
  });

  return (
    <form
      method="dialog"
      novalidate={props.novalidate}
      onSubmit={(event) => {
        event.preventDefault();
        props.onSubmit();
      }}
    >
      <fieldset
        disabled={!ready()}
        class={cx("m-0 grid min-w-0 border-0 p-0", gapClass[props.gap])}
      >
        {props.children}
      </fieldset>
    </form>
  );
}

type FormProps = {
  readonly gap: Space;

  readonly novalidate?: boolean;
  readonly onSubmit: () => void;
  readonly children: Element;
};
