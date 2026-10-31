import type { JSX } from "@solidjs/web";
import type { Element } from "solid-js";

export function CheckboxField(props: CheckboxFieldProps): JSX.Element {
  return (
    <label class="inline-flex min-h-tap-target items-center gap-2.5 text-control font-semibold text-ink">
      <input
        type="checkbox"
        class="size-4 shrink-0 accent-action focus-visible:outline-none focus-visible:shadow-focus"
        checked={props.checked}
        disabled={props.disabled}
        aria-label={props.ariaLabel}
        aria-describedby={props.describedBy}
        onChange={(event) => props.onChange(event.currentTarget.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

type CheckboxFieldProps = {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly label: Element;
  readonly ariaLabel: string;
  readonly describedBy?: string;
  readonly onChange: (checked: boolean) => void;
};
