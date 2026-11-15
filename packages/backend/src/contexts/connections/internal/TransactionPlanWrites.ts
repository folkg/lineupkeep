import { Context } from "effect";
import type { Effect } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { TeamId } from "#contexts/connections/FantasyTeam.ts";

import type {
  StoredMoveIntent,
  StoredMovePick,
  StoredMovePlacement,
  StoredMoveSlot,
  StoredMoveStep,
  TransactionMoveId,
  TransactionMoveKind,
} from "./TransactionPlanRecord.ts";

export type TransactionPlanAction = Omit<StoredMoveStep, "decidedAt">;

type TransactionPlanWrote = {
  readonly actions: ReadonlyArray<TransactionPlanAction>;
};

export type TransactionPlanWriteResult =
  | (TransactionPlanWrote & { readonly status: "executed" })
  | (TransactionPlanWrote & { readonly status: "pending"; readonly detail: string })
  | (TransactionPlanWrote & { readonly status: "failed"; readonly detail: string })
  | (TransactionPlanWrote & { readonly status: "unknown"; readonly detail: string })
  | { readonly status: "retry"; readonly detail: string };

export type TransactionPlanWriteRequest = {
  readonly userId: UserId;
  readonly team: TeamId;
  readonly move: TransactionMoveId;
  readonly kind: TransactionMoveKind;
  readonly adds: ReadonlyArray<string>;
  readonly drops: ReadonlyArray<string>;
  readonly picks: ReadonlyArray<StoredMovePick>;
  readonly slotMove: StoredMoveSlot | undefined;
  readonly intent: StoredMoveIntent | undefined;
  readonly placement: StoredMovePlacement | undefined;
  readonly bid: number | undefined;
  readonly counterpartyKey: string | undefined;
};

export type TransactionPlanWritesShape = {
  readonly apply: (
    request: TransactionPlanWriteRequest,
  ) => Effect.Effect<TransactionPlanWriteResult>;
};

export class TransactionPlanWrites extends Context.Service<
  TransactionPlanWrites,
  TransactionPlanWritesShape
>()("@lineupkeep/backend/contexts/connections/internal/TransactionPlanWrites") {}
