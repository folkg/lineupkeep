import type { JSX } from "@solidjs/web";
import { Show, action, createOptimistic } from "solid-js";

import { Button } from "./Button";
import { FormMessage } from "./FormMessage";

export function ActionFeedback(props: ActionFeedbackProps): JSX.Element {
  const [pending, setPending] = createOptimistic(false);
  const recover = action(function* (recovery: RecoveryAction) {
    setPending(true);
    try {
      yield recovery.onAction();
    } finally {
      setPending(false);
    }
  });
  const recovery = (): RecoveryAction | undefined =>
    props.feedback === undefined || props.feedback.type === "pending"
      ? undefined
      : props.feedback.recovery;
  return (
    <div>
      <FormMessage tone={props.feedback?.type === "attention" ? "danger" : "neutral"}>
        {props.feedback?.message}
      </FormMessage>
      <Show when={recovery()}>
        {(action) => (
          <Button
            pending={pending()}
            disabled={props.recoveryDisabled}
            pendingLabel={action().pendingLabel}
            variant="link"
            onClick={() => void recover(action())}
          >
            {action().label}
          </Button>
        )}
      </Show>
    </div>
  );
}

type ActionFeedbackProps = {
  readonly recoveryDisabled?: boolean;
  readonly feedback?: ActionFeedbackState;
};

export type ActionFeedbackState =
  | { readonly type: "pending"; readonly message: string }
  | {
      readonly type: "success" | "attention";
      readonly message: string;
      readonly recovery?: RecoveryAction;
    };

export type RecoveryAction = {
  readonly label: string;
  readonly pendingLabel: string;
  readonly onAction: () => void | Promise<void>;
};
