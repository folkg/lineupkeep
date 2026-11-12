import { useInfiniteQuery, useMutation } from "@tanstack/solid-query";
import { createEffect, createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState, RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";
import type {
  DismissTransactionProposalData,
  DismissTransactionProposalRequest,
  TransactionProposalItemView,
  TransactionProposalListData,
  TransactionProposalSetSummaryView,
} from "#contracts/connections/transactionContract.ts";

import { describeTransactionDismissalFailure } from "./transactionFailure";
import { transactionMutations } from "./transactionMutations";
import { transactionQueries } from "./transactionQueries";
import type { TransactionProposalListQueryOptions } from "./transactionQueries";
import type { TransactionRemote } from "./transactionRemote";

export const openPlansTitleId = "open-plans-title";

export function useTransactionsPage(props: TransactionsPageOptions): TransactionsPageController {
  const openQuery = (): TransactionProposalListQueryOptions =>
    transactionQueries.list(props.remote(), { team: props.teamId(), state: "open" });
  const historyQuery = (): TransactionProposalListQueryOptions =>
    transactionQueries.list(props.remote(), { team: props.teamId(), state: "closed" });
  const open = useInfiniteQuery(() => openQuery());
  const signIn = useSignInRecovery();
  const [historyEnabled, setHistoryEnabled] = createSignal(false);
  const history = useInfiniteQuery(() => ({
    ...historyQuery(),
    enabled: historyEnabled(),
  }));
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [dismissFailures, setDismissFailures] = createSignal<ReadonlyMap<string, string>>(
    new Map(),
  );
  const [dismissFocus, setDismissFocus] = createSignal<DismissFocus>();
  let dismissedLabel = "";
  let dismissedFocusItem: string | undefined;
  let dismissedShouldRefocus = false;

  createEffect(
    () => ({ request: dismissFocus(), data: open.data }),
    ({ request }) => {
      if (request === undefined) {
        return;
      }
      const buttons = [...document.querySelectorAll<HTMLElement>("[data-dismiss-item]")];
      const target =
        (request.item === undefined
          ? undefined
          : buttons.find((button) => button.dataset["dismissItem"] === request.item)) ??
        document.getElementById(openPlansTitleId);
      target?.focus();
      setDismissFocus(undefined);
    },
  );

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
        if (dismissedFocusItem !== undefined || dismissedShouldRefocus) {
          setDismissFocus({ item: dismissedFocusItem });
        }
        void open.refetch();
        if (history.isFetched) {
          void history.refetch();
        }
      },
      onError: (error: Error, variables: DismissTransactionProposalRequest) => {
        const failure = describeTransactionDismissalFailure(error);
        setDismissFailures((current) => {
          const next = new Map(current);
          for (const item of variables.items) {
            next.set(item, failure.message);
          }
          return next;
        });
        setFeedback({
          type: "attention",
          message: failure.message,
          ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
        });
        if (failure.kind === "conflict") {
          void open.refetch();
          if (history.isFetched) {
            void history.refetch();
          }
        }
      },
    };
  });

  const openPlans = createMemo<ReadonlyArray<TransactionProposalSetSummaryView>>(() =>
    open.isSuccess ? open.data.pages.flatMap((page) => page.sets).filter(hasOpenItem) : [],
  );
  const historyPlans = createMemo<ReadonlyArray<TransactionProposalSetSummaryView>>(() =>
    history.isSuccess ? history.data.pages.flatMap((page) => page.sets) : [],
  );
  const team = createMemo(() =>
    open.isSuccess
      ? open.data.pages[0]?.team
      : history.isSuccess
        ? history.data.pages[0]?.team
        : undefined,
  );
  const openPage = createMemo<TransactionProposalListData["page"] | undefined>(() =>
    open.isSuccess ? open.data.pages[open.data.pages.length - 1]?.page : undefined,
  );
  const historyPage = createMemo<TransactionProposalListData["page"] | undefined>(() =>
    history.isSuccess ? history.data.pages[history.data.pages.length - 1]?.page : undefined,
  );

  const dismissItem = (plan: string, item: TransactionProposalItemView, label: string): void => {
    if (dismiss.isPending) {
      return;
    }
    const buttons = [...document.querySelectorAll<HTMLElement>("[data-dismiss-item]")];
    const index = buttons.findIndex((button) => button.dataset["dismissItem"] === item.id);
    dismissedLabel = label;
    dismissedShouldRefocus = index >= 0 && document.activeElement === buttons[index];
    dismissedFocusItem = dismissedShouldRefocus
      ? buttons[index + 1]?.dataset["dismissItem"]
      : undefined;
    setFeedback(undefined);
    void dismiss.mutate({ set: plan, items: [item.id] });
  };

  const showMoreOpen = (): void => {
    if (!open.isFetchingNextPage && open.hasNextPage) {
      void open.fetchNextPage();
    }
  };

  const showMoreHistory = (): void => {
    if (!history.isFetchingNextPage && history.hasNextPage) {
      void history.fetchNextPage();
    }
  };

  return {
    team,
    openPlans,
    openPage,
    hasMoreOpen: () => open.hasNextPage,
    fetchingMoreOpen: () => open.isFetchingNextPage,
    showMoreOpen,
    historyEnabled,
    toggleHistory: () => setHistoryEnabled((current) => !current),
    historyPlans,
    historyPage,
    historyLoading: () => history.isPending,
    historyFailure: () => history.error,
    retryHistory: () => history.refetch().then(() => undefined),
    hasMoreHistory: () => history.hasNextPage,
    fetchingMoreHistory: () => history.isFetchingNextPage,
    showMoreHistory,
    isLoading: () => open.isPending,
    failure: () => open.error,
    retry: () => open.refetch().then(() => undefined),
    signIn,
    dismissItem,
    dismissing: () => (dismiss.isPending ? dismiss.variables?.items[0] : undefined),
    dismissFailure: (item: string) => dismissFailures().get(item),
    feedback,
  };
}

