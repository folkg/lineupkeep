import { useMutation, useQuery } from "@tanstack/solid-query";
import { useNavigate } from "@tanstack/solid-router";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import type {
  AccountExportStatusView,
  AccountErasureSummaryView,
} from "#contracts/account/accountContract.ts";
import { isErasureConfirmation } from "#contracts/account/accountContract.ts";

import {
  describeAccountErasureFailure,
  describeAccountExportStatusFailure,
} from "./accountFailure";
import type { AccountFailure } from "./accountFailure";
import { accountQueries } from "./accountQueries";
import type { AccountDataRemote } from "./accountRemote";

export function useAccountData(options: {
  readonly remote: () => AccountDataRemote;
  readonly onErased: () => Promise<void>;
}): {
  readonly confirmation: Accessor<string>;
  readonly confirmationError: Accessor<string | undefined>;
  readonly erasing: Accessor<boolean>;
  readonly exportStatus: Accessor<AccountExportStatusView | undefined>;
  readonly statusLoading: Accessor<boolean>;
  readonly statusFailure: Accessor<AccountFailure | undefined>;
  readonly refreshExportStatus: () => Promise<void>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly setConfirmation: (value: string) => void;
  readonly erase: () => void;
} {
  const [confirmation, setConfirmationValue] = createSignal("");
  const [confirmationError, setConfirmationError] = createSignal<string>();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const status = useQuery(() => accountQueries.exportStatus(options.remote()));
  const signIn = useSignInRecovery();
  const navigate = useNavigate();

  const erase = useMutation(() => ({
    mutationFn: () => options.remote().erase(confirmation()),
    onSuccess: async (_summary: AccountErasureSummaryView) => {
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
      void status.refetch();
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
    exportStatus: () => status.data,
    statusLoading: () => status.isPending,
    statusFailure: () =>
      status.error === null ? undefined : describeAccountExportStatusFailure(status.error),
    refreshExportStatus: () => status.refetch().then(() => undefined),
    feedback,
    setConfirmation,
    erase: eraseAccount,
  };
}
