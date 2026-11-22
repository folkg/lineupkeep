import { Context, Effect, Schema } from "effect";
import type { DateTime } from "effect";
import { Array as EffectArray } from "effect";

import { UserId } from "#contexts/auth/User.ts";

import { FantasyLeague, FantasySport, TeamId } from "./FantasyTeam.ts";
import {
  CounterpartyRef,
  PlayerRef,
  ReserveList,
  RosterBlocker,
  RosterFreeablePlace,
  RosterPlaces,
  WaiverBid,
} from "./QueryValues.ts";

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

export const TransactionMoveDecision = Schema.Literals([
  "undecided",
  "saved",
  "now",
  "confirmed",
  "discarded",
]);
export type TransactionMoveDecision = typeof TransactionMoveDecision.Type;

export const TransactionRunId = LineupgradeId.pipe(Schema.brand("TransactionRunId"));
export type TransactionRunId = typeof TransactionRunId.Type;

export const TransactionRunTrigger = Schema.Literals(["submit", "tick"]);
export type TransactionRunTrigger = typeof TransactionRunTrigger.Type;

export const TransactionDecisionActor = Schema.Literals(["owner", "agent", "system"]);
export type TransactionDecisionActor = typeof TransactionDecisionActor.Type;

export const TransactionDecisionSurface = Schema.NonEmptyString.pipe(
  Schema.check(Schema.isMaxLength(100)),
);
export type TransactionDecisionSurface = typeof TransactionDecisionSurface.Type;

export const TransactionDecision = Schema.Struct({
  decidedBy: TransactionDecisionActor,
  surface: TransactionDecisionSurface,
});
export type TransactionDecision = typeof TransactionDecision.Type;
const TransactionMoveConfirmation = Schema.Struct({
  by: UserId,
  at: Schema.DateTimeUtc,
});
type TransactionMoveConfirmation = typeof TransactionMoveConfirmation.Type;

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
]);
export type TransactionMoveResult = typeof TransactionMoveResult.Type;

const TransactionMoveStatuses = [
  "open_undecided",
  "open_saved",
  "open_now",
  "open_confirmed",
  "discarded",
  "ran_immediately",
  "ran_on_schedule",
  "claim_waiting",
  "claim_won",
  "claim_lost",
  "claim_lost_fallback_ran",
  "claim_lost_retrying",
  "all_choices_failed",
  "fallback_unknown",
  "offer_sent",
  "failed",
  "skipped",
  "unknown",
] as const;

export const TransactionMoveStatus = Schema.Literals(TransactionMoveStatuses);
export type TransactionMoveStatus = typeof TransactionMoveStatus.Type;

export const TransactionMovePhase = Schema.Literals(["with_league", "won", "lost"]);
export type TransactionMovePhase = typeof TransactionMovePhase.Type;

const TransactionMoveAttemptOutcome = Schema.Literals([
  "pending",
  "won",
  "lost",
  "executed",
  "failed",
  "unavailable",
  "unknown",
  "retry",
]);
type TransactionMoveAttemptOutcome = typeof TransactionMoveAttemptOutcome.Type;

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

export const StoredMoveAttempt = Schema.Struct({
  kind: Schema.Literals(["claim", "fallback"]),
  player: StoredMovePlayer,
  outcome: TransactionMoveAttemptOutcome,
  reason: Schema.NonEmptyString,
  at: Schema.DateTimeUtcFromString,
  effectiveDate: Schema.optional(StoredMoveDate),
});
export type StoredMoveAttempt = typeof StoredMoveAttempt.Type;

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
  readonly phase?: TransactionMovePhase;
}): boolean {
  return move.decision !== "discarded" && move.phase === undefined && move.result !== "executed";
}

