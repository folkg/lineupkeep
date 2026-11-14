import { useInfiniteQuery, useMutation } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";
import { createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState, RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";
import { formatCalendarDate } from "#browser/shared-ui/formatTime.ts";
import type {
  DismissTransactionProposalData,
  TransactionReviewData,
} from "#contracts/connections/transactionContract.ts";

import { buildTimeline, dayMoveTotal, dayMoves } from "./timeline";
import type { TimelineDay, TimelineEarlierEntry, TimelineMove, TimelineTeamDay } from "./timeline";
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
  const [choices, setChoices] = createSignal<Readonly<Record<string, TodayChoice>>>({});
  const [onlyToday, setOnlyToday] = createSignal(false);
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
  const todayMoves = createMemo(() => dayMoves(timeline().today));
  const undecidedTodayCount = createMemo(
    () => todayMoves().filter((move) => choices()[move.item.id] === undefined).length,
  );
  const canSubmitToday = createMemo(
    () =>
      todayMoves().length > 0 &&
      todayMoves().every((move) => {
        const choice = choices()[move.item.id];
        return (
          choice === "discard" ||
          (choice === "do_it_now" && move.item.staleness.status === "current")
        );
      }),
  );

  const refresh = (): void => {
    void open.refetch();
    if (earlier.isFetched) {
      void earlier.refetch();
    }
  };

  const submit = useMutation(() => ({
    mutationKey: ["transactions", "submit-today"],
    mutationFn: async (input: TodaySubmission): Promise<TodaySubmissionResult> => {
      const results: Array<TransactionReviewData> = [];
      for (const [set, include] of itemsBySet(input.include)) {
        results.push(await props.remote().submit({ set, include, bids: [] }));
      }
      const dismissed: Array<DismissTransactionProposalData> = [];
      const dismissalFailures: Array<unknown> = [];
      for (const [set, items] of itemsBySet(input.discard)) {
        try {
          dismissed.push(await props.remote().dismiss({ set, items }));
        } catch (error) {
          dismissalFailures.push(error);
        }
      }
      return { results, dismissed, dismissalFailures };
    },
    onSuccess: (
      outcome: TodaySubmissionResult,
      input: TodaySubmission,
      _onMutateResult: unknown,
      context: MutationFunctionContext,
    ) => {
      for (const result of outcome.results) {
        void context.client.setQueryData(
          transactionQueries.reviewKey(result.review.set.id),
          result.review,
        );
      }
      for (const result of outcome.dismissed) {
        if (result.outcome === "dismissed") {
          void context.client.setQueryData(
            transactionQueries.reviewKey(result.review.set.id),
            result.review,
          );
        }
      }
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      const discarded = outcome.dismissed.filter((result) => result.outcome === "dismissed").length;
      const refused = outcome.dismissed.flatMap((result) =>
        result.outcome === "refused" ? [`That move was not discarded. ${result.detail}`] : [],
      );
      const failures = outcome.dismissalFailures.map(
        (error) => describeTransactionDismissalFailure(error).message,
      );
      const message = submissionMessage(outcome.results, input.include.length, discarded);
      const problems = [...refused, ...failures];
      setFeedback({
        type: problems.length > 0 ? "attention" : "success",
        message: [message, ...problems].filter((part) => part.length > 0).join(" "),
      });
      setChoices({});
      setEditing(undefined);
      refresh();
    },
    onError: (error: Error, _input, _onMutateResult, context: MutationFunctionContext) => {
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
    mutationFn: (move: TimelineMove) =>
      props.remote().dismiss({ set: move.set, items: [move.item.id] }),
    onSuccess: (
      data: DismissTransactionProposalData,
      _move: TimelineMove,
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
        setFeedback({ type: "success", message: `Discarded ${moveCount(1)}.` });
      }
      refresh();
    },
    onError: (error: Error, _move, _onMutateResult, context: MutationFunctionContext) => {
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
    mutationFn: (input: { readonly move: TimelineMove; readonly window: string }) =>
      props.remote().reschedule({
        set: input.move.set,
        items: [input.move.item.id],
        window: input.window,
      }),
    onSuccess: (
      data: Awaited<ReturnType<TransactionRemote["reschedule"]>>,
      _input: { readonly move: TimelineMove; readonly window: string },
      _onMutateResult: unknown,
      context: MutationFunctionContext,
    ) => {
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      if (data.status === "refused") {
        setFeedback({
          type: "attention",
          message: `The saved move was withdrawn, but no replacement could be saved. ${data.detail}`,
        });
      } else {
        setEditing(undefined);
        setEditingError(undefined);
        const refused =
          data.refused.length === 0
            ? ""
            : ` This move could not be saved, so it is no longer open. ${data.refused.map((entry) => entry.reason).join(" ")}`;
        setFeedback({
          type: "success",
          message:
            data.saved === 0
              ? `No replacement was saved for ${formatCalendarDate(data.window)}.${refused}`
              : `Saved ${moveCount(data.saved)} for ${formatCalendarDate(data.window)}.${refused}`,
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

  const futureCardOf = (
    moveId: string,
  ): { readonly card: TimelineTeamDay; readonly move: TimelineMove } | undefined => {
    for (const day of timeline().future) {
      for (const card of day.teams) {
        const move = card.moves.find((entry) => entry.item.id === moveId);
        if (move !== undefined) {
          return { card, move };
        }
      }
    }
    return undefined;
  };

  const chooseToday = (moveId: string, choice: TodayChoice): void => {
    if (submit.isPending) {
      return;
    }
    setFeedback(undefined);
    setChoices((current) => ({ ...current, [moveId]: choice }));
  };

  const submitToday = (): void => {
    if (!canSubmitToday() || submit.isPending) {
      return;
    }
    const include = todayMoves().filter((move) => choices()[move.item.id] === "do_it_now");
    const discard = todayMoves().filter((move) => choices()[move.item.id] === "discard");
    setFeedback(undefined);
    void submit.mutate({ include, discard });
  };

  const discardMove = (move: TimelineMove): void => {
    if (!dismiss.isPending && !submit.isPending) {
      setFeedback(undefined);
      void dismiss.mutate(move);
    }
  };

  const startEdit = (move: TimelineMove, runDate: string | undefined): void => {
    setFeedback(undefined);
    setEditingError(undefined);
    setEditing(move.item.id);
    setEditingDate(move.item.window ?? runDate ?? "");
  };

  const cancelEdit = (): void => {
    setEditing(undefined);
    setEditingError(undefined);
  };

  const saveEdit = (): void => {
    const target = futureCardOf(editing() ?? "");
    if (target === undefined) {
      return;
    }
    const date = editingDate();
    if (date.length === 0) {
      setEditingError("Choose a date.");
      return;
    }
    if (target.card.today !== undefined && date <= target.card.today) {
      setEditingError("Choose a date after today.");
      return;
    }
    setEditingError(undefined);
    if (!reschedule.isPending) {
      void reschedule.mutate({ move: target.move, window: date });
    }
  };

  return {
    today: () => timeline().today,
    future: () => timeline().future,
    earlier: () => timeline().earlier,
    openCount: () => counts().open,
    todayCount: () => dayMoveTotal(timeline().today),
    scheduledCount: () => Math.max(0, counts().open - dayMoveTotal(timeline().today)),
    onlyToday,
    toggleOnlyToday: () => setOnlyToday((current) => !current),
    choiceFor: (moveId) => choices()[moveId],
    chooseToday,
    undecidedTodayCount,
    canSubmitToday,
    submitToday,
    submitting: () => submit.isPending,
    discardMove,
    discarding: () => (dismiss.isPending ? dismiss.variables?.item.id : undefined),
    startEdit,
    cancelEdit,
    saveEdit,
    editing,
    editingDate,
    setEditingDate,
    editingError,
    saving: () => reschedule.isPending,
    endedCount: () => counts().ended,
    isLoading: () => open.isPending,
    failure: () => open.error,
    retry: () => open.refetch().then(() => undefined),
    signIn,
    feedback,
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
  moves: ReadonlyArray<TimelineMove>,
): ReadonlyArray<readonly [string, ReadonlyArray<string>]> {
  const bySet = new Map<string, Array<string>>();
  for (const move of moves) {
    const current = bySet.get(move.set) ?? [];
    current.push(move.item.id);
    bySet.set(move.set, current);
  }
  return [...bySet.entries()];
}

function submissionMessage(
  results: ReadonlyArray<TransactionReviewData>,
  submitted: number,
  discarded: number,
): string {
  const parts: Array<string> = [];
  const scheduled = results.reduce((total, result) => total + (result.scheduled ?? 0), 0);
  const nextRun = results.find((result) => result.nextRun !== undefined)?.nextRun;
  if (submitted > 0) {
    if (scheduled === 0) {
      parts.push(`Submitted ${moveCount(submitted)} today.`);
    } else {
      const due = submitted - scheduled;
      const stays = scheduled === 1 ? "stays" : "stay";
      const when = nextRun === undefined ? "a later day" : formatCalendarDate(nextRun);
      parts.push(
        due === 0
          ? `Nothing runs today. ${moveCount(scheduled)} ${stays} scheduled for ${when}.`
          : `Submitted ${moveCount(due)} today. ${moveCount(scheduled)} ${stays} scheduled for ${when}.`,
      );
    }
  }
  if (discarded > 0) {
    parts.push(`Discarded ${moveCount(discarded)}.`);
  }
  return parts.join(" ");
}

export type TransactionsPageController = {
  readonly today: Accessor<TimelineDay>;
  readonly future: Accessor<ReadonlyArray<TimelineDay>>;
  readonly earlier: Accessor<ReadonlyArray<TimelineEarlierEntry>>;
  readonly openCount: () => number;
  readonly todayCount: () => number;
  readonly scheduledCount: () => number;
  readonly onlyToday: Accessor<boolean>;
  readonly toggleOnlyToday: () => void;
  readonly choiceFor: (moveId: string) => TodayChoice | undefined;
  readonly chooseToday: (moveId: string, choice: TodayChoice) => void;
  readonly undecidedTodayCount: () => number;
  readonly canSubmitToday: () => boolean;
  readonly submitToday: () => void;
  readonly submitting: () => boolean;
  readonly discardMove: (move: TimelineMove) => void;
  readonly discarding: () => string | undefined;
  readonly startEdit: (move: TimelineMove, runDate: string | undefined) => void;
  readonly cancelEdit: () => void;
  readonly saveEdit: () => void;
  readonly editing: Accessor<string | undefined>;
  readonly editingDate: Accessor<string>;
  readonly setEditingDate: (value: string) => void;
  readonly editingError: Accessor<string | undefined>;
  readonly saving: () => boolean;
  readonly endedCount: () => number;
  readonly isLoading: () => boolean;
  readonly failure: () => Error | null;
  readonly retry: () => Promise<void>;
  readonly signIn: RecoveryAction;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
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

type TodayChoice = "do_it_now" | "discard";

type TodaySubmission = {
  readonly include: ReadonlyArray<TimelineMove>;
  readonly discard: ReadonlyArray<TimelineMove>;
};

type TodaySubmissionResult = {
  readonly results: ReadonlyArray<TransactionReviewData>;
  readonly dismissed: ReadonlyArray<DismissTransactionProposalData>;
  readonly dismissalFailures: ReadonlyArray<unknown>;
};
