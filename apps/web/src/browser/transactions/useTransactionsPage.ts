import { useInfiniteQuery, useMutation } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";
import { createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState, RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";
import { formatCalendarDate } from "#browser/shared-ui/formatTime.ts";
import type { TransactionReviewData } from "#contracts/connections/transactionContract.ts";

import { buildTimeline, moveTotal } from "./timeline";
import type { TimelineEarlierEntry, TimelineFutureDay, TimelineGroup } from "./timeline";
import { moveCount } from "./transactionCopy";
import {
  describeTransactionDismissalFailure,
  describeTransactionRescheduleFailure,
  describeTransactionSubmissionFailure,
} from "./transactionFailure";
import { transactionQueries } from "./transactionQueries";
import type { TransactionRemote } from "./transactionRemote";

export function useTransactionsPage(props: TransactionsPageOptions): TransactionsPageController {
  const open = useInfiniteQuery(() => transactionQueries.list(props.remote(), { state: "open" }));
  const signIn = useSignInRecovery();
  const [earlierEnabled, setEarlierEnabled] = createSignal(false);
  const earlier = useInfiniteQuery(() => ({
    ...transactionQueries.list(props.remote(), { state: "closed" }),
    enabled: earlierEnabled(),
  }));
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [editing, setEditing] = createSignal<string>();
  const [editingDate, setEditingDate] = createSignal("");
  const [editingError, setEditingError] = createSignal<string>();

  const openSets = createMemo(() =>
    open.isSuccess ? open.data.pages.flatMap((page) => page.sets) : [],
  );
  const earlierSets = createMemo(() =>
    earlier.isSuccess ? earlier.data.pages.flatMap((page) => page.sets) : [],
  );
  const timeline = createMemo(() => buildTimeline(openSets(), earlierSets()));
  const counts = createMemo(() => {
    const first = open.isSuccess ? open.data.pages[0] : undefined;
    return first?.counts ?? { open: 0, ended: 0 };
  });

  const refresh = (): void => {
    void open.refetch();
    if (earlier.isFetched) {
      void earlier.refetch();
    }
  };

  const submit = useMutation(() => ({
    mutationKey: ["transactions", "submit"],
    mutationFn: async (groups: ReadonlyArray<TimelineGroup>) => {
      const results: Array<TransactionReviewData> = [];
      for (const [set, include] of itemsBySet(groups)) {
        results.push(await props.remote().submit({ set, include, bids: [] }));
      }
      return results;
    },
    onSuccess: (
      results: ReadonlyArray<TransactionReviewData>,
      groups: ReadonlyArray<TimelineGroup>,
      _onMutateResult: unknown,
      context: MutationFunctionContext,
    ) => {
      for (const result of results) {
        void context.client.setQueryData(
          transactionQueries.reviewKey(result.review.set.id),
          result.review,
        );
      }
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      setFeedback({ type: "success", message: submissionMessage(results, groups) });
      refresh();
    },
    onError: (error: Error, _groups, _onMutateResult, context: MutationFunctionContext) => {
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      const failure = describeTransactionSubmissionFailure(error);
      setFeedback({
        type: "attention",
        message: failure.message,
        ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
      });
      refresh();
    },
  }));

  const dismiss = useMutation(() => ({
    mutationKey: ["transactions", "discard"],
    mutationFn: (group: TimelineGroup) =>
      props.remote().dismiss({ set: group.set, items: group.items.map((item) => item.id) }),
    onSuccess: (
      data: Awaited<ReturnType<TransactionRemote["dismiss"]>>,
      group: TimelineGroup,
      _onMutateResult: unknown,
      context: MutationFunctionContext,
    ) => {
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      if (data.outcome === "refused") {
        setFeedback({
          type: "attention",
          message: `That move was not discarded. ${data.detail}`,
        });
      } else {
        void context.client.setQueryData(
          transactionQueries.reviewKey(data.review.set.id),
          data.review,
        );
        setFeedback({
          type: "success",
          message: `Discarded ${moveCount(group.items.length)}.`,
        });
      }
      refresh();
    },
    onError: (error: Error, _group, _onMutateResult, context: MutationFunctionContext) => {
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      const failure = describeTransactionDismissalFailure(error);
      setFeedback({
        type: "attention",
        message: failure.message,
        ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
      });
      refresh();
    },
  }));

  const reschedule = useMutation(() => ({
    mutationKey: ["transactions", "reschedule"],
    mutationFn: (input: { readonly group: TimelineGroup; readonly window: string }) =>
      props.remote().reschedule({
        set: input.group.set,
        items: input.group.items.map((item) => item.id),
        window: input.window,
      }),
    onSuccess: (
      data: Awaited<ReturnType<TransactionRemote["reschedule"]>>,
      _input,
      _onMutateResult,
      context: MutationFunctionContext,
    ) => {
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      if (data.status === "refused") {
        setFeedback({
          type: "attention",
          message: `The saved moves were withdrawn, but no replacement could be saved. ${data.detail}`,
        });
      } else {
        setEditing(undefined);
        setEditingError(undefined);
        const refused =
          data.refused.length === 0
            ? ""
            : ` ${String(data.refused.length)} could not be saved, so ${
                data.refused.length === 1 ? "that move is" : "those moves are"
              } no longer open. ${data.refused.map((entry) => entry.reason).join(" ")}`;
        setFeedback({
          type: "success",
          message: `Saved ${moveCount(data.saved)} for ${formatCalendarDate(data.window)}.${refused}`,
        });
      }
      refresh();
    },
    onError: (error: Error, _input, _onMutateResult, context: MutationFunctionContext) => {
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      const failure = describeTransactionRescheduleFailure(error);
      setFeedback({
        type: "attention",
        message: failure.message,
        ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
      });
      refresh();
    },
  }));

  const startEdit = (group: TimelineGroup): void => {
    setFeedback(undefined);
    setEditingError(undefined);
    setEditing(group.key);
    setEditingDate(group.runDate ?? "");
  };

  const cancelEdit = (): void => {
    setEditing(undefined);
    setEditingError(undefined);
  };

  const saveEdit = (): void => {
    const group = timeline()
      .future.flatMap((day) => day.groups)
      .find((entry) => entry.key === editing());
    if (group === undefined) {
      return;
    }
    const date = editingDate();
    if (group.today !== undefined && date <= group.today) {
      setEditingError("Choose a date after today.");
      return;
    }
    setEditingError(undefined);
    if (!reschedule.isPending) {
      void reschedule.mutate({ group, window: date });
    }
  };

  return {
    today: () => timeline().today,
    future: () => timeline().future,
    earlier: () => timeline().earlier,
    todayCount: () => moveTotal(timeline().today),
    endedCount: () => counts().ended,
    isLoading: () => open.isPending,
    failure: () => open.error,
    retry: () => open.refetch().then(() => undefined),
    signIn,
    feedback,
    submitGroups: (groups: ReadonlyArray<TimelineGroup>) => {
      if (!submit.isPending && groups.length > 0) {
        setFeedback(undefined);
        void submit.mutate(groups);
      }
    },
    submitting: () => submit.isPending,
    discardGroup: (group: TimelineGroup) => {
      if (!dismiss.isPending) {
        setFeedback(undefined);
        void dismiss.mutate(group);
      }
    },
    discarding: () => (dismiss.isPending ? dismiss.variables?.key : undefined),
    startEdit,
    cancelEdit,
    saveEdit,
    editing,
    editingDate,
    setEditingDate,
    editingError,
    saving: () => reschedule.isPending,
    hasMoreOpen: () => open.hasNextPage,
    fetchingMoreOpen: () => open.isFetchingNextPage,
    showMoreOpen: () => {
      if (!open.isFetchingNextPage && open.hasNextPage) {
        void open.fetchNextPage();
      }
    },
    earlierEnabled,
    toggleEarlier: () => setEarlierEnabled((current) => !current),
    earlierLoading: () => earlier.isPending,
    earlierFailure: () => earlier.error,
    retryEarlier: () => earlier.refetch().then(() => undefined),
    hasMoreEarlier: () => earlier.hasNextPage,
    fetchingMoreEarlier: () => earlier.isFetchingNextPage,
    showMoreEarlier: () => {
      if (!earlier.isFetchingNextPage && earlier.hasNextPage) {
        void earlier.fetchNextPage();
      }
    },
  };
}

function itemsBySet(
  groups: ReadonlyArray<TimelineGroup>,
): ReadonlyArray<readonly [string, ReadonlyArray<string>]> {
  const bySet = new Map<string, Array<string>>();
  for (const group of groups) {
    const current = bySet.get(group.set) ?? [];
    for (const item of group.items) {
      current.push(item.id);
    }
    bySet.set(group.set, current);
  }
  return [...bySet.entries()];
}

function submissionMessage(
  results: ReadonlyArray<TransactionReviewData>,
  groups: ReadonlyArray<TimelineGroup>,
): string {
  const sent = moveTotal(groups);
  const scheduled = results.reduce((total, result) => total + (result.scheduled ?? 0), 0);
  const nextRun = results.find((result) => result.nextRun !== undefined)?.nextRun;
  if (scheduled === 0) {
    return `Submitted ${moveCount(sent)} today.`;
  }
  const due = sent - scheduled;
  const stays = scheduled === 1 ? "stays" : "stay";
  const when = nextRun === undefined ? "a later day" : formatCalendarDate(nextRun);
  return due === 0
    ? `Nothing runs today. ${moveCount(scheduled)} ${stays} scheduled for ${when}.`
    : `Submitted ${moveCount(due)} today. ${moveCount(scheduled)} ${stays} scheduled for ${when}.`;
}

export type TransactionsPageController = {
  readonly today: Accessor<ReadonlyArray<TimelineGroup>>;
  readonly future: Accessor<ReadonlyArray<TimelineFutureDay>>;
  readonly earlier: Accessor<ReadonlyArray<TimelineEarlierEntry>>;
  readonly todayCount: () => number;
  readonly endedCount: () => number;
  readonly isLoading: () => boolean;
  readonly failure: () => Error | null;
  readonly retry: () => Promise<void>;
  readonly signIn: RecoveryAction;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly submitGroups: (groups: ReadonlyArray<TimelineGroup>) => void;
  readonly submitting: () => boolean;
  readonly discardGroup: (group: TimelineGroup) => void;
  readonly discarding: () => string | undefined;
  readonly startEdit: (group: TimelineGroup) => void;
  readonly cancelEdit: () => void;
  readonly saveEdit: () => void;
  readonly editing: Accessor<string | undefined>;
  readonly editingDate: Accessor<string>;
  readonly setEditingDate: (value: string) => void;
  readonly editingError: Accessor<string | undefined>;
  readonly saving: () => boolean;
  readonly hasMoreOpen: () => boolean;
  readonly fetchingMoreOpen: () => boolean;
  readonly showMoreOpen: () => void;
  readonly earlierEnabled: Accessor<boolean>;
  readonly toggleEarlier: () => void;
  readonly earlierLoading: () => boolean;
  readonly earlierFailure: () => Error | null;
  readonly retryEarlier: () => Promise<void>;
  readonly hasMoreEarlier: () => boolean;
  readonly fetchingMoreEarlier: () => boolean;
  readonly showMoreEarlier: () => void;
};

type TransactionsPageOptions = {
  readonly remote: Accessor<TransactionRemote>;
};
