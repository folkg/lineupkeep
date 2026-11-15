import { useInfiniteQuery, useMutation } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";
import { createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState, RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";
import { formatCalendarDate } from "#browser/shared-ui/formatTime.ts";
import type {
  TransactionMoveActionData,
  TransactionMoveConfirmationData,
  TransactionMoveTeamDayView,
  TransactionMoveView,
  TransactionPlanGroupView,
  TransactionTeamFactsView,
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
  const [confirmKeys, setConfirmKeys] = createSignal<Readonly<Record<string, string>>>({});
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
  const teamFacts = createMemo(() => {
    const held = new Map<string, TransactionTeamFactsView>();
    for (const data of open.isSuccess ? open.data.pages : []) {
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
      openMoves().filter(
        (move) =>
          !todayIds.has(move.move) && (move.decision === "saved" || move.decision === "confirmed"),
      ),
    );
  });
  const pendingTodayCount = createMemo(
    () => todayMoves().filter((move) => isPending(move) && move.result === undefined).length,
  );

  const refresh = (): void => {
    void open.refetch();
    if (earlier.isFetched) {
      void earlier.refetch();
    }
  };

  const confirm = useMutation(() => ({
    mutationKey: ["transactions", "confirm"],
    mutationFn: (input: { readonly move: TransactionMoveView; readonly key: string }) =>
      props.remote().confirm({
        team: input.move.team.id,
        moves: [input.move.move],
        key: input.key,
      }),
    onSuccess: (
      outcome: TransactionMoveConfirmationData,
      input: { readonly move: TransactionMoveView; readonly key: string },
    ) => {
      if (outcome.status === "refused") {
        setFeedback({
          type: "attention",
          message: outcome.refusals.map((entry) => entry.detail).join(" "),
        });
      } else {
        setFeedback({
          type: outcome.counts.failed > 0 || outcome.counts.unknown > 0 ? "attention" : "success",
          message: confirmationMessage(outcome),
        });
        setConfirmKeys((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([key]) => !key.startsWith(`${input.move.team.id}:`)),
          ),
        );
      }
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
          message: `Saved for ${formatCalendarDate(input.runDay)}. It waits in Today that day until you confirm it.`,
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

  const confirmMove = (move: TransactionMoveView): void => {
    if (!canConfirm(move) || confirm.isPending) {
      return;
    }
    setFeedback(undefined);
    const key = confirmKeys()[confirmationKey(move)] ?? crypto.randomUUID();
    setConfirmKeys((current) => ({ ...current, [confirmationKey(move)]: key }));
    void confirm.mutate({ move, key });
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
    if (!discard.isPending && !confirm.isPending) {
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
    teamFacts,
    groups,
    pendingTodayCount,
    canConfirm,
    confirmMove,
    confirming: () => (confirm.isPending ? confirm.variables?.move.move : undefined),
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

function canConfirm(move: TransactionMoveView): boolean {
  return move.validation.status === "current" && move.result === undefined;
}

function isPending(move: TransactionMoveView): boolean {
  return move.decision === "undecided" || move.decision === "saved";
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

function confirmationKey(move: TransactionMoveView): string {
  return `${move.team.id}:${move.move}`;
}

function compareMoveCards(left: TransactionMoveView, right: TransactionMoveView): number {
  return left.team.name.localeCompare(right.team.name) || left.position - right.position;
}

function confirmationMessage(outcome: TransactionMoveConfirmationData): string {
  if (outcome.status === "refused") {
    return outcome.refusals.map((entry) => entry.detail).join(" ");
  }
  const parts: Array<string> = [];
  if (outcome.counts.moves === 0) {
    parts.push(`Confirmed ${moveCount(outcome.confirmed.length)}. It runs on its day's check.`);
  } else {
    parts.push(`Confirmed and ran ${moveCount(outcome.counts.moves)}.`);
  }
  if (outcome.counts.pending > 0) {
    parts.push(`${moveCount(outcome.counts.pending)} waiting on the league.`);
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
  readonly teamFacts: Accessor<ReadonlyMap<string, TransactionTeamFactsView>>;
  readonly groups: Accessor<ReadonlyArray<TransactionPlanGroupView>>;
  readonly pendingTodayCount: () => number;
  readonly canConfirm: (move: TransactionMoveView) => boolean;
  readonly confirmMove: (move: TransactionMoveView) => void;
  readonly confirming: () => string | undefined;
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
