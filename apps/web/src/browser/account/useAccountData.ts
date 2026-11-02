import { useMutation } from "@tanstack/solid-query";
import { useNavigate } from "@tanstack/solid-router";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import { isErasureConfirmation } from "#contracts/account/accountContract.ts";

import { describeAccountErasureFailure } from "./accountFailure";
import type { AccountDataRemote } from "./accountRemote";

export function useAccountData(options: {
  readonly remote: () => AccountDataRemote;
  readonly onErased: () => Promise<void>;
}): {
  readonly confirmation: Accessor<string>;
  readonly confirmationError: Accessor<string | undefined>;
  readonly erasing: Accessor<boolean>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly setConfirmation: (value: string) => void;
  readonly erase: () => void;
} {
  const [confirmation, setConfirmationValue] = createSignal("");
  const [confirmationError, setConfirmationError] = createSignal<string>();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const signIn = useSignInRecovery();
  const navigate = useNavigate();

  const erase = useMutation(() => ({
    mutationFn: () => options.remote().erase(confirmation()),
    onSuccess: async () => {
      await options
        .remote()
        .signOut()
        .catch(() => undefined);
      await options.onErased();
      await navigate({ to: "/erased", replace: true });
    },
    onError: (error: unknown) => {
      const failure = describeAccountErasureFailure(error);
      setFeedback({
        type: "attention",
        message: failure.message,
        ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
      });
    },
  }));

  const setConfirmation = (value: string): void => {
    setConfirmationValue(value);
    setConfirmationError(undefined);
  };

  const eraseAccount = (): void => {
    setFeedback(undefined);
    setConfirmationError(undefined);
    if (!isErasureConfirmation(confirmation())) {
      setConfirmationError("That phrase did not match. Nothing was deleted.");
      return;
    }
    setFeedback({ type: "pending", message: "Erasing your account…" });
    void erase.mutate();
  };

  return {
    confirmation,
    confirmationError,
    erasing: () => erase.isPending,
    feedback,
    setConfirmation,
    erase: eraseAccount,
  };
}