export function transactionMoveStatus(move: {
  readonly decision: TransactionMoveDecision;
  readonly kind: TransactionMoveKind;
  readonly phase?: TransactionMovePhase;
  readonly result?: TransactionMoveResult;
  readonly runDecidedBy?: TransactionDecisionActor;
  readonly attempts: ReadonlyArray<{ readonly kind: "claim" | "fallback" }>;
}): TransactionMoveStatus {
  if (move.decision === "discarded") {
    return "discarded";
  }
  switch (move.phase) {
    case "with_league":
      return "claim_waiting";
    case "won":
      return "claim_won";
    case "lost":
      switch (move.result) {
        case "executed":
          return "claim_lost_fallback_ran";
        case "pending":
          return "claim_lost_retrying";
        case "unknown":
          return "fallback_unknown";
        case "failed":
          return EffectArray.some(move.attempts, (attempt) => attempt.kind === "fallback")
            ? "all_choices_failed"
            : "claim_lost";
        case "skipped":
          return "skipped";
        case undefined:
          return "claim_lost";
      }
      break;
    case undefined:
      break;
  }
  switch (move.result) {
    case "executed":
      return move.runDecidedBy === "system" ? "ran_on_schedule" : "ran_immediately";
    case "pending":
      if (move.kind === "trade") {
        return "offer_sent";
      }
      throw new Error("Only a waiver claim or a trade offer can wait without a claim phase");
    case "failed":
      return "failed";
    case "skipped":
      return "skipped";
    case "unknown":
      return "unknown";
    case undefined:
      switch (move.decision) {
        case "undecided":
          return "open_undecided";
        case "saved":
          return "open_saved";
        case "now":
          return "open_now";
        case "confirmed":
          return "open_confirmed";
      }
  }
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

export const TransactionMoveAttemptView = Schema.Struct({
  kind: Schema.Literals(["claim", "fallback"]),
  player: TransactionMovePlayerView,
  outcome: TransactionMoveAttemptOutcome,
  reason: Schema.NonEmptyString,
  at: Schema.DateTimeUtc,
  effectiveDate: Schema.optional(StoredMoveDate),
});
export type TransactionMoveAttemptView = typeof TransactionMoveAttemptView.Type;

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
  status: TransactionMoveStatus.pipe(
    Schema.annotate({
      description: "The move's lifecycle state.",
    }),
  ),
  phase: Schema.optional(TransactionMovePhase).pipe(
    Schema.annotate({
      description: "The claim phase.",
    }),
  ),
  attempts: Schema.Array(TransactionMoveAttemptView).pipe(
    Schema.annotate({
      description: "Claims and fallbacks tried.",
    }),
  ),
  reason: Schema.NonEmptyString,
  adds: Schema.Array(TransactionMovePlayerView),
  fallbacks: Schema.Array(TransactionMovePlayerView),
  drops: Schema.Array(TransactionMovePlayerView),
  picks: Schema.Array(TransactionMovePickView),
  slotMove: Schema.optional(TransactionMoveSlotView),
  intent: Schema.optional(TransactionMoveIntentView),
  placement: Schema.optional(TransactionMovePlacementView),
  bid: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  runDay: Schema.optional(StoredMoveDate).pipe(
    Schema.annotate({
      description: "The day it is sent, not applied.",
    }),
  ),
  effectiveDate: Schema.optional(StoredMoveDate).pipe(
    Schema.annotate({
      description: "The day the league applies it.",
    }),
  ),
  sendsAt: Schema.optional(Schema.DateTimeUtc).pipe(
    Schema.annotate({
      description: "The check that sends a future move.",
    }),
  ),
  decidedAt: Schema.optional(Schema.DateTimeUtc),
  confirmation: Schema.optional(TransactionMoveConfirmation),
  runAt: Schema.optional(Schema.DateTimeUtc),
  runDecidedBy: Schema.optional(TransactionDecisionActor).pipe(
    Schema.annotate({
      description: "Who started the satisfying run.",
    }),
  ),
  runSurface: Schema.optional(TransactionDecisionSurface).pipe(
    Schema.annotate({
      description: "What started the satisfying run.",
    }),
  ),
  decidedBy: Schema.optional(TransactionDecisionActor).pipe(
    Schema.annotate({
      description: "Who made the current decision.",
    }),
  ),
  surface: Schema.optional(TransactionDecisionSurface).pipe(
    Schema.annotate({ description: "What made the current decision." }),
  ),
  validation: TransactionMoveValidationView,
  check: TransactionMoveCheckView,
  result: Schema.optional(TransactionMoveResult),
  resultDetail: Schema.optional(Schema.NonEmptyString),
  resultAt: Schema.optional(Schema.DateTimeUtc),
});
export type TransactionMoveRead = typeof TransactionMoveRead.Type;

export const TransactionMoveDay = Schema.Struct({
  day: Schema.optional(StoredMoveDate),
  groupedBy: Schema.Literal("runDay").pipe(
    Schema.annotate({
      description: "Groups use the run day.",
    }),
  ),
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
  groupedBy: Schema.Literal("runDay").pipe(
    Schema.annotate({
      description: "Groups use the run day.",
    }),
  ),
  today: Schema.Boolean,
  moves: Schema.Array(TransactionMoveRead),
});
export type TransactionPlanDay = typeof TransactionPlanDay.Type;

