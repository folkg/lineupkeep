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
    if (confirm.isPending || !moves.every(canConfirm)) {
      return;
    }
    const held = key() ?? crypto.randomUUID();
    setKey(held);
    void confirm.mutate({
      moves: moves.map((move) => move.move),
      key: held,
      runDay: moves.find((move) => move.runDay !== undefined)?.runDay,
      today: input.today(),
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
};

type GroupConfirmationPage = {
  readonly reportConfirmation: (
    outcome: TransactionMoveConfirmationData,
    target: ConfirmationTarget,
  ) => void;
  readonly reportConfirmationFailure: (error: unknown) => void;
  readonly confirmationSettled: () => void;
};
