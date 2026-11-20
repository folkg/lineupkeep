import { useInfiniteQuery, useMutation } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState, RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";
import { formatCalendarDate } from "#browser/shared-ui/formatTime.ts";
import type {
  TransactionMoveActionData,
  TransactionMoveConfirmationData,
  TransactionMoveDayView,
  TransactionMoveRetryData,
  TransactionMoveTeamDayView,
  TransactionMoveView,
  TransactionPlanGroupView,
  TransactionTeamFactsView,
} from "#contracts/connections/transactionContract.ts";

import { cardHasAction, cardIsSettled, dayTeamCards } from "./transactionCards";
import { moveCount, moveSummary } from "./transactionCopy";
import { describeTransactionActionFailure } from "./transactionFailure";
import { transactionQueries } from "./transactionQueries";
import type { TransactionRemote } from "./transactionRemote";
import { plannedMoment } from "./transactionTimes";
import type { ConfirmationTarget } from "./useGroupConfirmation";

export function useTransactionsPage(props: TransactionsPageOptions): TransactionsPageController {
  const signIn = useSignInRecovery();
  const open = useInfiniteQuery(() => transactionQueries.timeline(props.remote()));
  const [earlierChoice, setEarlierChoice] = createSignal<boolean>();
  const [earlierDefault, setEarlierDefault] = createSignal(false);
  const earlierEnabled = (): boolean => earlierChoice() ?? earlierDefault();
  const earlier = useInfiniteQuery(() => ({
    ...transactionQueries.list(props.remote(), { state: "ended" }),
    enabled: earlierEnabled(),
  }));
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [editing, setEditing] = createSignal<string>();
  const [editingDate, setEditingDate] = createSignal("");
  const [editingError, setEditingError] = createSignal<string>();

  const counts = createMemo(() => {
    const first = open.isSuccess ? open.data.pages[0] : undefined;
    return first?.counts ?? { open: 0, today: 0, saved: 0, ended: 0 };
  });
  const teamCount = createMemo(() => {
    const first = open.isSuccess ? open.data.pages[0] : undefined;
    return first?.teamCount ?? 0;
  });
  const teamFacts = createMemo(() => {
    const held = new Map<string, TransactionTeamFactsView>();
    for (const data of open.isSuccess ? open.data.pages : []) {
      for (const facts of data.teamFacts) {
        held.set(facts.team, facts);
      }
    }
    for (const data of earlier.isSuccess ? earlier.data.pages : []) {
      for (const facts of data.teamFacts) {
        held.set(facts.team, facts);
      }
    }
    return held;
  });
  const groups = createMemo(() => {
    const held = new Map<string, TransactionPlanGroupView>();
    for (const data of open.isSuccess ? open.data.pages : []) {
      for (const group of data.groups) {
        held.set(group.group, group);
      }
    }
    return [...held.values()];
  });
  const days = createMemo(() => {
    const held = new Map<string, MutableMoveDay>();
    for (const data of open.isSuccess ? open.data.pages : []) {
      for (const day of data.days) {
        addMoveDay(held, day);
      }
    }
    return [...held.values()].map(moveDayView).sort(compareMoveDays);
  });
  const hasActionableCards = (): boolean =>
    days().some((day) =>
      dayTeamCards(day, groups()).some((entry) => entry.cards.some(cardHasAction)),
    );
  const earlierHasRows = (): boolean => {
    if (counts().ended > 0) {
      return true;
    }
    return dayTeamCards(
      days().find((day) => day.today),
      groups(),
    ).some((entry) => entry.cards.some(cardIsSettled));
  };
  createEffect(
    () => ({
      choice: earlierChoice(),
      actionable: hasActionableCards(),
      rows: earlierHasRows(),
    }),
    (held) => {
      if (held.choice === undefined) {
        setEarlierDefault(!held.actionable && held.rows);
      }
    },
  );
  const refresh = (): void => {
    void open.refetch();
    if (earlier.isFetched) {
      void earlier.refetch();
    }
  };

  const save = useMutation(() => ({
    mutationKey: ["transactions", "save"],
    mutationFn: (input: { readonly move: TransactionMoveView; readonly runDay: string }) =>
      props.remote().save({
        team: input.move.team.id,
        move: input.move.move,
        runDay: input.runDay,
      }),
    onSuccess: (data: TransactionMoveActionData, input, _onMutateResult, context) => {
      if (data.status === "refused") {
        setFeedback({
          type: "attention",
          message: data.refusals.map((entry) => entry.detail).join(" "),
        });
      } else {
        setEditing(undefined);
        setEditingError(undefined);
        setFeedback({
          type: "success",
          message:
            data.status === "saved" && data.confirmationCleared
              ? `Saved for ${formatCalendarDate(input.runDay)}. Your earlier decision was cleared, so choose the move again when it is due.`
              : `Saved for ${formatCalendarDate(input.runDay)}. It waits in Today that day for your decision.`,
        });
      }
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      refresh();
    },
    onError: (error: Error, _input, _onMutateResult, context: MutationFunctionContext) => {
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      const failure = describeTransactionActionFailure(error);
      setFeedback({
        type: "attention",
        message: failure.message,
        ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
      });
      refresh();
    },
  }));

  const discard = useMutation(() => ({
    mutationKey: ["transactions", "discard"],
    mutationFn: (move: TransactionMoveView) =>
      props.remote().discard({ team: move.team.id, move: move.move }),
    onSuccess: (data: TransactionMoveActionData, _move, _onMutateResult, context) => {
      if (data.status === "refused") {
        setFeedback({
          type: "attention",
          message: data.refusals.map((entry) => entry.detail).join(" "),
        });
      } else {
        setFeedback({ type: "success", message: `Discarded ${moveCount(1)}.` });
      }
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      refresh();
    },
    onError: (error: Error, _move, _onMutateResult, context: MutationFunctionContext) => {
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      const failure = describeTransactionActionFailure(error);
      setFeedback({
        type: "attention",
        message: failure.message,
        ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
      });
      refresh();
    },
  }));

  const fix = useMutation(() => ({
    mutationKey: ["transactions", "fix"],
    mutationFn: (move: TransactionMoveView) =>
      props.remote().fix({ team: move.team.id, move: move.move }),
    onSuccess: (data: TransactionMoveActionData, move, _onMutateResult, context) => {
      if (data.status === "refused") {
        setFeedback({
          type: "attention",
          message: data.refusals.map((entry) => entry.detail).join(" "),
        });
      } else {
        setFeedback({
          type: "success",
          message: `Added the roster fixes that make room for ${moveSummary(move)}.`,
        });
      }
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      refresh();
    },
    onError: (error: Error, _move, _onMutateResult, context: MutationFunctionContext) => {
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      const failure = describeTransactionActionFailure(error);
      setFeedback({
        type: "attention",
        message: failure.message,
        ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
      });
      refresh();
    },
  }));

  const retry = useMutation(() => ({
    mutationKey: ["transactions", "retry"],
    mutationFn: (move: TransactionMoveView) =>
      props.remote().retry({
        team: move.team.id,
        move: move.move,
        key: crypto.randomUUID(),
      }),
    onSuccess: (data: TransactionMoveRetryData, _move, _onMutateResult, context) => {
      setFeedback(retryFeedback(data));
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      refresh();
    },
    onError: (error: Error, _move, _onMutateResult, context: MutationFunctionContext) => {
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      const failure = describeTransactionActionFailure(error);
      setFeedback({
        type: "attention",
        message: failure.message,
        ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
      });
      refresh();
    },
  }));

  const discardGroup = useMutation(() => ({
    mutationKey: ["transactions", "discardGroup"],
    mutationFn: (move: TransactionMoveView) =>
      props.remote().discardGroup({ team: move.team.id, move: move.move }),
    onSuccess: (data: TransactionMoveActionData, _move, _onMutateResult, context) => {
      if (data.status === "refused") {
        setFeedback({
          type: "attention",
          message: data.refusals.map((entry) => entry.detail).join(" "),
        });
      } else {
        setFeedback({ type: "success", message: "Discarded what was left of this group." });
      }
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      refresh();
    },
    onError: (error: Error, _move, _onMutateResult, context: MutationFunctionContext) => {
      void context.client.invalidateQueries({ queryKey: transactionQueries.openCountKey });
      const failure = describeTransactionActionFailure(error);
      setFeedback({
        type: "attention",
        message: failure.message,
        ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
      });
      refresh();
    },
  }));

  const reportConfirmation = (
    outcome: TransactionMoveConfirmationData,
    target: ConfirmationTarget,
  ): void => {
    if (outcome.status === "refused") {
      setFeedback({
        type: "attention",
        message: outcome.refusals.map((entry) => entry.detail).join(" "),
      });
      return;
    }
    setFeedback({
      type: outcome.counts.failed > 0 || outcome.counts.unknown > 0 ? "attention" : "success",
      message: confirmationMessage(outcome, target),
    });
  };

  const reportConfirmationFailure = (error: unknown): void => {
    const failure = describeTransactionActionFailure(error);
    setFeedback({
      type: "attention",
      message: failure.message,
      ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
    });
  };

  const confirmationSettled = (): void => {
    refresh();
  };

  const startEdit = (move: TransactionMoveView): void => {
    setFeedback(undefined);
    setEditingError(undefined);
    setEditing(move.move);
    setEditingDate(move.runDay ?? "");
  };

  const cancelEdit = (): void => {
    setEditing(undefined);
    setEditingError(undefined);
  };

  const saveEdit = (move: TransactionMoveView): void => {
    const date = editingDate();
    if (date.length === 0) {
      setEditingError("Choose a date.");
      return;
    }
    setEditingError(undefined);
    if (!save.isPending && !discard.isPending) {
      void save.mutate({ move, runDay: date });
    }
  };

  const discardMove = (move: TransactionMoveView): void => {
    if (!discard.isPending) {
      setFeedback(undefined);
      void discard.mutate(move);
    }
  };

  return {
    days,
    counts,
    teamCount,
    teamFacts,
    groups,
    canConfirm,
    reportConfirmation,
    reportConfirmationFailure,
    confirmationSettled,
    discardMove,
    discarding: () => (discard.isPending ? discard.variables?.move : undefined),
    addFixes: (move: TransactionMoveView): void => {
      if (!fix.isPending) {
        setFeedback(undefined);
        void fix.mutate(move);
      }
    },
    addingFixes: () => (fix.isPending ? fix.variables?.move : undefined),
    retryMove: (move: TransactionMoveView): void => {
      if (!retry.isPending) {
        setFeedback(undefined);
        void retry.mutate(move);
      }
    },
    retryingMove: () => (retry.isPending ? retry.variables?.move : undefined),
    discardGroup: (move: TransactionMoveView): void => {
      if (!discardGroup.isPending) {
        setFeedback(undefined);
        void discardGroup.mutate(move);
      }
    },
    discardingGroup: () => (discardGroup.isPending ? discardGroup.variables?.move : undefined),
    startEdit,
    cancelEdit,
    saveEdit,
    editing,
    editingDate,
    setEditingDate,
    editingError,
    saving: () => save.isPending,
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
    earlier: () => (earlier.isSuccess ? earlier.data.pages.flatMap((page) => page.moves) : []),
    earlierCount: () => counts().ended,
    earlierEnabled,
    toggleEarlier: () => setEarlierChoice(!earlierEnabled()),
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

function retryFeedback(data: TransactionMoveRetryData): ActionFeedbackState {
  if (data.status === "refused") {
    return { type: "attention", message: data.refusals.map((entry) => entry.detail).join(" ") };
  }
  const parts: Array<string> = [`Retried ${moveCount(data.counts.moves)}.`];
  if (data.counts.executed > 0) {
    parts.push(`${moveCount(data.counts.executed)} ran.`);
  }
  if (data.counts.pending > 0) {
    parts.push(`${moveCount(data.counts.pending)} with the league.`);
  }
  if (data.counts.failed > 0) {
    parts.push(`${moveCount(data.counts.failed)} failed.`);
  }
  if (data.counts.unknown > 0) {
    parts.push(`${moveCount(data.counts.unknown)} has an unknown outcome.`);
  }
  return {
    type: data.counts.failed > 0 || data.counts.unknown > 0 ? "attention" : "success",
    message: parts.join(" "),
  };
}

function withPeriod(text: string): string {
  return text.endsWith(".") ? text : `${text}.`;
}

function canConfirm(move: TransactionMoveView): boolean {
  return move.validation.status === "current" && move.result === undefined;
}

function addMoveDay(held: Map<string, MutableMoveDay>, day: TransactionMoveDayView): void {
  const key = day.today ? "today" : (day.day ?? "");
  const grouped = held.get(key);
  if (grouped === undefined) {
    held.set(key, {
      ...(day.day === undefined ? {} : { day: day.day }),
      today: day.today,
      teams: new Map(
        day.teams.map((team) => [team.team.id, { team: team.team, moves: [...team.moves] }]),
      ),
    });
    return;
  }
  for (const team of day.teams) {
    const existing = grouped.teams.get(team.team.id);
    if (existing === undefined) {
      grouped.teams.set(team.team.id, { team: team.team, moves: [...team.moves] });
    } else {
      for (const move of team.moves) {
        existing.moves.push(move);
      }
    }
  }
}

function moveDayView(day: MutableMoveDay): TransactionMoveDayView {
  return {
    ...(day.day === undefined ? {} : { day: day.day }),
    groupedBy: "runDay" as const,
    today: day.today,
    teams: [...day.teams.values()]
      .map((team) => ({
        team: team.team,
        moves: [...team.moves].sort(compareMoveCards),
      }))
      .sort(compareTeamNames),
  };
}

function compareMoveDays(left: TransactionMoveDayView, right: TransactionMoveDayView): number {
  if (left.today !== right.today) {
    return left.today ? -1 : 1;
  }
  if (left.day === undefined || right.day === undefined) {
    return left.day === right.day ? 0 : left.day === undefined ? 1 : -1;
  }
  return left.day.localeCompare(right.day);
}

function compareTeamNames(
  left: TransactionMoveTeamDayView,
  right: TransactionMoveTeamDayView,
): number {
  return left.team.name.localeCompare(right.team.name) || left.team.id.localeCompare(right.team.id);
}

function compareMoveCards(left: TransactionMoveView, right: TransactionMoveView): number {
  return left.position - right.position || left.move.localeCompare(right.move);
}

type MutableMoveDay = {
  readonly day?: string;
  readonly today: boolean;
  readonly teams: Map<
    string,
    { readonly team: TransactionMoveView["team"]; readonly moves: Array<TransactionMoveView> }
  >;
};

function confirmationMessage(
  outcome: TransactionMoveConfirmationData,
  target: ConfirmationTarget,
): string {
  if (outcome.status === "refused") {
    return outcome.refusals.map((entry) => entry.detail).join(" ");
  }
  const parts: Array<string> = [];
  const effect =
    target.effectiveDate === undefined
      ? undefined
      : `It takes effect ${formatCalendarDate(target.effectiveDate)}.`;
  if (outcome.counts.moves === 0) {
    if (target.today) {
      parts.push(`Submitted ${moveCount(outcome.confirmed.length)}.`);
    } else {
      const when =
        target.sendsAt === undefined
          ? target.runDay === undefined
            ? "on its scheduled day"
            : `on ${formatCalendarDate(target.runDay)}`
          : plannedMoment(target.sendsAt);
      parts.push(
        withPeriod(
          target.claim
            ? `Scheduled ${moveCount(outcome.confirmed.length)} to send ${when}`
            : `Scheduled ${moveCount(outcome.confirmed.length)} to run ${when}`,
        ),
      );
    }
  } else {
    parts.push(`Ran ${moveCount(outcome.counts.moves)}.`);
  }
  if (effect !== undefined && !target.claim) {
    parts.push(effect);
  }
  if (outcome.counts.pending > 0) {
    parts.push(`${moveCount(outcome.counts.pending)} with the league.`);
  }
  if (outcome.counts.failed > 0) {
    parts.push(`${moveCount(outcome.counts.failed)} failed.`);
  }
  if (outcome.counts.unknown > 0) {
    parts.push(`${moveCount(outcome.counts.unknown)} has an unknown outcome.`);
  }
  for (const refusal of outcome.refusals) {
    parts.push(refusal.detail);
  }
  return parts.join(" ");
}

export type TransactionsPageController = {
  readonly days: Accessor<ReadonlyArray<TransactionMoveDayView>>;
  readonly counts: Accessor<{
    readonly open: number;
    readonly today: number;
    readonly saved: number;
    readonly ended: number;
  }>;
  readonly teamCount: Accessor<number>;
  readonly teamFacts: Accessor<ReadonlyMap<string, TransactionTeamFactsView>>;
  readonly groups: Accessor<ReadonlyArray<TransactionPlanGroupView>>;
  readonly canConfirm: (move: TransactionMoveView) => boolean;
  readonly reportConfirmation: (
    outcome: TransactionMoveConfirmationData,
    target: ConfirmationTarget,
  ) => void;
  readonly reportConfirmationFailure: (error: unknown) => void;
  readonly confirmationSettled: () => void;
  readonly discardMove: (move: TransactionMoveView) => void;
  readonly discarding: () => string | undefined;
  readonly addFixes: (move: TransactionMoveView) => void;
  readonly addingFixes: () => string | undefined;
  readonly retryMove: (move: TransactionMoveView) => void;
  readonly retryingMove: () => string | undefined;
  readonly discardGroup: (move: TransactionMoveView) => void;
  readonly discardingGroup: () => string | undefined;
  readonly startEdit: (move: TransactionMoveView) => void;
  readonly cancelEdit: () => void;
  readonly saveEdit: (move: TransactionMoveView) => void;
  readonly editing: Accessor<string | undefined>;
  readonly editingDate: Accessor<string>;
  readonly setEditingDate: (value: string) => void;
  readonly editingError: Accessor<string | undefined>;
  readonly saving: () => boolean;
  readonly isLoading: () => boolean;
  readonly failure: () => Error | null;
  readonly retry: () => Promise<void>;
  readonly signIn: RecoveryAction;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly hasMoreOpen: () => boolean;
  readonly fetchingMoreOpen: () => boolean;
  readonly showMoreOpen: () => void;
  readonly earlier: Accessor<ReadonlyArray<TransactionMoveView>>;
  readonly earlierCount: () => number;
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