export const TransactionPlanGroupAction = Schema.Struct({
  move: TransactionMoveId,
  action: Schema.Literals(["add", "drop", "reserve_move", "slot_move"]),
  player: Schema.optional(Schema.NonEmptyString),
  fromSlot: Schema.optional(Schema.NonEmptyString),
  toSlot: Schema.optional(Schema.NonEmptyString),
  outcome: Schema.Literals(["executed", "pending", "failed", "skipped", "unknown"]),
  detail: Schema.optional(Schema.NonEmptyString),
});
export type TransactionPlanGroupAction = typeof TransactionPlanGroupAction.Type;

export const TransactionPlanGroupStatus = Schema.Literals([
  "ready",
  "blocked",
  "partly_done",
  "done",
  "failed",
]);
export type TransactionPlanGroupStatus = typeof TransactionPlanGroupStatus.Type;

export const TransactionPlanGroupRead = Schema.Struct({
  group: Schema.NonEmptyString,
  team: TeamId,
  label: Schema.optional(Schema.NonEmptyString),
  status: TransactionPlanGroupStatus,
  moves: Schema.Array(TransactionMoveId),
  fixesFor: Schema.optional(TransactionMoveId),
  actions: Schema.Array(TransactionPlanGroupAction),
  failed: Schema.optional(TransactionPlanGroupAction),
  notRun: Schema.Array(TransactionMoveId),
  detail: Schema.NonEmptyString,
  cure: Schema.optional(Schema.NonEmptyString),
});
export type TransactionPlanGroupRead = typeof TransactionPlanGroupRead.Type;

export const TransactionWaiverRule = Schema.Struct({
  rule: Schema.optional(Schema.NonEmptyString),
  type: Schema.optional(Schema.NonEmptyString),
  days: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});
export type TransactionWaiverRule = typeof TransactionWaiverRule.Type;

const TransactionTeamFacts = Schema.Struct({
  team: TeamId,
  places: RosterPlaces,
  reserve: Schema.Array(ReserveList),
  waiver: Schema.optional(TransactionWaiverRule),
});

export const TransactionWaiverBid = WaiverBid;
export type TransactionWaiverBid = typeof TransactionWaiverBid.Type;

export const TransactionPlanSnapshot = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("live"),
    checkedAt: Schema.DateTimeUtc,
    source: Schema.NonEmptyString,
  }).pipe(
    Schema.annotate({
      description:
        "The live roster and league rules read that produced `places` and `reserve`, with the coverage its source names.",
    }),
  ),
  Schema.Struct({
    status: Schema.Literal("stored"),
    checkedAt: Schema.DateTimeUtc,
    note: Schema.NonEmptyString,
  }).pipe(
    Schema.annotate({
      description:
        "The live facts could not be read, so the moves show their most recent recorded check at this time.",
    }),
  ),
  Schema.Struct({ status: Schema.Literal("unavailable"), note: Schema.NonEmptyString }).pipe(
    Schema.annotate({
      description: "The live facts could not be read and no move carries a recorded check.",
    }),
  ),
]);
export type TransactionPlanSnapshot = typeof TransactionPlanSnapshot.Type;

