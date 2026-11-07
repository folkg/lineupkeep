import { useMutation, useQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState, RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";
import type {
  TransactionReviewItemView,
  TransactionReviewTeamView,
  TransactionReviewView,
  WithdrawTradeData,
  WithdrawTradeRequest,
} from "#contracts/connections/transactionContract.ts";

import {
  describeTradeWithdrawalFailure,
  describeTransactionSubmissionFailure,
} from "./transactionFailure";
import { transactionMutations } from "./transactionMutations";
import type { TransactionReviewQueryOptions } from "./transactionQueries";
import type { TransactionRemote } from "./transactionRemote";

export const resultSummaryId = "submission-result";

export function useTransactionReviewPage(
  props: TransactionReviewPageOptions,
): TransactionReviewPageController {
  const review = useQuery(() => props.reviewQuery());
  const signIn = useSignInRecovery();
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [justSubmitted, setJustSubmitted] = createSignal(false);
  const [withdrawingKey, setWithdrawingKey] = createSignal<string>();

  createEffect(
    () => justSubmitted(),
    (submittedNow) => {
      if (!submittedNow) {
        return;
      }
      const result = document.getElementById(resultSummaryId);
      if (result === null) {
        return;
      }
      result.scrollIntoView({ block: "start" });
      result.focus();
      setJustSubmitted(false);
    },
  );

  const submit = useMutation(() => {
    const options = transactionMutations.submit(props.remote());
    return {
      ...options,
      onSuccess: (
        data: TransactionReviewView,
        variables: { readonly set: string; readonly include: ReadonlyArray<string> },
        onMutateResult: unknown,
        context: Parameters<NonNullable<typeof options.onSuccess>>[3],
      ) => {
        options.onSuccess?.(data, variables, onMutateResult, context);
        setFeedback(undefined);
        setJustSubmitted(true);
      },
      onError: (error: Error) => {
        const failure = describeTransactionSubmissionFailure(error);
        setFeedback({
          type: "attention",
          message: failure.message,
          ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
        });
        if (failure.kind === "conflict") {
          void review.refetch();
        }
      },
    };
  });

  const withdraw = useMutation(() => {
    const options = transactionMutations.withdraw(props.remote());
    return {
      ...options,
      onSuccess: (
        data: WithdrawTradeData,
        variables: WithdrawTradeRequest,
        onMutateResult: unknown,
        context: Parameters<NonNullable<typeof options.onSuccess>>[3],
      ) => {
        options.onSuccess?.(data, variables, onMutateResult, context);
        setFeedback({ type: "success", message: data.detail });
      },
      onError: (error: Error) => {
        const failure = describeTradeWithdrawalFailure(error);
        setFeedback({
          type: "attention",
          message: failure.message,
          ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
        });
        if (failure.kind === "conflict") {
          void review.refetch();
        }
      },
      onSettled: () => {
        setWithdrawingKey(undefined);
      },
    };
  });

  const withdrawItem = (team: string, item: string): void => {
    if (withdraw.isPending) {
      return;
    }
    setWithdrawingKey(item);
    setFeedback(undefined);
    void withdraw.mutate({ team, item });
  };

  const withdrawOffer = (team: string, offer: string): void => {
    if (withdraw.isPending) {
      return;
    }
    setWithdrawingKey(offer);
    setFeedback(undefined);
    void withdraw.mutate({ team, offer });
  };

  const isItemIncluded = (item: TransactionReviewItemView): boolean =>
    item.state === "proposed" &&
    item.staleness.status !== "stale" &&
    item.staleness.status !== "illegal" &&
    !excluded().has(item.id);

  const toggleItem = (item: string, included: boolean): void => {
    if (submit.isPending) {
      return;
    }
    setExcluded((current) => {
      const next = new Set(current);
      if (included) {
        next.delete(item);
      } else {
        next.add(item);
      }
      return next;
    });
  };

  const model = createMemo<TransactionReviewModel | undefined>(() => {
    if (!review.isSuccess) {
      return undefined;
    }
    const data = review.data;
    const items = data.teams.flatMap((team) => team.items);
    const included = items.filter(isItemIncluded);
    const checkedTimes = items.flatMap((item) =>
      item.staleness.checkedAt === undefined ? [] : [item.staleness.checkedAt],
    );
    const outcomes = items.map((item) => item.execution?.outcome).filter(isOutcome);
    const latestSubmission = data.set.submissions[data.set.submissions.length - 1];
    return {
      review: data,
      teamsWithItems: data.teams.filter((team) => team.items.length > 0),
      quietTeams: data.teams.filter((team) => team.items.length === 0),
      total: items.length,
      proposedCount: items.filter((item) => item.state === "proposed").length,
      staleCount: items.filter((item) => item.staleness.status === "stale").length,
      illegalCount: items.filter((item) => item.staleness.status === "illegal").length,
      checkedAt: checkedTimes.sort((left, right) => right.localeCompare(left))[0],
      includedItems: included,
      includedIds: included.map((item) => item.id),
      includedCount: included.length,
      includedWaivers: included.filter((item) => item.kind === "waiver_claim").length,
      includedFaab: included.reduce(
        (total, item) => total + (item.kind === "waiver_claim" ? (item.bid ?? 0) : 0),
        0,
      ),
      submitted: data.set.submissions.length > 0,
      settled: data.set.settled,
      submissions: data.set.submissions,
      ...(latestSubmission === undefined ? {} : { latestSubmission }),
      finished: latestSubmission?.completedAt !== undefined,
      counts: {
        executed: outcomes.filter((outcome) => outcome === "executed").length,
        pending: outcomes.filter((outcome) => outcome === "pending").length,
        failed: outcomes.filter((outcome) => outcome === "failed").length,
        skipped: outcomes.filter((outcome) => outcome === "skipped").length,
        unknown: outcomes.filter((outcome) => outcome === "unknown").length,
      },
    };
  });

  const send = (): void => {
    const current = model();
    if (current === undefined || current.includedCount === 0 || submit.isPending) {
      setFeedback({
        type: "attention",
        message: "Include at least one current move before submitting.",
      });
      return;
    }
    setFeedback(undefined);
    void submit.mutate({ set: current.review.set.id, include: current.includedIds });
  };

  return {
    model,
    isItemIncluded,
    toggleItem,
    isLoading: () => review.isPending,
    failure: () => review.error,
    retry: () => review.refetch().then(() => undefined),
    signIn,
    submit: send,
    submitting: () => submit.isPending,
    withdrawItem,
    withdrawOffer,
    withdrawing: withdrawingKey,
    withdrawingTrade: () => withdraw.isPending,
    feedback,
    justSubmitted,
    acknowledgeSubmit: () => setJustSubmitted(false),
  };
}

function isOutcome(value: string | undefined): value is TransactionReviewModelOutcome {
  return (
    value === "executed" ||
    value === "pending" ||
    value === "failed" ||
    value === "skipped" ||
    value === "unknown"
  );
}

export type TransactionReviewModelOutcome =
  | "executed"
  | "pending"
  | "failed"
  | "skipped"
  | "unknown";

export type TransactionReviewPageController = {
  readonly model: Accessor<TransactionReviewModel | undefined>;
  readonly isItemIncluded: (item: TransactionReviewItemView) => boolean;
  readonly toggleItem: (item: string, included: boolean) => void;
  readonly isLoading: Accessor<boolean>;
  readonly failure: Accessor<Error | null>;
  readonly retry: () => Promise<void>;
  readonly signIn: RecoveryAction;
  readonly submit: () => void;
  readonly submitting: Accessor<boolean>;
  readonly withdrawItem: (team: string, item: string) => void;
  readonly withdrawOffer: (team: string, offer: string) => void;
  readonly withdrawing: Accessor<string | undefined>;
  readonly withdrawingTrade: Accessor<boolean>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly justSubmitted: Accessor<boolean>;
  readonly acknowledgeSubmit: () => void;
};

export type TransactionReviewModel = {
  readonly review: TransactionReviewView;
  readonly teamsWithItems: ReadonlyArray<TransactionReviewTeamView>;
  readonly quietTeams: ReadonlyArray<TransactionReviewTeamView>;
  readonly total: number;
  readonly proposedCount: number;
  readonly staleCount: number;
  readonly illegalCount: number;
  readonly checkedAt: string | undefined;
  readonly includedItems: ReadonlyArray<TransactionReviewItemView>;
  readonly includedIds: ReadonlyArray<string>;
  readonly includedCount: number;
  readonly includedWaivers: number;
  readonly includedFaab: number;
  readonly submitted: boolean;
  readonly settled: boolean;
  readonly submissions: TransactionReviewView["set"]["submissions"];
  readonly latestSubmission?: TransactionReviewView["set"]["submissions"][number];
  readonly finished: boolean;
  readonly counts: {
    readonly executed: number;
    readonly pending: number;
    readonly failed: number;
    readonly skipped: number;
    readonly unknown: number;
  };
};

type TransactionReviewPageOptions = {
  readonly reviewQuery: Accessor<TransactionReviewQueryOptions>;
  readonly remote: Accessor<TransactionRemote>;
};
