import { Context, Effect, Schema } from "effect";
import type { DateTime } from "effect";

import type { UserId } from "#contexts/auth/User.ts";

import { FantasyLeague, FantasySport, TeamId } from "./FantasyTeam.ts";
import { CounterpartyRef, PlayerRef } from "./QueryValues.ts";

const LineupgradeId = Schema.Union([
  Schema.String.pipe(Schema.check(Schema.isUUID())),
  Schema.String.pipe(Schema.check(Schema.isULID())),
]);

export const TransactionMoveId = LineupgradeId.pipe(Schema.brand("TransactionMoveId"));
export type TransactionMoveId = typeof TransactionMoveId.Type;

export const TransactionMoveKind = Schema.Literals([
  "free_agent_add",
  "waiver_claim",
  "drop",
  "trade",
  "activate",
  "stash",
  "slot_move",
]);
export type TransactionMoveKind = typeof TransactionMoveKind.Type;

export const TransactionMoveDecision = Schema.Literals(["undecided", "saved", "now", "discarded"]);
export type TransactionMoveDecision = typeof TransactionMoveDecision.Type;

export const TransactionMoveValidationStatus = Schema.Literals([
  "unchecked",
  "current",
  "stale",
  "illegal",
]);
export type TransactionMoveValidationStatus = typeof TransactionMoveValidationStatus.Type;

export const TransactionMoveResult = Schema.Literals([
  "executed",
  "pending",
  "failed",
  "skipped",
  "unknown",
  "withdrawn",
  "expired",
]);
export type TransactionMoveResult = typeof TransactionMoveResult.Type;

const TransactionMoveClaimKind = Schema.Literals(["player", "place", "draft_pick"]);

export const TransactionMoveReadState = Schema.Literals(["open", "today", "saved", "ended"]);
export type TransactionMoveReadState = typeof TransactionMoveReadState.Type;

export const TransactionMoveTeam = Schema.Struct({
  id: TeamId,
  name: Schema.NonEmptyString,
  league: FantasyLeague,
  sport: FantasySport,
  season: Schema.Int.check(Schema.isGreaterThan(1900)),
});
export type TransactionMoveTeam = typeof TransactionMoveTeam.Type;

export const StoredMoveDate = Schema.String.pipe(
  Schema.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)),
);
export type StoredMoveDate = typeof StoredMoveDate.Type;

export const StoredMovePlayer = Schema.Struct({
  key: Schema.NonEmptyString,
  name: Schema.optional(Schema.NonEmptyString),
  position: Schema.optional(Schema.NonEmptyString),
  proTeam: Schema.optional(Schema.NonEmptyString),
  availability: Schema.optional(Schema.NonEmptyString),
});
export type StoredMovePlayer = typeof StoredMovePlayer.Type;

export const StoredMovePick = Schema.Struct({
  round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  sourceTeamKey: Schema.NonEmptyString,
  destinationTeamKey: Schema.NonEmptyString,
  sourceName: Schema.NonEmptyString,
  destinationName: Schema.NonEmptyString,
});
export type StoredMovePick = typeof StoredMovePick.Type;

export const StoredMoveSlot = Schema.Struct({
  playerKey: Schema.NonEmptyString,
  playerName: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.NonEmptyString,
});
export type StoredMoveSlot = typeof StoredMoveSlot.Type;

export const StoredMoveIntent = Schema.Struct({
  kind: Schema.Literals(["add", "activate", "stash"]),
  player: Schema.optional(StoredMovePlayer),
  to: Schema.optional(Schema.Literals(["active", "reserve"])),
});
export type StoredMoveIntent = typeof StoredMoveIntent.Type;

export const StoredMovePlacement = Schema.Struct({
  playerKey: Schema.NonEmptyString,
  playerName: Schema.optional(Schema.NonEmptyString),
  fromSlot: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.NonEmptyString,
  detail: Schema.NonEmptyString,
});
export type StoredMovePlacement = typeof StoredMovePlacement.Type;

export const StoredMoveValidationReason = Schema.Struct({
  code: Schema.NonEmptyString,
  playerKey: Schema.optional(Schema.NonEmptyString),
  detail: Schema.NonEmptyString,
});
export type StoredMoveValidationReason = typeof StoredMoveValidationReason.Type;