export const TransactionPlanRead = Schema.Struct({
  team: TransactionMoveTeam,
  today: Schema.optional(StoredMoveDate),
  nextCheckAt: Schema.DateTimeUtc.pipe(
    Schema.annotate({
      description: "The exact next hourly check. A future move states its own `sendsAt`.",
    }),
  ),
  snapshot: TransactionPlanSnapshot.pipe(
    Schema.annotate({
      description:
        "The roster and league snapshot that produced `places` and `reserve`, or the last recorded check when the live read failed.",
    }),
  ),
  waiverBid: Schema.optional(TransactionWaiverBid).pipe(
    Schema.annotate({
      description:
        "The league's waiver bid shape: `published` with this team's remaining FAAB, or `bidless`. Absent when the league and roster could not be read.",
    }),
  ),
  waiver: Schema.optional(TransactionWaiverRule).pipe(
    Schema.annotate({
      description: "The league's own waiver rule, type, and days.",
    }),
  ),
  places: Schema.optional(RosterPlaces).pipe(
    Schema.annotate({
      description:
        "Starting and bench places used, the league's maximum, and the free places. Absent when the team's roster and league rules could not be read.",
    }),
  ),
  reserve: Schema.optional(Schema.Array(ReserveList)).pipe(
    Schema.annotate({
      description:
        "Each reserve list by the league's own name with its own capacity, occupancy, and free places. Absent when the roster could not be read; a league with no reserve lists publishes none.",
    }),
  ),
  addsPossible: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).pipe(
    Schema.annotate({
      description:
        "Open roster places now, not the weekly add allowance: free active plus free reserve places. Use `acquisitionUsage` for adds remaining; zero means a drop or reserve place is needed.",
    }),
  ),
  addsWithFixes: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))).pipe(
    Schema.annotate({
      description:
        "How many adds fit after the published freeable moves: `addsPossible` plus `canFree`.",
    }),
  ),
  canFree: Schema.optional(Schema.Array(RosterFreeablePlace)).pipe(
    Schema.annotate({
      description:
        "Each player who can move to a reserve list that accepts them now, with the list and the active place it frees.",
    }),
  ),
  illegal: Schema.optional(Schema.Array(RosterBlocker)).pipe(
    Schema.annotate({
      description:
        "Each player whose place the league does not accept, with the fact and the plain cure. Adds and drops stay blocked until every blocker is cured.",
    }),
  ),
  moves: Schema.Array(TransactionMoveRead),
  days: Schema.Array(TransactionPlanDay),
  groups: Schema.Array(TransactionPlanGroupRead).pipe(
    Schema.annotate({
      description:
        "Each group of moves that run together in run order, with its status, recorded actions, failed action, members that did not run, and a plain sentence. A group that ran in part is never done.",
    }),
  ),
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
  nextCheckAt: Schema.DateTimeUtc.pipe(
    Schema.annotate({
      description: "The exact next hourly check. A future move states its own `sendsAt`.",
    }),
  ),
  moves: Schema.Array(TransactionMoveRead),
  days: Schema.Array(TransactionMoveDay),
  teamFacts: Schema.Array(TransactionTeamFacts).pipe(
    Schema.annotate({
      description:
        "Places and reserve lists for each team whose current state was read with the moves on this page. A team whose state could not be read is absent.",
    }),
  ),
  counts: TransactionMoveCounts,
  teamCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  groups: Schema.Array(TransactionPlanGroupRead).pipe(
    Schema.annotate({
      description:
        "Each group among this page's moves, with its members in run order, its status, its recorded actions, and a plain sentence.",
    }),
  ),
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
  readonly decision?: TransactionDecision;
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
  readonly decision?: TransactionDecision;
  readonly moves: ReadonlyArray<TransactionPlanRefMoveDraft>;
};

export type TransactionPlanSaveInput = {
  readonly team: TeamId;
  readonly move: TransactionMoveId;
  readonly runDay: StoredMoveDate;
  readonly decision?: TransactionDecision;
};

export type TransactionPlanEditInput = {
  readonly team: TeamId;
  readonly move: TransactionMoveId;
  readonly change: TransactionPlanMoveDraft;
  readonly decision?: TransactionDecision;
};

export type TransactionPlanDiscardInput = {
  readonly team: TeamId;
  readonly move: TransactionMoveId;
  readonly decision?: TransactionDecision;
};

export type TransactionPlanDiscardGroupInput = {
  readonly team: TeamId;
  readonly move: TransactionMoveId;
  readonly decision?: TransactionDecision;
};

export type TransactionPlanFixInput = {
  readonly team: TeamId;
  readonly move: TransactionMoveId;
  readonly decision?: TransactionDecision;
};

export type TransactionPlanRetryInput = {
  readonly team: TeamId;
  readonly move: TransactionMoveId;
  readonly key: string;
  readonly decision?: TransactionDecision;
};

export type TransactionPlanSubmitInput = {
  readonly team: TeamId;
  readonly key: string;
  readonly decision?: TransactionDecision;
};

export type TransactionPlanConfirmInput = {
  readonly team: TeamId;
  readonly moves: ReadonlyArray<TransactionMoveId>;
  readonly key: string;
  readonly decision?: TransactionDecision;
};

