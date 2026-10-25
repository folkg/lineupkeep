import type { JSX } from "@solidjs/web";
import { For, Show, omit } from "solid-js";

import { cx } from "./cx";
import { Field, fieldControlClass } from "./Field";
import { useSurface } from "./Surface";

export function SelectField(props: SelectFieldProps): JSX.Element {
  const surface = useSurface();
  const rest = omit(props, "ariaLabel", "description", "error", "label", "options", "placeholder");

  return (
    <Field description={props.description} error={props.error} label={props.label}>
      {(id, describedBy) => (
        <select
          {...rest}
          id={id}
          aria-describedby={describedBy()}
          aria-invalid={props.error !== undefined ? "true" : undefined}
          aria-label={props.ariaLabel}
          class={cx(
            "min-h-field pr-8",
            fieldControlClass({
              invalid: props.error !== undefined,
              surface,
            }),
          )}
        >
          <Show when={props.placeholder}>
            {(placeholder) => <option value="">{placeholder()}</option>}
          </Show>
          <For each={props.options}>
            {(option) => <option value={option.value}>{option.label}</option>}
          </For>
        </select>
      )}
    </Field>
  );
}

type SelectFieldControl = {
  readonly description?: string;
  readonly error?: string;
  readonly placeholder?: string;
  readonly options: ReadonlyArray<SelectOption>;
} & Omit<
  JSX.SelectHTMLAttributes<HTMLSelectElement>,
  "aria-describedby" | "aria-invalid" | "aria-label" | "class" | "id" | "children"
>;

export type SelectFieldProps = SelectFieldControl &
  (
    | { readonly ariaLabel?: undefined; readonly label: string }
    | { readonly ariaLabel: string; readonly label?: undefined }
  );

type SelectOption = {
  readonly value: string;
  readonly label: string;
};