export const StoredMoveValidation = Schema.Struct({
  status: TransactionMoveValidationStatus,
  checkedAt: Schema.optional(Schema.DateTimeUtc),
  reasons: Schema.Array(StoredMoveValidationReason),
});
export type StoredMoveValidation = typeof StoredMoveValidation.Type;

export const StoredMoveClaim = Schema.Struct({
  kind: TransactionMoveClaimKind,
  key: Schema.NonEmptyString,
});
export type StoredMoveClaim = typeof StoredMoveClaim.Type;

export const TransactionMoveProvenance = Schema.Struct({
  kind: Schema.Literals(["user", "agent"]),
  reference: Schema.NonEmptyString,
  surface: Schema.Literals(["app", "mcp"]),
  client: Schema.optional(Schema.NonEmptyString),
});
export type TransactionMoveProvenance = typeof TransactionMoveProvenance.Type;

export const TransactionMoveCursor = Schema.Struct({
  runDay: Schema.NullOr(StoredMoveDate),
  team: TeamId,
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  move: TransactionMoveId,
});
export type TransactionMoveCursor = typeof TransactionMoveCursor.Type;

export const TransactionMovePageLimit = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(50),
);
export type TransactionMovePageLimit = typeof TransactionMovePageLimit.Type;

export function isOpenMove(move: {
  readonly decision: TransactionMoveDecision;
  readonly result?: TransactionMoveResult;
}): boolean {
  return (
    move.decision !== "discarded" &&
    move.result !== "executed" &&
    move.result !== "withdrawn" &&
    move.result !== "expired"
  );
}

export const TransactionMovePlayerView = Schema.Struct({
  name: Schema.optional(Schema.NonEmptyString),
  position: Schema.optional(Schema.NonEmptyString),
  proTeam: Schema.optional(Schema.NonEmptyString),
  availability: Schema.optional(Schema.NonEmptyString),
});
export type TransactionMovePlayerView = typeof TransactionMovePlayerView.Type;

export const TransactionMovePickView = Schema.Struct({
  round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  sourceName: Schema.NonEmptyString,
  destinationName: Schema.NonEmptyString,
});
export type TransactionMovePickView = typeof TransactionMovePickView.Type;

export const TransactionMoveValidationView = Schema.Struct({
  status: TransactionMoveValidationStatus,
  checkedAt: Schema.optional(Schema.DateTimeUtc),
  reasons: Schema.Array(
    Schema.Struct({
      code: Schema.NonEmptyString,
      detail: Schema.NonEmptyString,
    }),
  ),
});
export type TransactionMoveValidationView = typeof TransactionMoveValidationView.Type;

export const TransactionMoveCheckView = Schema.Union([
  Schema.Struct({ status: Schema.Literal("checked") }),
  Schema.Struct({ status: Schema.Literal("stored") }),
  Schema.Struct({ status: Schema.Literal("last_checked"), note: Schema.NonEmptyString }),
]);
export type TransactionMoveCheckView = typeof TransactionMoveCheckView.Type;

const TransactionMoveSlotView = Schema.Struct({
  playerName: Schema.optional(Schema.NonEmptyString),
  fromSlot: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.NonEmptyString,
});

const TransactionMoveIntentView = Schema.Struct({
  kind: Schema.Literals(["add", "activate", "stash"]),
  player: Schema.optional(TransactionMovePlayerView),
  to: Schema.optional(Schema.Literals(["active", "reserve"])),
});

const TransactionMovePlacementView = Schema.Struct({
  playerName: Schema.optional(Schema.NonEmptyString),
  fromSlot: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.NonEmptyString,
  detail: Schema.NonEmptyString,
});

export const TransactionMoveRead = Schema.Struct({
  move: TransactionMoveId,
  team: TransactionMoveTeam,
  group: Schema.optional(Schema.NonEmptyString),
  kind: TransactionMoveKind,
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  decision: TransactionMoveDecision,
  reason: Schema.NonEmptyString,
  adds: Schema.Array(TransactionMovePlayerView),
  fallbacks: Schema.Array(TransactionMovePlayerView),
  drops: Schema.Array(TransactionMovePlayerView),
  picks: Schema.Array(TransactionMovePickView),
  slotMove: Schema.optional(TransactionMoveSlotView),
  intent: Schema.optional(TransactionMoveIntentView),
  placement: Schema.optional(TransactionMovePlacementView),
  bid: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  runDay: Schema.optional(StoredMoveDate),
  effectiveDate: Schema.optional(StoredMoveDate),
  validation: TransactionMoveValidationView,
  check: TransactionMoveCheckView,
  result: Schema.optional(TransactionMoveResult),
});
export type TransactionMoveRead = typeof TransactionMoveRead.Type;