export const TransactionPlanRunCounts = Schema.Struct({
  plans: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  claimed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  busy: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  recovered: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  unavailable: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  moves: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  executed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  pending: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  failed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  skipped: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  unknown: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  retry: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type TransactionPlanRunCounts = typeof TransactionPlanRunCounts.Type;

export const TransactionPlanRunRefusal = Schema.Struct({
  code: Schema.NonEmptyString,
  team: TeamId,
  detail: Schema.NonEmptyString,
  moves: Schema.Array(TransactionMoveId),
});
export type TransactionPlanRunRefusal = typeof TransactionPlanRunRefusal.Type;

export type TransactionPlanSubmission = {
  readonly team: TeamId;
  readonly today: StoredMoveDate;
  readonly counts: TransactionPlanRunCounts;
  readonly refusals: ReadonlyArray<TransactionPlanRunRefusal>;
  readonly plan: TransactionPlanView;
};

export type TransactionPlanConfirmation = {
  readonly status: "confirmed";
  readonly confirmed: ReadonlyArray<TransactionMoveId>;
  readonly counts: TransactionPlanRunCounts;
  readonly refusals: ReadonlyArray<TransactionPlanRunRefusal>;
  readonly plan: TransactionPlanRead;
};

export type TransactionPlanRetry = {
  readonly team: TeamId;
  readonly retried: ReadonlyArray<TransactionMoveId>;
  readonly counts: TransactionPlanRunCounts;
  readonly refusals: ReadonlyArray<TransactionPlanRunRefusal>;
  readonly plan: TransactionPlanRead;
};
export type TransactionRunRecord = {
  readonly run: TransactionRunId;
  readonly userId: UserId;
  readonly team: TeamId;
  readonly trigger: TransactionRunTrigger;
  readonly decidedBy?: TransactionDecisionActor;
  readonly surface?: string;
  readonly key?: string;
  readonly at: DateTime.Utc;
  readonly finishedAt?: DateTime.Utc;
  readonly counts: TransactionPlanRunCounts;
  readonly refusals: ReadonlyArray<TransactionPlanRunRefusal>;
};

type TransactionPlanDueResult = {
  readonly at: DateTime.Utc;
  readonly counts: TransactionPlanRunCounts;
};

type TransactionPlanDecision = "undecided" | "saved" | "now" | "confirmed" | "discarded";

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
  readonly sendsAt: DateTime.Utc | undefined;
  readonly dueToday: boolean;
  readonly phase: TransactionMovePhase | undefined;
  readonly attempts: ReadonlyArray<StoredMoveAttempt>;
  readonly validation: StoredMoveValidation;
  readonly placement: StoredMovePlacement | undefined;
  readonly claims: ReadonlyArray<StoredMoveClaim>;
  readonly runPosition: number | undefined;
  readonly dependsOn: ReadonlyArray<TransactionMoveId>;
  readonly blockage: string | undefined;
  readonly projection: ReadonlyArray<TransactionPlanRosterPlayer>;
  readonly decidedAt?: DateTime.Utc;
  readonly confirmation?: TransactionMoveConfirmation;
  readonly runAt?: DateTime.Utc;
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

export type TransactionPlanResult = {
  readonly plan: TransactionPlanView;
  readonly refused: ReadonlyArray<TransactionPlanRefusal>;
};

type TransactionPlanChangeResult = TransactionPlanResult & {
  readonly confirmationCleared: boolean;
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
  ) => Effect.Effect<TransactionPlanChangeResult, TransactionPlanServiceError>;

  readonly save: (
    userId: UserId,
    input: TransactionPlanSaveInput,
  ) => Effect.Effect<TransactionPlanChangeResult, TransactionPlanServiceError>;

  readonly edit: (
    userId: UserId,
    input: TransactionPlanEditInput,
  ) => Effect.Effect<TransactionPlanChangeResult, TransactionPlanServiceError>;

  readonly discard: (
    userId: UserId,
    input: TransactionPlanDiscardInput,
  ) => Effect.Effect<TransactionPlanResult, TransactionPlanServiceError>;

  readonly discardGroup: (
    userId: UserId,
    input: TransactionPlanDiscardGroupInput,
  ) => Effect.Effect<TransactionPlanResult, TransactionPlanServiceError>;

  readonly fix: (
    userId: UserId,
    input: TransactionPlanFixInput,
  ) => Effect.Effect<TransactionPlanResult, TransactionPlanServiceError>;

  readonly retry: (
    userId: UserId,
    input: TransactionPlanRetryInput,
  ) => Effect.Effect<TransactionPlanRetry, TransactionPlanServiceError>;

  readonly confirm: (
    userId: UserId,
    input: TransactionPlanConfirmInput,
  ) => Effect.Effect<TransactionPlanConfirmation, TransactionPlanServiceError>;

  readonly submit: (
    userId: UserId,
    input: TransactionPlanSubmitInput,
  ) => Effect.Effect<TransactionPlanSubmission, TransactionPlanServiceError>;

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

export const ConfirmTransactionMovesInput = Schema.Struct({
  team: TeamId,
  moves: Schema.Array(TransactionMoveId).pipe(
    Schema.check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  ),
  key: Schema.NonEmptyString.pipe(Schema.check(Schema.isMaxLength(80))),
});
export type ConfirmTransactionMovesInput = typeof ConfirmTransactionMovesInput.Type;

export const DiscardTransactionMoveInput = Schema.Struct({
  team: TeamId,
  move: TransactionMoveId,
});
export type DiscardTransactionMoveInput = typeof DiscardTransactionMoveInput.Type;
