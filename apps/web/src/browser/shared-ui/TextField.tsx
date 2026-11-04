import type { JSX } from "@solidjs/web";
import { omit } from "solid-js";

import { cx } from "./cx";
import { Field, fieldControlClass } from "./Field";

export function TextField(props: TextFieldProps): JSX.Element {
  const rest = omit(props, "ariaLabel", "description", "error", "label", "weight");

  return (
    <Field description={props.description} error={props.error} label={props.label}>
      {(id, describedBy) => (
        <input
          {...rest}
          id={id}
          aria-describedby={describedBy()}
          aria-invalid={props.error !== undefined ? "true" : undefined}
          aria-label={props.ariaLabel}
          class={cx(
            "min-h-field",
            props.weight === "strong" ? "font-bold" : "",
            fieldControlClass({
              invalid: props.error !== undefined,
            }),
          )}
        />
      )}
    </Field>
  );
}

type TextFieldControl = {
  readonly description?: string;
  readonly error?: string;
  readonly weight?: "normal" | "strong";
} & Omit<
  JSX.InputHTMLAttributes<HTMLInputElement>,
  "aria-describedby" | "aria-invalid" | "aria-label" | "class" | "id"
>;

export type TextFieldProps = TextFieldControl &
  (
    | { readonly ariaLabel?: undefined; readonly label: string }
    | { readonly ariaLabel: string; readonly label?: undefined }
  );
