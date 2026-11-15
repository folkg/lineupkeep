import { useInfiniteQuery, useMutation } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";
import { createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState, RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";
import { formatCalendarDate } from "#browser/shared-ui/formatTime.ts";
import type {
  TransactionMoveActionData,
  TransactionMoveTeamDayView,
  TransactionMoveView,
  TransactionSubmitTodayData,
} from "#contracts/connections/transactionContract.ts";

import { moveCount } from "./transactionCopy";
import { describeTransactionActionFailure } from "./transactionFailure";
import { transactionQueries } from "./transactionQueries";
import type { TransactionRemote } from "./transactionRemote";

export function useTransactionsPage(props: TransactionsPageOptions): TransactionsPageController {
  const signIn = useSignInRecovery();
  const open = useInfiniteQuery(() => transactionQueries.timeline(props.remote()));
  const [earlierEnabled, setEarlierEnabled] = createSignal(false);
  const earlier = useInfiniteQuery(() => ({
    ...transactionQueries.list(props.remote(), { state: "ended" }),
    enabled: earlierEnabled(),
  }));
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [choices, setChoices] = createSignal<Readonly<Record<string, TodayChoice>>>({});
  const [editing, setEditing] = createSignal<string>();
  const [editingDate, setEditingDate] = createSignal("");
  const [editingError, setEditingError] = createSignal<string>();

  const openMoves = createMemo(() =>
    open.isSuccess ? open.data.pages.flatMap((page) => page.moves) : [],
  );
  const counts = createMemo(() => {
    const first = open.isSuccess ? open.data.pages[0] : undefined;
    return first?.counts ?? { open: 0, today: 0, saved: 0, ended: 0 };
  });
  const teamCount = createMemo(() => {
    const first = open.isSuccess ? open.data.pages[0] : undefined;
    return first?.teamCount ?? 0;
  });
  const todayMoves = createMemo(() => {
    const days = open.isSuccess ? open.data.pages.flatMap((page) => page.days) : [];
    return days
      .filter((day) => day.today)
      .flatMap((day) => day.teams.flatMap((team) => team.moves))
      .sort(compareMoveCards);
  });
  const todayTeams = createMemo(() => groupByTeam(todayMoves()));

  const savedTeams = createMemo(() => {
    const todayIds = new Set(todayMoves().map((move) => move.move));
    return groupByTeam(
      openMoves().filter((move) => !todayIds.has(move.move) && move.decision === "saved"),
    );
  });
  const undecidedTodayCount = createMemo(
    () => todayMoves().filter((move) => choices()[choiceKey(move)] === undefined).length,
  );
  const canSubmitToday = createMemo(
    () =>
      todayMoves().length > 0 &&
      todayMoves().every((move) => {
        const choice = choices()[choiceKey(move)];
        return choice === "discard" || (choice === "now" && move.validation.status === "current");
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
    mutationFn: (moves: ReadonlyArray<TransactionMoveView>) =>
      props.remote().submitToday({
        choices: moves.flatMap((move) => {
          const choice = choices()[choiceKey(move)];
          return choice === undefined ? [] : [{ team: move.team.id, move: move.move, choice }];
        }),
      }),
    onSuccess: (outcome: TransactionSubmitTodayData) => {
      setFeedback({
        type: outcome.refusals.length > 0 ? "attention" : "success",
        message: submissionMessage(outcome),
      });
      setChoices({});
      refresh();
    },
    onError: (error: Error) => {
      const failure = describeTransactionActionFailure(error);
      setFeedback({
        type: "attention",
        message: failure.message,
        ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
      });
      refresh();
    },
  }));

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
          message: `Saved for ${formatCalendarDate(input.runDay)}.`,
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

  const chooseToday = (move: TransactionMoveView, choice: TodayChoice): void => {
    if (submit.isPending) {
      return;
    }
    setFeedback(undefined);
    setChoices((current) => ({ ...current, [choiceKey(move)]: choice }));
  };

  const submitToday = (): void => {
    if (!canSubmitToday() || submit.isPending) {
      return;
    }
    setFeedback(undefined);
    void submit.mutate(todayMoves());
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
    if (!discard.isPending && !submit.isPending) {
      setFeedback(undefined);
      void discard.mutate(move);
    }
  };

  return {
    todayMoves,
    todayTeams,
    savedTeams,
    counts,
    teamCount,
    choiceFor: (move) => choices()[choiceKey(move)],
    chooseToday,
    undecidedTodayCount,
    canSubmitToday,
    submitToday,
    submitting: () => submit.isPending,
    discardMove,
    discarding: () => (discard.isPending ? discard.variables?.move : undefined),
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

function groupByTeam(
  moves: ReadonlyArray<TransactionMoveView>,
): ReadonlyArray<TransactionMoveTeamDayView> {
  const byTeam = new Map<
    string,
    { readonly team: TransactionMoveView["team"]; moves: Array<TransactionMoveView> }
  >();
  for (const move of moves) {
    const held = byTeam.get(move.team.id);
    if (held === undefined) {
      byTeam.set(move.team.id, { team: move.team, moves: [move] });
    } else {
      held.moves.push(move);
    }
  }
  return [...byTeam.values()]
    .sort((left, right) => left.team.name.localeCompare(right.team.name))
    .map((entry) => ({ team: entry.team, moves: entry.moves }));
}

function choiceKey(move: TransactionMoveView): string {
  return `${move.team.id}:${move.move}`;
}

function compareMoveCards(left: TransactionMoveView, right: TransactionMoveView): number {
  return left.team.name.localeCompare(right.team.name) || left.position - right.position;
}

function submissionMessage(outcome: TransactionSubmitTodayData): string {
  const parts: Array<string> = [];
  if (outcome.counts.moves > 0) {
    parts.push(`Submitted ${moveCount(outcome.counts.moves)}.`);
  }
  if (outcome.counts.pending > 0) {
    parts.push(`${moveCount(outcome.counts.pending)} waiting on the league.`);
  }
  if (outcome.discarded > 0) {
    parts.push(`Discarded ${moveCount(outcome.discarded)}.`);
  }
  for (const refusal of outcome.refusals) {
    parts.push(refusal.detail);
  }
  return parts.length === 0 ? "Nothing was submitted." : parts.join(" ");
}

export type TransactionsPageController = {
  readonly todayMoves: Accessor<ReadonlyArray<TransactionMoveView>>;
  readonly todayTeams: Accessor<ReadonlyArray<TransactionMoveTeamDayView>>;
  readonly savedTeams: Accessor<ReadonlyArray<TransactionMoveTeamDayView>>;
  readonly counts: Accessor<{
    readonly open: number;
    readonly today: number;
    readonly saved: number;
    readonly ended: number;
  }>;
  readonly teamCount: Accessor<number>;
  readonly choiceFor: (move: TransactionMoveView) => TodayChoice | undefined;
  readonly chooseToday: (move: TransactionMoveView, choice: TodayChoice) => void;
  readonly undecidedTodayCount: () => number;
  readonly canSubmitToday: () => boolean;
  readonly submitToday: () => void;
  readonly submitting: () => boolean;
  readonly discardMove: (move: TransactionMoveView) => void;
  readonly discarding: () => string | undefined;
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

type TodayChoice = "now" | "discard";
