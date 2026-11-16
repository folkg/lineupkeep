import { mutationOptions } from "@tanstack/solid-query";

import type { TransactionMoveConfirmationData } from "#contracts/connections/transactionContract.ts";

import type { TransactionRemote } from "./transactionRemote";

export const transactionMutations = {
  confirmGroup: (remote: TransactionRemote, team: string) =>
    mutationOptions({
      mutationKey: ["transactions", "confirm", team],
      mutationFn: (input: ConfirmGroupVariables): Promise<TransactionMoveConfirmationData> =>
        remote.confirm({ team, moves: input.moves, key: input.key }),
    }),
};

export type ConfirmGroupVariables = {
  readonly moves: ReadonlyArray<string>;
  readonly key: string;
  readonly runDay: string | undefined;
};
