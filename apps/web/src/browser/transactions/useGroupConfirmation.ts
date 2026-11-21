import { EffectArray } from "@lineupkeep/collections";
import { EffectOption } from "@lineupkeep/collections";
import { useMutation } from "@tanstack/solid-query";
import type { MutationFunctionContext } from "@tanstack/solid-query";
import { createSignal } from "solid-js";
import type { Accessor } from "solid-js";

import type {
  TransactionMoveConfirmationData,
  TransactionMoveView,
} from "#contracts/connections/transactionContract.ts";

import { transactionMutations } from "./transactionMutations";
import type { ConfirmGroupVariables } from "./transactionMutations";
import { transactionQueries } from "./transactionQueries";
import type { TransactionRemote } from "./transactionRemote";

export function useGroupConfirmation(input: {
  readonly team: Accessor<string>;
  readonly remote: Accessor<TransactionRemote>;
  readonly page: Accessor<GroupConfirmationPage>;
  readonly today: Accessor<boolean>;
}): GroupConfirmation {
  const [key, setKey] = createSignal<string>();
  const confirm = useMutation(() => ({
    ...transactionMutations.confirmGroup(input.remote(), input.team()),
    onSuccess: (outcome: TransactionMoveConfirmationData, variables: ConfirmGroupVariables) => {
      input.page().reportConfirmation(outcome, variables);
      setKey(undefined);
    },
    onError: (error: Error) => {
      input.page().reportConfirmationFailure(error);
    },
    onSettled: (
      _data: TransactionMoveConfirmationData | undefined,
      _error: Error | null,
      _variables: ConfirmGroupVariables,
      _onMutateResult: unknown,
      context: MutationFunctionContext,
    ) => {
      void context.client.invalidateQueries({
        queryKey: transactionQueries.openCountKey,
        refetchType: "none",
      });
      input.page().confirmationSettled();
    },
  }));

  const start = (moves: ReadonlyArray<TransactionMoveView>): void => {
    if (confirm.isPending || !EffectArray.every(moves, canConfirm)) {
      return;
    }
    const held = key() ?? crypto.randomUUID();
    setKey(held);
    void confirm.mutate({
      moves: EffectArray.map(moves, (move) => move.move),
      key: held,
      runDay: EffectOption.getOrUndefined(
        EffectArray.findFirst(moves, (move) => move.runDay !== undefined),
      )?.runDay,
      sendsAt: EffectOption.getOrUndefined(
        EffectArray.findFirst(moves, (move) => move.sendsAt !== undefined),
      )?.sendsAt,
      effectiveDate: EffectOption.getOrUndefined(
        EffectArray.findFirst(moves, (move) => move.effectiveDate !== undefined),
      )?.effectiveDate,
      today: input.today(),
      claim: EffectArray.some(
        moves,
        (move) => move.kind === "waiver_claim" || move.phase !== undefined,
      ),
    });
  };

  return {
    start,
    pending: () => confirm.isPending,
    pendingMoves: () => (confirm.isPending ? (confirm.variables?.moves ?? []) : []),
  };
}

function canConfirm(move: TransactionMoveView): boolean {
  return move.validation.status === "current" && move.result === undefined;
}

export type GroupConfirmation = {
  readonly start: (moves: ReadonlyArray<TransactionMoveView>) => void;
  readonly pending: () => boolean;
  readonly pendingMoves: () => ReadonlyArray<string>;
};

export type ConfirmationTarget = {
  readonly today: boolean;
  readonly runDay: string | undefined;
  readonly sendsAt: string | undefined;
  readonly effectiveDate: string | undefined;
  readonly claim: boolean;
};

type GroupConfirmationPage = {
  readonly reportConfirmation: (
    outcome: TransactionMoveConfirmationData,
    target: ConfirmationTarget,
  ) => void;
  readonly reportConfirmationFailure: (error: unknown) => void;
  readonly confirmationSettled: () => void;
};