export const TransactionMoveDay = Schema.Struct({
  day: Schema.optional(StoredMoveDate),
  today: Schema.Boolean,
  teams: Schema.Array(
    Schema.Struct({
      team: TransactionMoveTeam,
      moves: Schema.Array(TransactionMoveRead),
    }),
  ),
});
export type TransactionMoveDay = typeof TransactionMoveDay.Type;

export const TransactionPlanDay = Schema.Struct({
  day: Schema.optional(StoredMoveDate),
  today: Schema.Boolean,
  moves: Schema.Array(TransactionMoveRead),
});
export type TransactionPlanDay = typeof TransactionPlanDay.Type;

export const TransactionPlanRead = Schema.Struct({
  team: TransactionMoveTeam,
  today: Schema.optional(StoredMoveDate),
  moves: Schema.Array(TransactionMoveRead),
  days: Schema.Array(TransactionPlanDay),
});
export type TransactionPlanRead = typeof TransactionPlanRead.Type;

export const TransactionMoveCounts = Schema.Struct({
  open: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  today: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  saved: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ended: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type TransactionMoveCounts = typeof TransactionMoveCounts.Type;

export const TransactionMoveTeamCounts = Schema.Struct({
  team: TeamId,
  open: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  today: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  saved: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  ended: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type TransactionMoveTeamCounts = typeof TransactionMoveTeamCounts.Type;

const TransactionPlanCounts = Schema.Struct({
  totals: TransactionMoveCounts,
  teams: Schema.Array(TransactionMoveTeamCounts),
  teamCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
type TransactionPlanCounts = typeof TransactionPlanCounts.Type;

export const TransactionMoveList = Schema.Struct({
  status: Schema.Literal("ok"),
  team: Schema.optional(TransactionMoveTeam),
  moves: Schema.Array(TransactionMoveRead),
  days: Schema.Array(TransactionMoveDay),
  counts: TransactionMoveCounts,
  teamCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  page: Schema.Struct({
    returned: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    complete: Schema.Boolean,
    next: Schema.optional(TransactionMoveCursor),
  }),
});
export type TransactionMoveList = typeof TransactionMoveList.Type;

export type TransactionMoveListInput = {
  readonly team?: TeamId;
  readonly state?: "today" | "saved" | "ended";
  readonly after?: TransactionMoveCursor;
  readonly limit?: TransactionMovePageLimit;
};

export type TransactionTimelineInput = {
  readonly after?: TransactionMoveCursor;
  readonly limit?: TransactionMovePageLimit;
};

export type TransactionPlanCountsInput = {
  readonly team?: TeamId;
};

export type TransactionPlanReadInput = {
  readonly team: TeamId;
};

export type TransactionPlanMoveDraft = {
  readonly move?: TransactionMoveId;
  readonly group?: string;
  readonly kind: TransactionMoveKind;
  readonly adds?: ReadonlyArray<string>;
  readonly fallbacks?: ReadonlyArray<string>;
  readonly drops?: ReadonlyArray<string>;
  readonly picks?: ReadonlyArray<StoredMovePick>;
  readonly slotMove?: { readonly player: string; readonly toSlot: string };
  readonly to?: "active" | "reserve";
  readonly player?: string;
  readonly counterparty?: string;
  readonly bid?: number;
  readonly reason: string;
  readonly runDay?: StoredMoveDate;
};

export type TransactionPlanProposeInput = {
  readonly team: TeamId;
  readonly proposedBy: TransactionMoveProvenance;
  readonly moves: ReadonlyArray<TransactionPlanMoveDraft>;
};

export type TransactionPlanRefMoveDraft = {
  readonly move?: TransactionMoveId;
  readonly group?: string;
  readonly kind: TransactionMoveKind;
  readonly adds?: ReadonlyArray<PlayerRef>;
  readonly fallbacks?: ReadonlyArray<PlayerRef>;
  readonly drops?: ReadonlyArray<PlayerRef>;
  readonly picks?: ReadonlyArray<{
    readonly round: number;
    readonly from: string;
    readonly to: string;
  }>;
  readonly slotMove?: { readonly player: PlayerRef; readonly toSlot: string };
  readonly to?: "active" | "reserve";
  readonly player?: PlayerRef;
  readonly counterparty?: CounterpartyRef;
  readonly bid?: number;
  readonly reason: string;
  readonly runDay?: StoredMoveDate;
};

export type TransactionPlanRefProposeInput = {
  readonly team: TeamId;
  readonly proposedBy: TransactionMoveProvenance;
  readonly moves: ReadonlyArray<TransactionPlanRefMoveDraft>;
};

export type TransactionPlanSaveInput = {
  readonly team: TeamId;
  readonly move: TransactionMoveId;
  readonly runDay: StoredMoveDate;
};

export type TransactionPlanEditInput = {
  readonly team: TeamId;
  readonly move: TransactionMoveId;
  readonly change: TransactionPlanMoveDraft;
};

export type TransactionPlanDiscardInput = {
  readonly team: TeamId;
  readonly move: TransactionMoveId;
};

export type TransactionPlanSubmitInput = {
  readonly team: TeamId;
};

type TransactionPlanTodayChoice = {
  readonly team: TeamId;
  readonly move: TransactionMoveId;
  readonly choice: "now" | "discard";
};

export type TransactionPlanTodayInput = {
  readonly choices: ReadonlyArray<TransactionPlanTodayChoice>;
};

export type TransactionPlanTodaySubmission = {
  readonly status: "submitted";
  readonly counts: TransactionPlanRunCounts;
  readonly discarded: number;
  readonly refusals: ReadonlyArray<TransactionPlanRunRefusal>;
};

export type TransactionPlanRunCounts = {
  readonly plans: number;
  readonly claimed: number;
  readonly busy: number;
  readonly recovered: number;
  readonly unavailable: number;
  readonly moves: number;
  readonly executed: number;
  readonly pending: number;
  readonly failed: number;
  readonly skipped: number;
  readonly unknown: number;
  readonly retry: number;
};

export type TransactionPlanRunRefusal = {
  readonly code: string;
  readonly team: TeamId;
  readonly detail: string;
  readonly moves: ReadonlyArray<TransactionMoveId>;
};

type TransactionPlanSubmission = {
  readonly team: TeamId;
  readonly today: StoredMoveDate;
  readonly counts: TransactionPlanRunCounts;
  readonly refusals: ReadonlyArray<TransactionPlanRunRefusal>;
  readonly plan: TransactionPlanView;
};

type TransactionPlanDueResult = {
  readonly at: DateTime.Utc;
  readonly counts: TransactionPlanRunCounts;
};

type TransactionPlanDecision = "now" | "saved" | "discarded";

type TransactionPlanRosterPlayer = {
  readonly key: string;
  readonly name: string;
  readonly positions: ReadonlyArray<string>;
  readonly slot: string | undefined;
  readonly injured: boolean;
  readonly editable: boolean;
};

export type TransactionPlanMoveView = {
  readonly move: TransactionMoveId;
  readonly group: string | undefined;
  readonly kind: TransactionMoveKind;
  readonly adds: ReadonlyArray<StoredMovePlayer>;
  readonly fallbacks: ReadonlyArray<StoredMovePlayer>;
  readonly drops: ReadonlyArray<StoredMovePlayer>;
  readonly picks: ReadonlyArray<StoredMovePick>;
  readonly slotMove: StoredMoveSlot | undefined;
  readonly intent: StoredMoveIntent | undefined;
  readonly counterpartyKey: string | undefined;
  readonly bid: number | undefined;
  readonly reason: string;
  readonly decision: TransactionPlanDecision;
  readonly runDay: StoredMoveDate | undefined;
  readonly effectiveDate: StoredMoveDate | undefined;
  readonly dueToday: boolean;
  readonly validation: StoredMoveValidation;
  readonly placement: StoredMovePlacement | undefined;
  readonly claims: ReadonlyArray<StoredMoveClaim>;
  readonly runPosition: number | undefined;
  readonly dependsOn: ReadonlyArray<TransactionMoveId>;
  readonly blockage: string | undefined;
  readonly projection: ReadonlyArray<TransactionPlanRosterPlayer>;
};

export type TransactionPlanView = {
  readonly team: TeamId;
  readonly today: StoredMoveDate;
  readonly moves: ReadonlyArray<TransactionPlanMoveView>;
  readonly groups: ReadonlyArray<TransactionPlanGroupEvaluation>;
};

type TransactionPlanGroupEvaluation = {
  readonly group: string | undefined;
  readonly moves: ReadonlyArray<TransactionMoveId>;
  readonly valid: boolean;
  readonly detail?: string;
};

export type TransactionPlanRefusal = {
  readonly code: string;
  readonly team: TeamId;
  readonly detail: string;
  readonly group?: string;
  readonly moves: ReadonlyArray<number>;
};

type TransactionPlanResult = {
  readonly plan: TransactionPlanView;
  readonly refused: ReadonlyArray<TransactionPlanRefusal>;
};

export class TransactionPlanFactsUnavailable extends Schema.TaggedError<
  TransactionPlanFactsUnavailable,
  { readonly brand: unique symbol }
>()("transaction_plan.facts_unavailable", {
  team: TeamId,
  detail: Schema.NonEmptyString,
}) {}

export class TransactionPlanRunInProgress extends Schema.TaggedError<
  TransactionPlanRunInProgress,
  { readonly brand: unique symbol }
>()("transaction_plan.run_in_progress", {
  team: TeamId,
  detail: Schema.NonEmptyString,
}) {}

export class TransactionPlanMoveNotFound extends Schema.TaggedError<
  TransactionPlanMoveNotFound,
  { readonly brand: unique symbol }
>()("transaction_plan.move_not_found", {
  team: TeamId,
  move: TransactionMoveId,
}) {}

export class TransactionPlanTeamNotFound extends Schema.TaggedError<
  TransactionPlanTeamNotFound,
  { readonly brand: unique symbol }
>()("transaction_plan.team_not_found", {
  team: TeamId,
}) {}

export class TransactionPlanPersistenceFailed extends Schema.TaggedError<
  TransactionPlanPersistenceFailed,
  { readonly brand: unique symbol }
>()("transaction_plan.persistence_failed", {
  cause: Schema.Defect(),
}) {}

export type TransactionPlanServiceError =
  | TransactionPlanFactsUnavailable
  | TransactionPlanMoveNotFound
  | TransactionPlanTeamNotFound
  | TransactionPlanRunInProgress
  | TransactionPlanPersistenceFailed;

export class TransactionPlanService extends Context.Service<
  TransactionPlanService,
  TransactionPlanServiceShape
>()("@lineupkeep/backend/contexts/connections/TransactionPlans/TransactionPlanService") {}

export type TransactionPlanServiceShape = {
  readonly propose: (
    userId: UserId,
    input: TransactionPlanProposeInput,
  ) => Effect.Effect<TransactionPlanResult, TransactionPlanServiceError>;

  readonly proposeRefs: (
    userId: UserId,
    input: TransactionPlanRefProposeInput,
  ) => Effect.Effect<TransactionPlanResult, TransactionPlanServiceError>;

  readonly save: (
    userId: UserId,
    input: TransactionPlanSaveInput,
  ) => Effect.Effect<TransactionPlanResult, TransactionPlanServiceError>;

  readonly edit: (
    userId: UserId,
    input: TransactionPlanEditInput,
  ) => Effect.Effect<TransactionPlanResult, TransactionPlanServiceError>;

  readonly discard: (
    userId: UserId,
    input: TransactionPlanDiscardInput,
  ) => Effect.Effect<TransactionPlanResult, TransactionPlanServiceError>;

  readonly submit: (
    userId: UserId,
    input: TransactionPlanSubmitInput,
  ) => Effect.Effect<TransactionPlanSubmission, TransactionPlanServiceError>;

  readonly submitToday: (
    userId: UserId,
    input: TransactionPlanTodayInput,
  ) => Effect.Effect<TransactionPlanTodaySubmission, TransactionPlanServiceError>;

  readonly runDue: (
    limit: number,
    at: DateTime.Utc,
  ) => Effect.Effect<TransactionPlanDueResult, TransactionPlanServiceError>;

  readonly timeline: (
    userId: UserId,
    input: TransactionTimelineInput,
  ) => Effect.Effect<TransactionMoveList, TransactionPlanServiceError>;

  readonly list: (
    userId: UserId,
    input: TransactionMoveListInput,
  ) => Effect.Effect<TransactionMoveList, TransactionPlanServiceError>;

  readonly plan: (
    userId: UserId,
    input: TransactionPlanReadInput,
  ) => Effect.Effect<TransactionPlanRead, TransactionPlanServiceError>;

  readonly counts: (
    userId: UserId,
    input: TransactionPlanCountsInput,
  ) => Effect.Effect<TransactionPlanCounts, TransactionPlanServiceError>;
};

const ProposeTransactionMoveInput = Schema.Struct({
  move: Schema.optional(TransactionMoveId).annotate({
    description: "A saved move in this team's queue to change in place; omit it to add a new move.",
  }),
  group: Schema.optional(Schema.NonEmptyString).annotate({
    description: "A label shared by moves that must run together, whole or not at all.",
  }),
  kind: TransactionMoveKind.annotate({
    description: "A drop adds nobody and carries no bid; a free-agent add cannot bid either.",
  }),
  adds: Schema.Array(PlayerRef).pipe(
    Schema.check(Schema.isMaxLength(10)),
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  fallbacks: Schema.optional(Schema.NullOr(Schema.Array(PlayerRef))).annotate({
    description: "Other players to try in order when the first cannot be added.",
  }),
  drops: Schema.Array(PlayerRef).pipe(
    Schema.check(Schema.isMaxLength(10)),
    Schema.withDecodingDefaultKey(Effect.succeed([])),
  ),
  picks: Schema.optional(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          round: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
          from: Schema.NonEmptyString,
          to: Schema.NonEmptyString,
        }),
      ).pipe(Schema.check(Schema.isMaxLength(20))),
    ),
  ),
  slotMove: Schema.optional(
    Schema.NullOr(Schema.Struct({ player: PlayerRef, toSlot: Schema.NonEmptyString })),
  ),
  to: Schema.optional(Schema.NullOr(Schema.Literals(["active", "reserve"]))),
  player: Schema.optional(Schema.NullOr(PlayerRef)),
  counterparty: Schema.optional(Schema.NullOr(CounterpartyRef)),
  bid: Schema.optional(Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)))),
  reason: Schema.NonEmptyString,
  window: Schema.optional(Schema.NullOr(StoredMoveDate)).annotate({
    description: "The fantasy day the move should run; omit it to run today.",
  }),
});

