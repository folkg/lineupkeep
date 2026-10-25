import type { JSX } from "@solidjs/web";
import { omit } from "solid-js";

import { cx } from "./cx";
import { Field, fieldControlClass } from "./Field";
import { useSurface } from "./Surface";

export function TextArea(props: TextAreaProps): JSX.Element {
  const surface = useSurface();
  const rest = omit(props, "ariaLabel", "description", "error", "label");

  return (
    <Field description={props.description} error={props.error} label={props.label}>
      {(id, describedBy) => (
        <textarea
          {...rest}
          id={id}
          aria-describedby={describedBy()}
          aria-invalid={props.error !== undefined ? "true" : undefined}
          aria-label={props.ariaLabel}
          class={cx(
            "min-h-32 resize-y px-3 py-3",
            fieldControlClass({
              invalid: props.error !== undefined,
              surface,
            }),
          )}
        />
      )}
    </Field>
  );
}

type TextAreaControl = {
  readonly description?: string;
  readonly error?: string;
} & Omit<
  JSX.TextareaHTMLAttributes<HTMLTextAreaElement>,
  "aria-describedby" | "aria-invalid" | "aria-label" | "class" | "id"
>;

export type TextAreaProps = TextAreaControl &
  (
    | { readonly ariaLabel?: undefined; readonly label: string }
    | { readonly ariaLabel: string; readonly label?: undefined }
  );
