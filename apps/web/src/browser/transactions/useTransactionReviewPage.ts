import { useMutation, useQuery } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState, RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";
import type {
  DismissTransactionProposalData,
  DismissTransactionProposalRequest,
  TransactionReviewData,
  TransactionReviewItemView,
  TransactionReviewTeamView,
  TransactionReviewView,
  WithdrawTradeData,
  WithdrawTradeRequest,
} from "#contracts/connections/transactionContract.ts";

import { readWaiverBid, waiverBidBudgetError } from "./transactionBids";
import {
  describeTradeWithdrawalFailure,
  describeTransactionDismissalFailure,
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
  const [bidDrafts, setBidDrafts] = createSignal<ReadonlyMap<string, string>>(new Map());
  const [sentBids, setSentBids] = createSignal<ReadonlyMap<string, number>>(new Map());
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [justSubmitted, setJustSubmitted] = createSignal(false);
  const [withdrawingKey, setWithdrawingKey] = createSignal<string>();
  const [dismissFailures, setDismissFailures] = createSignal<ReadonlyMap<string, string>>(
    new Map(),
  );
  const [dismissFocus, setDismissFocus] = createSignal<DismissFocus>();
  let dismissedLabel = "";
  let dismissedTeam = "";
  let dismissedFocusIndex = -1;

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

  createEffect(
    () => ({ request: dismissFocus(), data: review.data }),
    ({ request }) => {
      if (request === undefined) {
        return;
      }
      const buttons = [...document.querySelectorAll<HTMLElement>("[data-dismiss-item]")];
      const target =
        request.index < buttons.length
          ? buttons[request.index]
          : document.getElementById(`team-${request.team}`);
      target?.focus();
      setDismissFocus(undefined);
    },
  );

  const submit = useMutation(() => {
    const options = transactionMutations.submit(props.remote());
    return {
      ...options,
      onSuccess: (
        data: TransactionReviewData,
        variables: {
          readonly set: string;
          readonly include: ReadonlyArray<string>;
          readonly bids: ReadonlyArray<{ readonly item: string; readonly bid: number }>;
        },
        onMutateResult: unknown,
        context: Parameters<NonNullable<typeof options.onSuccess>>[3],
      ) => {
        options.onSuccess?.(data, variables, onMutateResult, context);
        const submittedBids = data.submittedBids ?? [];
        if (submittedBids.length > 0) {
          setSentBids((current) => {
            const next = new Map(current);
            for (const entry of submittedBids) {
              next.set(entry.item, entry.bid);
            }
            return next;
          });
        }
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

  const dismiss = useMutation(() => {
    const options = transactionMutations.dismiss(props.remote());
    return {
      ...options,
      onSuccess: (
        data: DismissTransactionProposalData,
        variables: DismissTransactionProposalRequest,
        onMutateResult: unknown,
        context: Parameters<NonNullable<typeof options.onSuccess>>[3],
      ) => {
        options.onSuccess?.(data, variables, onMutateResult, context);
        if (data.outcome === "refused") {
          setDismissFailures((current) => {
            const next = new Map(current);
            for (const refusal of data.refusals) {
              next.set(refusal.item, refusal.detail);
            }
            return next;
          });
          const detail = data.refusals[0]?.detail ?? data.detail;
          setFeedback({ type: "attention", message: `That move was not dismissed. ${detail}` });
          return;
        }
        setDismissFailures((current) => {
          const next = new Map(current);
          for (const item of variables.items) {
            next.delete(item);
          }
          return next;
        });
        setFeedback({
          type: "success",
          message: `Dismissed ${dismissedLabel === "" ? "the move" : dismissedLabel}.`,
        });
        if (dismissedFocusIndex >= 0) {
          setDismissFocus({ team: dismissedTeam, index: dismissedFocusIndex });
        }
      },
      onError: (error: Error) => {
        const failure = describeTransactionDismissalFailure(error);
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

  const dismissItem = (team: string, item: string, label: string): void => {
    const current = model();
    if (current === undefined || dismiss.isPending || submit.isPending) {
      return;
    }
    const buttons = [...document.querySelectorAll<HTMLElement>("[data-dismiss-item]")];
    const index = buttons.findIndex((button) => button.dataset["dismissItem"] === item);
    dismissedLabel = label;
    dismissedTeam = team;
    dismissedFocusIndex = index >= 0 && document.activeElement === buttons[index] ? index : -1;
    void dismiss.mutate({ set: current.review.set.id, items: [item] });
  };

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

  const bidReadings = createMemo<ReadonlyMap<string, TransactionReviewBidReading>>(() => {
    const data = review.data;
    const drafts = bidDrafts();
    const sent = sentBids();
    const readings = new Map<string, TransactionReviewBidReading>();
    for (const team of data.teams) {
      const remaining = team.budget?.status === "published" ? team.budget.remaining : undefined;
      for (const item of team.items) {
        if (item.kind !== "waiver_claim") {
          continue;
        }
        const proposed = item.bid ?? 0;
        const value = drafts.get(item.id) ?? String(proposed);
        const sentBid = sent.get(item.id);
        const editable = item.state === "proposed" && !data.set.closed;
        if (!editable) {
          readings.set(item.id, {
            field: { value, proposed, editable, ...(sentBid === undefined ? {} : { sentBid }) },
            bid: proposed,
          });
          continue;
        }
        const read = readWaiverBid(value);
        if (read.error !== undefined) {
          readings.set(item.id, { field: { value, proposed, editable, error: read.error } });
          continue;
        }
        const budgetError = waiverBidBudgetError(read.bid, remaining);
        readings.set(item.id, {
          field: {
            value,
            proposed,
            editable,
            ...(budgetError === undefined ? {} : { error: budgetError }),
          },
          bid: read.bid,
        });
      }
    }
    return readings;
  });

  const bidFor = (item: TransactionReviewItemView): TransactionReviewBidField | undefined => {
    if (item.kind !== "waiver_claim") {
      return undefined;
    }
    return bidReadings().get(item.id)?.field;
  };

  const setBid = (item: string, value: string): void => {
    if (submit.isPending) {
      return;
    }
    setBidDrafts((current) => new Map(current).set(item, value));
  };

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
    const readings = bidReadings();
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
        (total, item) =>
          total + (item.kind === "waiver_claim" ? (readings.get(item.id)?.bid ?? 0) : 0),
        0,
      ),
      includedBids: included.flatMap((item) => {
        const bid = readings.get(item.id)?.bid;
        return bid === undefined ? [] : [{ item: item.id, bid }];
      }),
      submitted: data.set.submissions.length > 0,
      closed: data.set.closed,
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
    if (dismiss.isPending) {
      return;
    }
    if (current === undefined || current.includedCount === 0 || submit.isPending) {
      setFeedback({
        type: "attention",
        message: "Include at least one current move before submitting.",
      });
      return;
    }
    const bidError = current.includedItems.flatMap((item) => {
      const error = bidFor(item)?.error;
      return error === undefined ? [] : [error];
    })[0];
    if (bidError !== undefined) {
      setFeedback({ type: "attention", message: bidError });
      return;
    }
    setFeedback(undefined);
    void submit.mutate({
      set: current.review.set.id,
      include: current.includedIds,
      bids: current.includedBids,
    });
  };

  return {
    model,
    isItemIncluded,
    bidFor,
    setBid,
    toggleItem,
    isLoading: () => review.isPending,
    failure: () => review.error,
    retry: () => review.refetch().then(() => undefined),
    signIn,
    submit: send,
    submitting: () => submit.isPending,
    dismissItem,
    dismissing: () => (dismiss.isPending ? dismiss.variables?.items[0] : undefined),
    dismissFailure: (item: string) => dismissFailures().get(item),
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
  readonly bidFor: (item: TransactionReviewItemView) => TransactionReviewBidField | undefined;
  readonly setBid: (item: string, value: string) => void;
  readonly toggleItem: (item: string, included: boolean) => void;
  readonly isLoading: Accessor<boolean>;
  readonly failure: Accessor<Error | null>;
  readonly retry: () => Promise<void>;
  readonly signIn: RecoveryAction;
  readonly submit: () => void;
  readonly submitting: Accessor<boolean>;
  readonly dismissItem: (team: string, item: string, label: string) => void;
  readonly dismissing: Accessor<string | undefined>;
  readonly dismissFailure: (item: string) => string | undefined;
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
  readonly includedBids: ReadonlyArray<{ readonly item: string; readonly bid: number }>;
  readonly submitted: boolean;
  readonly closed: boolean;
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

type DismissFocus = {
  readonly team: string;
  readonly index: number;
};

type TransactionReviewPageOptions = {
  readonly reviewQuery: Accessor<TransactionReviewQueryOptions>;
  readonly remote: Accessor<TransactionRemote>;
};

export type TransactionReviewBidField = {
  readonly value: string;
  readonly proposed: number;
  readonly editable: boolean;
  readonly sentBid?: number;
  readonly error?: string;
};

type TransactionReviewBidReading = {
  readonly field: TransactionReviewBidField;
  readonly bid?: number;
};