export const ProposeTransactionMovesInput = Schema.Struct({
  team: TeamId,
  moves: Schema.Array(ProposeTransactionMoveInput).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(20)),
  ),
  client: Schema.optional(Schema.NullOr(Schema.Trim.pipe(Schema.check(Schema.isMaxLength(60))))),
});
export type ProposeTransactionMovesInput = typeof ProposeTransactionMovesInput.Type;

export const ListTransactionMovesInput = Schema.Struct({
  team: Schema.optional(TeamId).annotate({
    description: "The owned team; omit it to list every owned team.",
  }),
  state: Schema.optional(Schema.Literals(["today", "saved", "ended"])).annotate({
    description: "`today`, `saved`, or `ended`; omit it for today.",
  }),
  after: Schema.optional(TransactionMoveCursor),
  limit: Schema.optional(TransactionMovePageLimit),
});
export type ListTransactionMovesInput = typeof ListTransactionMovesInput.Type;

export const TransactionPlanInput = Schema.Struct({ team: TeamId });
export type TransactionPlanInput = typeof TransactionPlanInput.Type;

export const SaveTransactionMoveInput = Schema.Struct({
  team: TeamId,
  move: TransactionMoveId,
  runDay: StoredMoveDate,
});
export type SaveTransactionMoveInput = typeof SaveTransactionMoveInput.Type;

export const DiscardTransactionMoveInput = Schema.Struct({
  team: TeamId,
  move: TransactionMoveId,
});
export type DiscardTransactionMoveInput = typeof DiscardTransactionMoveInput.Type;
