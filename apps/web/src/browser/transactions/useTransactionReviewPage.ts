import { useQuery } from "@tanstack/solid-query";
import { createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";
import type {
  TransactionReviewItemView,
  TransactionReviewTeamView,
  TransactionReviewView,
} from "#contracts/connections/transactionContract.ts";

import type { TransactionReviewQueryOptions } from "./transactionQueries";

export function useTransactionReviewPage(
  props: TransactionReviewPageOptions,
): TransactionReviewPageController {
  const review = useQuery(() => props.reviewQuery());
  const signIn = useSignInRecovery();
  const [excluded, setExcluded] = createSignal<ReadonlySet<string>>(new Set());

  const isItemIncluded = (item: TransactionReviewItemView): boolean =>
    item.staleness.status !== "stale" && !excluded().has(item.id);

  const toggleItem = (item: string, included: boolean): void => {
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
    return {
      review: data,
      teamsWithItems: data.teams.filter((team) => team.items.length > 0),
      quietTeams: data.teams.filter((team) => team.items.length === 0),
      total: items.length,
      staleCount: items.filter((item) => item.staleness.status === "stale").length,
      checkedAt: checkedTimes.sort((left, right) => right.localeCompare(left))[0],
      includedCount: included.length,
      includedWaivers: included.filter((item) => item.kind === "waiver_claim").length,
      includedFaab: included.reduce(
        (total, item) => total + (item.kind === "waiver_claim" ? (item.bid ?? 0) : 0),
        0,
      ),
    };
  });

  return {
    model,
    isItemIncluded,
    toggleItem,
    isLoading: () => review.isPending,
    failure: () => review.error,
    retry: () => review.refetch().then(() => undefined),
    signIn,
  };
}

export type TransactionReviewPageController = {
  readonly model: Accessor<TransactionReviewModel | undefined>;
  readonly isItemIncluded: (item: TransactionReviewItemView) => boolean;
  readonly toggleItem: (item: string, included: boolean) => void;
  readonly isLoading: Accessor<boolean>;
  readonly failure: Accessor<Error | null>;
  readonly retry: () => Promise<void>;
  readonly signIn: RecoveryAction;
};

export type TransactionReviewModel = {
  readonly review: TransactionReviewView;
  readonly teamsWithItems: ReadonlyArray<TransactionReviewTeamView>;
  readonly quietTeams: ReadonlyArray<TransactionReviewTeamView>;
  readonly total: number;
  readonly staleCount: number;
  readonly checkedAt: string | undefined;
  readonly includedCount: number;
  readonly includedWaivers: number;
  readonly includedFaab: number;
};

type TransactionReviewPageOptions = {
  readonly reviewQuery: Accessor<TransactionReviewQueryOptions>;
};