function hasOpenItem(plan: TransactionProposalSetSummaryView): boolean {
  return plan.teams.some((team) => team.items.some((item) => !item.settled));
}

type DismissFocus = {
  readonly item: string | undefined;
};

type TransactionsPageOptions = {
  readonly teamId: Accessor<string>;
  readonly remote: Accessor<TransactionRemote>;
};

export type TransactionsPageController = {
  readonly team: Accessor<TransactionProposalListData["team"] | undefined>;
  readonly openPlans: Accessor<ReadonlyArray<TransactionProposalSetSummaryView>>;
  readonly openPage: Accessor<TransactionProposalListData["page"] | undefined>;
  readonly hasMoreOpen: () => boolean;
  readonly fetchingMoreOpen: () => boolean;
  readonly showMoreOpen: () => void;
  readonly historyEnabled: Accessor<boolean>;
  readonly toggleHistory: () => void;
  readonly historyPlans: Accessor<ReadonlyArray<TransactionProposalSetSummaryView>>;
  readonly historyPage: Accessor<TransactionProposalListData["page"] | undefined>;
  readonly historyLoading: () => boolean;
  readonly historyFailure: () => Error | null;
  readonly retryHistory: () => Promise<void>;
  readonly hasMoreHistory: () => boolean;
  readonly fetchingMoreHistory: () => boolean;
  readonly showMoreHistory: () => void;
  readonly isLoading: () => boolean;
  readonly failure: () => Error | null;
  readonly retry: () => Promise<void>;
  readonly signIn: RecoveryAction;
  readonly dismissItem: (plan: string, item: TransactionProposalItemView, label: string) => void;
  readonly dismissing: Accessor<string | undefined>;
  readonly dismissFailure: (item: string) => string | undefined;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
};
