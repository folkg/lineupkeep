import { Array, DateTime, Effect, Layer, Result, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { TeamId } from "#contexts/connections/FantasyTeam.ts";
import type { LineupError, LineupRun } from "#contexts/connections/LineupRun.ts";
import { LineupRuns } from "#contexts/connections/LineupRuns.ts";
import {
  placeIntentItems,
  planProposalOrder,
  rosterChangeDate,
} from "#contexts/connections/ProposalOrder.ts";
import type {
  ProposalOrderItem,
  ProposalOrderPlan,
  ProposalOrderPlayer,
  ProposalOrderRefusalCode,
  ProposalPlacementIntent,
  ProposalPlacementResult,
} from "#contexts/connections/ProposalOrder.ts";
import type {
  ProviderCapabilities,
  ProviderLeagueSettings,
  ProviderLeagueTeam,
  ProviderPendingTrade,
  ProviderPlayerDetail,
  ProviderPlayerWeekFact,
  ProviderReadFailure,
  ProviderRoster,
  ProviderRosterCoverage,
  ProviderTransaction,
  ProviderTransactionTeam,
  ProviderWriteResult,
} from "#contexts/connections/Provider.ts";
import { sessionEvidenceOf } from "#contexts/connections/Provider.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";
import type { QueryError, QueryTeam } from "#contexts/connections/QueryValues.ts";
import type { CounterpartyRef, PlayerRef } from "#contexts/connections/QueryValues.ts";
import {
  rosterOccupancy,
  rosterRuleOf,
  slotMismatchDetail,
  slotPlacement,
} from "#contexts/connections/RosterSlots.ts";
import type {
  PendingTradeOffer,
  ProposalBudget,
  ProposalExecutionStep,
  ProposalItem,
  ProposalItemDraft,
  ProposalItemId,
  ProposalItemRefusal,
  ProposalItemRefused,
  ProposalItemState,
  ProposalItemToWithdraw,
  ProposalItemWithdrawalRefusal,
  ProposalOutcome,
  ProposalSet,
  ProposalSetProvenance,
  ProposalSetReview,
  ProposalStaleCode,
  ProposalSubmission,
  ProposalTeamLineup,
  ProposeTransactionsResult,
} from "#contexts/connections/TransactionProposals.ts";
import {
  PendingTradeOffersResult as PendingTradeOffersResultSchema,
  ProposalConnectionNotReady,
  ProposalContentInvalid,
  ProposalItem as ProposalItemSchema,
  ProposalItemsNotWithdrawable,
  ProposalNothingAccepted,
  ProposalNothingIncluded,
  ProposalPersistenceFailed,
  ProposalProviderUnavailable,
  ProposalSetAlreadySubmitted,
  ProposalSetExpired,
  ProposalSetNotFound,
  ProposalSetReview as ProposalSetReviewSchema,
  ProposalSubmissionInProgress,
  ProposalTeam as ProposalTeamSchema,
  ProposalTeamNotFound,
  ProposalTradeNotFound,
  ProposalTradeNotPending,
  ProposeTransactionsInput,
  ProposeTransactionsResult as ProposeTransactionsResultSchema,
  SubmitTransactionProposalInput,
  TransactionProposals,
  WithdrawProposalItemsInput,
  WithdrawTradeInput,
  WithdrawTradeResult as WithdrawTradeResultSchema,
} from "#contexts/connections/TransactionProposals.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import { loadTeamContext, ownerNoteOf, providerIdentity } from "./QueryContext.ts";
import type { TeamContext } from "./QueryContext.ts";
import { QueryRepository } from "./QueryRepository.ts";
import { QueryTokens } from "./QueryTokens.ts";
import {
  isSettledItem,
  isSettledSet,
  StoredProposalOrderPlan,
  type ProposalItemRecord,
  type ProposalSetRecord,
  type ProposalStepRecord,
  type ProposalTeamRecord,
  type StoredProposalIntent,
  type StoredProposalLineup,
  type StoredProposalOrder,
  type StoredProposalPlayer,
  type StoredProposalStaleReason,
  type StoredProposalStaleness,
  type StoredProposalSubmission,
  type StoredProposalTrade,
  type StoredReserveMove,
} from "./TransactionProposalRecord.ts";
import { TransactionProposalRepository } from "./TransactionProposalRepository.ts";
import type {
  ProposalItemChange,
  ProposalItemCommand,
  ProposalOutcomeCommand,
  ProposalStepCommand,
} from "./TransactionProposalRepository.ts";

const contentInvalidDetail =
  "A proposal set needs one to twenty items. Each item names an owned team, a kind, the players to add or drop, an optional destination of `active` or `reserve` for an add, an optional player for an activate or stash, an optional FAAB bid of 0 or more, and a reason of at most 500 characters. A drop item adds nobody, a free-agent add carries no bid, a waiver claim requires a bid, a trade names a counterparty with at least one player going out and one coming back, an activate or stash names one rostered player without adding or dropping anyone, and a slot move names one rostered player and one destination slot without adding or dropping anyone. A trade carries no bid and no draft picks.";

const submitInvalidDetail =
  "A submission names one proposal set and one to twenty of its move ids. Reload the review and submit again.";
const withdrawInvalidDetail =
  "A withdrawal names one proposal set and one to twenty of its move ids. Reload the set and withdraw again.";
const skippedMovementDetail =
  "Not attempted because the reserve move did not complete, so the transaction was not sent.";
const unknownReserveDetail =
  "We could not confirm whether the reserve move applied, so the add or drop was not attempted. Nothing was retried.";
const waiverPendingDetail =
  "Your league has not processed this waiver claim yet. It may still be awarded or lost, so this move is pending rather than done.";

type PendingParty = {
  readonly ref: CounterpartyRef;
  readonly name?: string;
};

type PreparedDraft = {
  readonly index: number;
  readonly team: ProposalTeamRecord;
  readonly draft: ProposalItemDraft;
};

type AcceptedDraft = {
  readonly index: number;
  readonly team: ProposalTeamRecord;
  readonly key: string;
  readonly command: ProposalItemCommand;
};

type OpenedDraft = {
  readonly index: number;
  readonly team: ProposalTeamRecord;
  readonly draft: ProposalItemDraft;
  readonly adds: ReadonlyArray<string>;
  readonly drops: ReadonlyArray<string>;
  readonly slotMoveKey: string | undefined;
  readonly intentPlayerKey: string | undefined;
  readonly counterpartyKey: string | undefined;
};

type StagedTrade =
  | {
      readonly outcome: "staged";
      readonly counterpartyKey: string;
      readonly counterpartyName: string | undefined;
      readonly adds: ReadonlyArray<StoredProposalPlayer>;
      readonly drops: ReadonlyArray<StoredProposalPlayer>;
    }
  | {
      readonly outcome: "refused";
      readonly refusal: ProposalItemRefused;
    };

type TeamFacts = {
  readonly league: ProviderLeagueSettings;
  readonly roster: ProviderRoster;
  readonly leagueTeams: ReadonlyArray<ProviderLeagueTeam>;
  readonly providerTeamKey: string;
  readonly players: ReadonlyMap<string, ProviderPlayerDetail>;
  readonly weeks: ReadonlyMap<string, ProviderPlayerWeekFact>;
  readonly tradeRosters: ReadonlyMap<string, ProviderRoster>;
};

type TeamCheck = {
  readonly team: TeamId;
  readonly budget?: ProposalBudget;
  readonly failure?: string;
  readonly facts?: TeamFacts;
  readonly context?: TeamContext;
  readonly changes: ReadonlyArray<ProposalItemChange>;
  readonly order?: ProposalOrderPlan;
  readonly tradeFeed?: TradeFeed;
};

type TeamData =
  | {
      readonly status: "ready";
      readonly facts: TeamFacts;
      readonly context: TeamContext;
      readonly tradeFeed: TradeFeed | undefined;
    }
  | { readonly status: "failed"; readonly detail: string };

type TradeFeed = {
  readonly pending: ReadonlyArray<ProviderPendingTrade>;
  readonly completed: ReadonlyArray<ProviderTransaction>;
  readonly completedUnavailable: boolean;
};

type ItemExecution = {
  readonly outcome: ProposalOutcome;
  readonly detail?: string;
  readonly steps: ReadonlyArray<ProposalStepCommand>;
  readonly settled: boolean;
  readonly trade?: StoredProposalTrade;
};

export const TransactionProposalsLive = Layer.effect(
  TransactionProposals,
  Effect.gen(function* () {
    const repository = yield* TransactionProposalRepository;
    const queries = yield* QueryRepository;
    const encryption = yield* ConnectionCredentialEncryption;
    const registry = yield* ProviderRegistry;
    const tokens = yield* QueryTokens;
    const lineups = yield* LineupRuns;

    const propose: TransactionProposals["Service"]["propose"] = Effect.fn(
      "TransactionProposals.propose",
    )(function* (userId: UserId, proposer: ProposalSetProvenance, input) {
      const decoded = yield* Schema.decodeEffect(ProposeTransactionsInput)(input).pipe(
        Effect.mapError(() => ProposalContentInvalid.make({ detail: contentInvalidDetail })),
      );
      const now = yield* DateTime.now;
      const ownedTeams = yield* repository.listTeams(userId);
      const teamsById = new Map(ownedTeams.map((team) => [team.id, team] as const));
      const target = decoded.set ?? undefined;
      const existing = target === undefined ? undefined : yield* repository.load(userId, target);
      if (target !== undefined && existing === undefined) {
        return yield* ProposalSetNotFound.make({ set: target });
      }
      if (existing !== undefined) {
        if (isSettledSet(existing.submissions, existing.items)) {
          return yield* ProposalSetAlreadySubmitted.make({
            set: existing.set.id,
            submittedAt: lastSubmittedAt(existing),
          });
        }
        if (existing.submissions.some((submission) => submission.completedAt === undefined)) {
          return yield* ProposalSubmissionInProgress.make({ set: existing.set.id });
        }
        if (isExpired(existing.set, now)) {
          return yield* ProposalSetExpired.make({
            set: existing.set.id,
            expiresAt: existing.set.expiresAt,
          });
        }
      }

      const refusals: Array<ProposalItemRefused> = [];
      const accepted: Array<AcceptedDraft> = [];
      const firstIndexByKey = new Map<string, number>();
      const existingByMove = new Map(
        (existing?.items ?? []).flatMap((item, position) =>
          blocksReplacement(item)
            ? [[recordMoveKey(item), { position: position + 1, label: moveLabel(item) }] as const]
            : [],
        ),
      );
      const pickProviderKeys = [
        ...new Set(
          decoded.items.flatMap((draft) => {
            if ((draft.picks ?? []).length === 0) {
              return [];
            }
            const team = teamsById.get(draft.team);
            return team === undefined ? [] : [team.provider];
          }),
        ),
      ];
      const tradeProposalByProvider = new Map(
        registry
          .capabilitiesOf(pickProviderKeys)
          .map((entry) => [entry.key, entry.capabilities.tradeProposal] as const),
      );

      const prepared: Array<PreparedDraft> = [];
      for (const [index, draft] of decoded.items.entries()) {
        const team = teamsById.get(draft.team);
        if (team === undefined) {
          refusals.push(
            refusedItem(
              index,
              "team_not_owned",
              `Item ${String(index + 1)} names a team this account does not have.`,
              "List your teams and name a team this account owns.",
            ),
          );
          continue;
        }
        if ((draft.picks ?? []).length > 0) {
          const tradeProposal = tradeProposalByProvider.get(team.provider);
          if (tradeProposal === undefined) {
            throw new Error(`Team ${team.id} references an unregistered provider`);
          }
          if (tradeProposal.assets.includes("draft_pick")) {
            throw new Error(
              "Your league accepts draft picks in a trade proposal, but a proposal item cannot carry one",
            );
          }
          refusals.push(
            refusedItem(
              index,
              "draft_pick_included",
              tradeProposal.detail,
              "Remove `picks`. A transaction item carries players only because your league publishes pick trades only on its website.",
            ),
          );
          continue;
        }
        const shape = proposalShape(draft);
        if (shape !== undefined) {
          refusals.push(
            refusedItem(
              index,
              shape.refusal,
              shape.detail,
              shape.refusal === "bid_invalid"
                ? "Remove the bid for this kind, or use a waiver claim to spend a FAAB bid."
                : "Declare a kind whose players match the item: a drop drops only, an add adds only, a trade names players both ways, and a slot move names one player and one destination slot.",
            ),
          );
          continue;
        }
        prepared.push({ index, team, draft });
      }

      const byLeague = new Map<string, Array<PreparedDraft>>();
      for (const entry of prepared) {
        const current = byLeague.get(entry.team.providerLeagueKey) ?? [];
        current.push(entry);
        byLeague.set(entry.team.providerLeagueKey, current);
      }
      const leagueGroups = [...byLeague.entries()].map(([leagueKey, entries]) => ({
        leagueKey,
        entries,
        refs: entries.flatMap((entry) => [
          ...entry.draft.adds,
          ...entry.draft.drops,
          ...(entry.draft.slotMove === undefined || entry.draft.slotMove === null
            ? []
            : [entry.draft.slotMove.player]),
          ...(entry.draft.player === undefined || entry.draft.player === null
            ? []
            : [entry.draft.player]),
        ]),
      }));
      const openedGroups = yield* tokens.openPlayerRefGroups({
        userId,
        groups: leagueGroups.map((group) => ({ leagueKey: group.leagueKey, refs: group.refs })),
      });
      const openedByIndex = new Map<number, ReadonlyArray<string | undefined>>();
      for (const [groupIndex, group] of leagueGroups.entries()) {
        const opened = Array.getUnsafe(openedGroups, groupIndex);
        let offset = 0;
        for (const entry of group.entries) {
          const count =
            entry.draft.adds.length +
            entry.draft.drops.length +
            (entry.draft.slotMove === undefined || entry.draft.slotMove === null ? 0 : 1) +
            (entry.draft.player === undefined || entry.draft.player === null ? 0 : 1);
          openedByIndex.set(entry.index, opened.slice(offset, offset + count));
          offset += count;
        }
      }
      const counterpartyByLeague = new Map<
        string,
        ReadonlyArray<{ readonly index: number; readonly ref: CounterpartyRef }>
      >();
      for (const entry of prepared) {
        const ref = entry.draft.kind === "trade" ? entry.draft.counterparty : null;
        if (ref === null || ref === undefined) {
          continue;
        }
        const current = counterpartyByLeague.get(entry.team.providerLeagueKey) ?? [];
        counterpartyByLeague.set(entry.team.providerLeagueKey, [
          ...current,
          { index: entry.index, ref },
        ]);
      }
      const openedCounterpartyGroups = yield* tokens.openCounterpartyRefGroups({
        userId,
        groups: [...counterpartyByLeague.entries()].map(([leagueKey, entries]) => ({
          leagueKey,
          refs: entries.map((entry) => entry.ref),
        })),
      });
      const counterpartyByIndex = new Map<number, string>();
      const counterpartyInvalid = new Set<number>();
      for (const [groupIndex, entries] of [...counterpartyByLeague.values()].entries()) {
        const opened = Array.getUnsafe(openedCounterpartyGroups, groupIndex);
        for (const [entryIndex, entry] of entries.entries()) {
          const key = Array.getUnsafe(opened, entryIndex);
          if (key === undefined) {
            counterpartyInvalid.add(entry.index);
          } else {
            counterpartyByIndex.set(entry.index, key);
          }
        }
      }

      const candidates: Array<OpenedDraft> = [];
      for (const { index, team, draft } of prepared) {
        const opened = openedByIndex.get(index) ?? [];
        const addKeys = opened.slice(0, draft.adds.length);
        const dropKeys = opened.slice(draft.adds.length, draft.adds.length + draft.drops.length);
        const moveRef = opened[draft.adds.length + draft.drops.length];
        const intentPlayerIndex =
          draft.adds.length +
          draft.drops.length +
          (draft.slotMove === undefined || draft.slotMove === null ? 0 : 1);
        const intentPlayerRef = opened[intentPlayerIndex];
        const adds = addKeys.filter(isPlayerKey);
        const drops = dropKeys.filter(isPlayerKey);
        if (adds.length !== addKeys.length || drops.length !== dropKeys.length) {
          refusals.push(
            refusedItem(
              index,
              "reference_invalid",
              `Item ${String(index + 1)} carries a player reference this account did not receive from a read of that team's league.`,
              "Read the roster or the player pool again and propose with the references from that read.",
            ),
          );
          continue;
        }
        if (draft.kind === "slot_move" && !isPlayerKey(moveRef)) {
          refusals.push(
            refusedItem(
              index,
              "reference_invalid",
              `Item ${String(index + 1)} carries a player reference this account did not receive from a read of that team's league.`,
              "Read the roster again and name the player to move from that read.",
            ),
          );
          continue;
        }
        if (
          (draft.kind === "activate" || draft.kind === "stash") &&
          !isPlayerKey(intentPlayerRef)
        ) {
          refusals.push(
            refusedItem(
              index,
              "reference_invalid",
              `Item ${String(index + 1)} carries a player reference this account did not receive from a read of that team's league.`,
              "Read the roster again and name the player to move from that read.",
            ),
          );
          continue;
        }
        if (
          draft.kind === "trade" &&
          (draft.counterparty === undefined || draft.counterparty === null)
        ) {
          refusals.push(
            refusedItem(
              index,
              "kind_invalid",
              `Item ${String(index + 1)} is a trade without a counterparty team.`,
              "Name the team the offer goes to, from the league's teams read.",
            ),
          );
          continue;
        }
        if (counterpartyInvalid.has(index)) {
          refusals.push(
            refusedItem(
              index,
              "reference_invalid",
              `Item ${String(index + 1)} carries a counterparty reference this account did not receive from a read of that team's league.`,
              "Read the league's teams again and name the counterparty from that read.",
            ),
          );
          continue;
        }
        candidates.push({
          index,
          team,
          draft,
          adds,
          drops,
          slotMoveKey: isPlayerKey(moveRef) ? moveRef : undefined,
          intentPlayerKey: isPlayerKey(intentPlayerRef) ? intentPlayerRef : undefined,
          counterpartyKey: draft.kind === "trade" ? counterpartyByIndex.get(index) : undefined,
        });
      }

      const tradeCandidates = candidates.filter((entry) => entry.draft.kind === "trade");
      const stagedTrades = yield* stageTrades(userId, tradeCandidates);

      for (const candidate of candidates) {
        const { index, team, draft } = candidate;
        const staged = stagedTrades.get(index);
        if (staged?.outcome === "refused") {
          refusals.push(staged.refusal);
          continue;
        }

        const adds =
          staged?.outcome === "staged" ? staged.adds.map((player) => player.key) : candidate.adds;
        const drops =
          staged?.outcome === "staged" ? staged.drops.map((player) => player.key) : candidate.drops;
        const counterpartyKey =
          staged?.outcome === "staged" ? staged.counterpartyKey : candidate.counterpartyKey;
        const both = adds.find((key) => drops.includes(key));
        if (both !== undefined) {
          refusals.push(
            refusedItem(
              index,
              "player_in_both",
              `Item ${String(index + 1)} adds and drops the same player.`,
              "Name the player once, on one side of the move.",
            ),
          );
          continue;
        }
        const slotMove =
          candidate.slotMoveKey === undefined ||
          draft.slotMove === undefined ||
          draft.slotMove === null
            ? undefined
            : { player: candidate.slotMoveKey, toSlot: draft.slotMove.toSlot };
        const intent =
          draft.kind === "activate" || draft.kind === "stash"
            ? {
                kind: draft.kind,
                ...(candidate.intentPlayerKey === undefined
                  ? {}
                  : { player: { key: candidate.intentPlayerKey } }),
              }
            : draft.kind === "free_agent_add" || draft.kind === "waiver_claim"
              ? { kind: "add" as const, to: draft.to ?? "active" }
              : undefined;
        const key = proposalItemKey({
          team: draft.team,
          kind: draft.kind,
          counterpartyKey,
          adds,
          drops,
          slotMove,
          intent,
          bid: draft.bid ?? undefined,
          reason: draft.reason,
        });
        const moveKey = proposalMoveKey(
          draft.team,
          draft.kind,
          counterpartyKey,
          adds,
          drops,
          slotMove,
          intent,
          draft.bid ?? undefined,
        );
        const repeated = existingByMove.get(moveKey);
        if (repeated !== undefined) {
          refusals.push(
            refusedItem(
              index,
              "duplicate_item",
              `Item ${String(index + 1)} repeats ${repeated.label}, move ${String(repeated.position)} of this set.`,
              "Leave this item out; the set already carries that move. Propose a different move to extend the set.",
            ),
          );
          continue;
        }
        const firstIndex = firstIndexByKey.get(moveKey);
        if (firstIndex !== undefined) {
          refusals.push(
            refusedItem(
              index,
              "duplicate_item",
              `Item ${String(index + 1)} repeats item ${String(firstIndex + 1)} for the same team and players.`,
              "Keep one of them, or change the players or bid so the moves differ.",
            ),
          );
          continue;
        }
        firstIndexByKey.set(moveKey, index);
        accepted.push({
          index,
          team,
          key,
          command: {
            team: draft.team,
            connection: team.connection,
            kind: draft.kind,
            adds: staged?.outcome === "staged" ? staged.adds : adds.map((add) => ({ key: add })),
            drops:
              staged?.outcome === "staged" ? staged.drops : drops.map((drop) => ({ key: drop })),
            intent,
            counterpartyKey,
            counterpartyName: staged?.outcome === "staged" ? staged.counterpartyName : undefined,
            slotMove:
              slotMove === undefined
                ? undefined
                : { playerKey: slotMove.player, toSlot: slotMove.toSlot },
            bid: draft.bid ?? undefined,
            reason: draft.reason,
          },
        });
      }

      const itemIds = yield* Effect.replicateEffect(accepted.length)(repository.newItemId);
      const setId = existing?.set.id ?? (yield* repository.newSetId);
      const candidateRecords = accepted.map((entry, index) => ({
        entry,
        record: commandRecord({
          command: entry.command,
          id: Array.getUnsafe(itemIds, index),
          setId,
          position: (existing?.items.length ?? 0) + index,
          userId,
          at: now,
        }),
      }));

      const existingItems = existing?.items ?? [];
      const unrunItems = existingItems.filter((item) => item.state === "proposed");
      const combinedByTeam = new Map<TeamId, Array<ProposalItemRecord>>();
      for (const item of [...unrunItems, ...candidateRecords.map((entry) => entry.record)]) {
        const current = combinedByTeam.get(item.team) ?? [];
        current.push(item);
        combinedByTeam.set(item.team, current);
      }
      const checks = new Map<TeamId, TeamCheck>();
      const existingChecks = new Map<TeamId, TeamCheck>();
      for (const teamId of new Set(candidateRecords.map((entry) => entry.entry.team.id))) {
        const items = combinedByTeam.get(teamId) ?? [];
        const data = yield* loadTeamData(userId, teamsById.get(teamId), items);
        checks.set(teamId, evaluateTeam(teamId, data, items, now));
        if (existing !== undefined) {
          existingChecks.set(
            teamId,
            evaluateTeam(
              teamId,
              data,
              unrunItems.filter((item) => item.team === teamId),
              now,
            ),
          );
        }
      }
      const changeByTeam = new Map(
        [...checks.entries()].map(
          ([teamId, check]) =>
            [teamId, new Map(check.changes.map((change) => [change.id, change] as const))] as const,
        ),
      );

      const acceptedCandidates: Array<{
        readonly entry: AcceptedDraft;
        readonly record: ProposalItemRecord;
        readonly change: ProposalItemChange;
      }> = [];
      for (const candidate of candidateRecords) {
        const change = changeByTeam.get(candidate.entry.team.id)?.get(candidate.record.id);
        if (change === undefined) {
          throw new Error("A declared proposal item was not checked");
        }
        if (change.staleness.status === "current") {
          acceptedCandidates.push({ ...candidate, change });
        } else {
          refusals.push(refusalFromCheck(candidate.entry.index + 1, change));
        }
      }

      const withdraw: Array<ProposalItemToWithdraw> = [];
      if (existing !== undefined) {
        for (const item of unrunItems) {
          const before = existingChecks
            .get(item.team)
            ?.changes.find((change) => change.id === item.id);
          const after = changeByTeam.get(item.team)?.get(item.id);
          if (
            before?.staleness.status !== "current" ||
            after === undefined ||
            after.staleness.status === "current"
          ) {
            continue;
          }
          withdraw.push({
            item: item.id,
            team: item.team,
            label: moveLabel(item),
            detail: after.staleness.reasons.map((reason) => reason.detail).join(" "),
          });
        }
      }
      if (withdraw.length > 0 && existing !== undefined) {
        return yield* ProposalNothingAccepted.make({
          refusals,
          withdraw,
          detail: `Nothing was stored. The moves added in this request make ${withdraw
            .map((entry) => `item ${entry.item} (${entry.label})`)
            .join(" and ")} impossible, so set ${existing.set.id} is unchanged. Withdraw ${
            withdraw.length === 1 ? "that item" : "those items"
          } with withdraw_transaction_proposal_items, then propose this addition again.`,
        });
      }

      if (acceptedCandidates.length === 0) {
        return yield* ProposalNothingAccepted.make({
          refusals,
          withdraw: [],
          detail:
            existing === undefined
              ? "No item can run against the set's end state, so no set was stored. Fix the refused items and propose again."
              : `No item can run against this set's end state, so nothing was added to set ${existing.set.id}. Fix the refused items and propose again.`,
        });
      }

      const orderedChecks = [...checks.values()];
      const orders = yield* storedOrders(existing?.set.orders ?? [], orderedChecks);
      const existingIds = new Set(existingItems.map((item) => item.id));
      const storedChanges = orderedChecks.flatMap((check) =>
        check.changes.filter((change) => existingIds.has(change.id)),
      );
      const storedTeams = [
        ...new Set([...(existing?.set.teams ?? []), ...ownedTeams.map((team) => team.id)]),
      ];
      const storeItems = acceptedCandidates.map((candidate) => ({
        id: candidate.record.id,
        command: namedCommand(
          {
            ...candidate.entry.command,
            adds: candidate.change.adds,
            drops: candidate.change.drops,
          },
          checks.get(candidate.entry.team.id)?.facts,
        ),
        check: candidate.change.staleness,
        reserveMove: candidate.change.reserveMove,
        placement: candidate.change.placement,
      }));

      let currentSet: ProposalSetRecord;
      let currentSubmissions: ReadonlyArray<StoredProposalSubmission>;
      let currentItems: ReadonlyArray<ProposalItemRecord>;
      let created = false;
      let extended = false;
      let stored: ReadonlyArray<ProposalItemRecord>;
      if (existing === undefined) {
        const createdResult = yield* repository.create({
          userId,
          setId,
          proposedBy:
            decoded.client === undefined || decoded.client === null
              ? proposer
              : { ...proposer, client: decoded.client },
          fingerprintSource: acceptedCandidates
            .map((candidate) => candidate.entry.key)
            .sort()
            .join("\n"),
          teams: ownedTeams.map((team) => team.id),
          items: storeItems,
          orders,
          at: now,
        });
        currentSet = createdResult.set;
        currentSubmissions = createdResult.submissions;
        currentItems = createdResult.items;
        created = createdResult.created;
        stored = createdResult.items;
      } else {
        const appended = yield* repository.append({
          userId,
          setId: existing.set.id,
          teams: storedTeams,
          items: storeItems,
          changes: storedChanges,
          orders,
          at: now,
        });
        if (appended.status !== "appended") {
          const latest = yield* repository.load(userId, existing.set.id);
          if (latest === undefined) {
            return yield* ProposalSetNotFound.make({ set: existing.set.id });
          }
          if (appended.status === "in_flight") {
            return yield* ProposalSubmissionInProgress.make({ set: latest.set.id });
          }
          if (appended.status === "closed") {
            return yield* ProposalSetAlreadySubmitted.make({
              set: latest.set.id,
              submittedAt: lastSubmittedAt(latest),
            });
          }
          return yield* ProposalSetNotFound.make({ set: existing.set.id });
        }
        currentSet = existing.set;
        currentSubmissions = existing.submissions;
        currentItems = [...existingItems, ...appended.items];
        extended = true;
        stored = appended.items;
      }

      const storedById = new Map(stored.map((item) => [item.id, item] as const));
      const storedByKey = new Map(stored.map((item) => [recordItemKey(item), item] as const));
      const items: Array<ProposeTransactionsResult["items"][number]> = [];
      for (const candidate of acceptedCandidates) {
        const record = storedById.get(candidate.record.id) ?? storedByKey.get(candidate.entry.key);
        if (record === undefined) {
          throw new Error("A stored proposal item is missing from the set");
        }
        const team = teamsById.get(record.team);
        if (team === undefined) {
          throw new Error("A stored proposal item names a team this account does not have");
        }
        items.push({
          position: candidate.entry.index + 1,
          outcome: "accepted",
          item: yield* toItem(
            tokens,
            userId,
            team,
            record,
            checks.get(record.team)?.facts,
            record.reserveMove,
            undefined,
          ),
        });
      }
      const refusedNote =
        refusals.length === 0
          ? ""
          : ` ${String(refusals.length)} item${refusals.length === 1 ? " could" : "s could"} not run and ${refusals.length === 1 ? "was" : "were"} not stored; each refusal gives its position, the reason, and what would make it valid.`;
      const detail =
        existing === undefined
          ? created
            ? `Created proposal set ${currentSet.id} with ${String(items.length)} item${items.length === 1 ? "" : "s"}.${refusedNote} It is ready for the review screen; nothing has been sent to your league.`
            : `This exact set was already proposed as ${currentSet.id}. The existing set is returned instead of a duplicate; nothing has been sent to your league.${refusedNote}`
          : `Appended ${String(items.length)} item${items.length === 1 ? "" : "s"} to proposal set ${currentSet.id}.${refusedNote} The whole set was validated again and its order recomputed; nothing has been sent to your league.`;
      yield* Effect.annotateCurrentSpan({
        "proposal.set_created": created,
        "proposal.set_extended": extended,
        "proposal.items": items.length,
        "proposal.items_refused": refusals.length,
      });
      return yield* Schema.decodeEffect(ProposeTransactionsResultSchema)({
        set: toSet(currentSet, currentSubmissions, currentItems, now),
        created,
        extended,
        items,
        refused: [...refusals].sort((left, right) => left.position - right.position),
        detail,
      }).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
    });

    const read: TransactionProposals["Service"]["read"] = Effect.fn("TransactionProposals.read")(
      function* (userId: UserId, input) {
        const now = yield* DateTime.now;
        const loaded = yield* repository.load(userId, input.set);
        if (loaded === undefined) {
          return yield* ProposalSetNotFound.make({ set: input.set });
        }
        const teams = yield* repository.loadTeams(userId, loaded.set.teams);
        return yield* buildReview(
          tokens,
          userId,
          teams,
          loaded.set,
          loaded.submissions,
          loaded.items,
          loaded.steps,
          now,
        );
      },
    );

    const revalidate: TransactionProposals["Service"]["revalidate"] = Effect.fn(
      "TransactionProposals.revalidate",
    )(function* (userId: UserId, input) {
      const now = yield* DateTime.now;
      const loaded = yield* repository.load(userId, input.set);
      if (loaded === undefined) {
        return yield* ProposalSetNotFound.make({ set: input.set });
      }
      const submitted = loaded.submissions.length > 0;
      if (!submitted && isExpired(loaded.set, now)) {
        return yield* ProposalSetExpired.make({
          set: loaded.set.id,
          expiresAt: loaded.set.expiresAt,
        });
      }
      const teams = yield* repository.loadTeams(userId, loaded.set.teams);
      const teamsById = new Map(teams.map((team) => [team.id, team] as const));
      const openItems = loaded.items.filter((item) => isOpen(item.state));
      const tradeItems = loaded.items.filter((item) => item.kind === "trade");
      const checkedItems = [
        ...new Map([...openItems, ...tradeItems].map((item) => [item.id, item] as const)).values(),
      ];
      const itemsByTeam = new Map<TeamId, Array<ProposalItemRecord>>();
      for (const item of checkedItems) {
        const current = itemsByTeam.get(item.team) ?? [];
        current.push(item);
        itemsByTeam.set(item.team, current);
      }
      const checks = yield* Effect.forEach(
        [...itemsByTeam.entries()],
        ([teamId, items]) => checkTeam(userId, teamId, teamsById.get(teamId), items, now),
        { concurrency: 3 },
      );
      const changes = checks.flatMap((check) => check.changes);
      const orders = yield* storedOrders(loaded.set.orders, checks);
      const saved = yield* repository.saveChecks({
        userId,
        setId: loaded.set.id,
        changes,
        orders,
        at: now,
      });
      const savedById = new Map(saved.map((item) => [item.id, item] as const));
      const checkedByTeam = new Map(checks.map((check) => [check.team, check] as const));
      const items = loaded.items.map((item) => savedById.get(item.id) ?? item);
      const offersByTeam = yield* loadPendingOffers(userId, loaded.set.teams, teamsById);
      yield* Effect.annotateCurrentSpan({
        "proposal.items_checked": checkedItems.length,
        "proposal.teams_checked": checks.length,
        "proposal.teams_failed": checks.filter((check) => check.failure !== undefined).length,
        "proposal.pending_offers": [...offersByTeam.values()].flat().length,
      });
      return yield* buildReview(
        tokens,
        userId,
        teams,
        loaded.set,
        loaded.submissions,
        items,
        loaded.steps,
        now,
        checkedByTeam,
        offersByTeam,
      );
    });

    const withdrawItems: TransactionProposals["Service"]["withdrawItems"] = Effect.fn(
      "TransactionProposals.withdrawItems",
    )(function* (userId: UserId, input) {
      const decoded = yield* Schema.decodeEffect(WithdrawProposalItemsInput)(input).pipe(
        Effect.mapError(() => ProposalContentInvalid.make({ detail: withdrawInvalidDetail })),
      );
      const now = yield* DateTime.now;
      const loaded = yield* repository.load(userId, decoded.set);
      if (loaded === undefined) {
        return yield* ProposalSetNotFound.make({ set: decoded.set });
      }
      if (loaded.submissions.some((submission) => submission.completedAt === undefined)) {
        return yield* ProposalSubmissionInProgress.make({ set: loaded.set.id });
      }
      if (isExpired(loaded.set, now)) {
        return yield* ProposalSetExpired.make({
          set: loaded.set.id,
          expiresAt: loaded.set.expiresAt,
        });
      }
      const requested = [...new Set(decoded.items)];
      const byId = new Map(loaded.items.map((item) => [item.id, item] as const));
      const refused = requested.flatMap((itemId) => {
        const state = byId.get(itemId)?.state;
        return state === "proposed" ? [] : [withdrawalRefusal(itemId, state)];
      });
      if (refused.length > 0) {
        return yield* ProposalItemsNotWithdrawable.make({
          items: refused,
          detail: "Nothing was withdrawn. Fix the refused moves and withdraw again.",
        });
      }

      const remove = new Set(requested);
      const remaining = loaded.items.filter((item) => !remove.has(item.id));
      const teams = yield* repository.loadTeams(userId, loaded.set.teams);
      const teamsById = new Map(teams.map((team) => [team.id, team] as const));
      const unrunByTeam = new Map<TeamId, Array<ProposalItemRecord>>();
      for (const item of remaining.filter((entry) => entry.state === "proposed")) {
        const current = unrunByTeam.get(item.team) ?? [];
        current.push(item);
        unrunByTeam.set(item.team, current);
      }
      const affectedTeams = [...new Set(requested.map((itemId) => byId.get(itemId)?.team))].flatMap(
        (team) => (team === undefined || (unrunByTeam.get(team)?.length ?? 0) === 0 ? [] : [team]),
      );
      const checks = yield* Effect.forEach(
        affectedTeams,
        (teamId) =>
          checkTeam(userId, teamId, teamsById.get(teamId), unrunByTeam.get(teamId) ?? [], now),
        { concurrency: 3 },
      );
      const changes = checks.flatMap((check) => check.changes);
      const orders = yield* storedOrders(loaded.set.orders, checks);
      const keptOrders = orders.filter((entry) => (unrunByTeam.get(entry.team)?.length ?? 0) > 0);
      const saved = yield* repository.withdraw({
        userId,
        setId: loaded.set.id,
        remove: requested,
        changes,
        orders: keptOrders,
        at: now,
      });
      if (saved.status !== "withdrawn") {
        switch (saved.status) {
          case "missing":
            return yield* ProposalSetNotFound.make({ set: loaded.set.id });
          case "in_flight":
            return yield* ProposalSubmissionInProgress.make({ set: loaded.set.id });
          case "not_withdrawable":
            return yield* ProposalItemsNotWithdrawable.make({
              items: saved.items.map((entry) => withdrawalRefusal(entry.item, entry.state)),
              detail:
                "Nothing was withdrawn. A move changed while this set was read, so reload the set and withdraw again.",
            });
        }
      }
      const savedById = new Map(saved.items.map((item) => [item.id, item] as const));
      const items = remaining.map((item) => savedById.get(item.id) ?? item);
      const checkedByTeam = new Map(checks.map((check) => [check.team, check] as const));
      yield* Effect.annotateCurrentSpan({
        "proposal.items_withdrawn": requested.length,
        "proposal.items_remaining": items.length,
        "proposal.teams_checked": checks.length,
      });
      return yield* buildReview(
        tokens,
        userId,
        teams,
        { ...loaded.set, orders: keptOrders },
        loaded.submissions,
        items,
        loaded.steps,
        now,
        checkedByTeam,
      );
    });

    const submit: TransactionProposals["Service"]["submit"] = Effect.fn(
      "TransactionProposals.submit",
    )(function* (userId: UserId, input) {
      const decoded = yield* Schema.decodeEffect(SubmitTransactionProposalInput)(input).pipe(
        Effect.mapError(() => ProposalContentInvalid.make({ detail: submitInvalidDetail })),
      );
      const now = yield* DateTime.now;
      const loaded = yield* repository.load(userId, decoded.set);
      if (loaded === undefined) {
        return yield* ProposalSetNotFound.make({ set: decoded.set });
      }
      if (isSettledSet(loaded.submissions, loaded.items)) {
        return yield* ProposalSetAlreadySubmitted.make({
          set: loaded.set.id,
          submittedAt: lastSubmittedAt(loaded),
        });
      }
      if (loaded.submissions.some((submission) => submission.completedAt === undefined)) {
        return yield* ProposalSubmissionInProgress.make({ set: loaded.set.id });
      }
      if (isExpired(loaded.set, now)) {
        return yield* ProposalSetExpired.make({
          set: loaded.set.id,
          expiresAt: loaded.set.expiresAt,
        });
      }
      const include = new Set(decoded.include);
      if (include.size !== decoded.include.length) {
        return yield* ProposalContentInvalid.make({ detail: submitInvalidDetail });
      }
      const selected = loaded.items.filter((item) => include.has(item.id));
      if (selected.length !== include.size) {
        return yield* ProposalContentInvalid.make({
          detail:
            "A selected move does not belong to this proposal set. Reload the review and submit again.",
        });
      }
      const sendable = selected.filter((item) => isOpen(item.state));
      if (sendable.length === 0) {
        return yield* ProposalNothingIncluded.make({
          detail:
            selected.length === 0
              ? "No move is selected for submission. Include at least one move that has not run, or propose a fresh set."
              : "Every selected move has already been attempted or has an outcome. A move that ran, failed, or was skipped keeps its outcome; add a replacement move to this set and submit that.",
        });
      }
      const teams = yield* repository.loadTeams(userId, loaded.set.teams);
      const teamsById = new Map(teams.map((team) => [team.id, team] as const));
      const sendableTeams = new Set(sendable.map((item) => item.team));
      const itemsByTeam = new Map<TeamId, Array<ProposalItemRecord>>();
      for (const item of loaded.items.filter(
        (entry) => entry.state === "proposed" && sendableTeams.has(entry.team),
      )) {
        const current = itemsByTeam.get(item.team) ?? [];
        current.push(item);
        itemsByTeam.set(item.team, current);
      }
      const checks = yield* Effect.forEach(
        [...itemsByTeam.entries()],
        ([teamId, items]) => checkTeam(userId, teamId, teamsById.get(teamId), items, now),
        { concurrency: 3 },
      );
      const claimed = yield* repository.claimSubmission({
        userId,
        setId: loaded.set.id,
        at: now,
      });
      if (claimed.status !== "claimed") {
        switch (claimed.status) {
          case "missing":
            return yield* ProposalSetNotFound.make({ set: loaded.set.id });
          case "in_flight":
            return yield* ProposalSubmissionInProgress.make({ set: loaded.set.id });
          case "expired":
            return yield* ProposalSetExpired.make({
              set: loaded.set.id,
              expiresAt: loaded.set.expiresAt,
            });
        }
      }

      const changes = checks.flatMap((check) => check.changes);
      const orders = yield* storedOrders(loaded.set.orders, checks);
      const saved = yield* repository.saveChecks({
        userId,
        setId: loaded.set.id,
        changes,
        orders,
        at: now,
      });
      const savedById = new Map(saved.map((item) => [item.id, item] as const));
      const itemById = new Map(
        loaded.items.map((item) => [item.id, savedById.get(item.id) ?? item] as const),
      );
      const changeById = new Map(changes.map((change) => [change.id, change] as const));
      const checkByTeam = new Map(checks.map((check) => [check.team, check] as const));

      const sequenceByTeam = new Map<TeamId, ReadonlyArray<ProposalItemRecord>>();
      const positionByItem = new Map<string, number>();
      for (const teamId of loaded.set.teams) {
        const sequence = executionSequence(
          sendable.filter((item) => item.team === teamId),
          checkByTeam.get(teamId)?.order,
          changeById,
        );
        sequenceByTeam.set(teamId, sequence);
        for (const [index, item] of sequence.entries()) {
          positionByItem.set(item.id, index);
        }
      }

      const outcomes: Array<ProposalOutcomeCommand> = [];

      for (const item of sendable) {
        const current = itemById.get(item.id) ?? item;
        const change = changeById.get(current.id);
        if (change === undefined || change.staleness.status !== "current") {
          outcomes.push(
            skippedOutcome(
              current,
              checkOutcomeDetail(change?.staleness),
              now,
              positionByItem.get(current.id),
              false,
            ),
          );
        }
      }

      const stopped = new Map<TeamId, string>();
      for (const teamId of loaded.set.teams) {
        const check = checkByTeam.get(teamId);
        const teamItems = sequenceByTeam.get(teamId) ?? [];
        for (const item of teamItems) {
          const current = itemById.get(item.id) ?? item;
          const change = changeById.get(item.id);
          if (change === undefined || change.staleness.status !== "current") {
            continue;
          }
          const decidedAt = yield* DateTime.now;
          const position = positionByItem.get(current.id);
          const stoppedDetail = stopped.get(teamId);
          if (stoppedDetail !== undefined) {
            outcomes.push(skippedOutcome(current, stoppedDetail, decidedAt, position, false));
            continue;
          }
          if (check?.facts === undefined || check.context === undefined) {
            outcomes.push(
              skippedOutcome(
                current,
                "Current state could not be read, so this move was not attempted.",
                decidedAt,
                position,
                false,
              ),
            );
            continue;
          }
          const refusal = executableRefusal(
            current,
            check.context.provider.capabilities.transactionRequest,
          );
          if (refusal !== undefined) {
            outcomes.push(skippedOutcome(current, refusal, decidedAt, position, true));
            stopped.set(
              teamId,
              `Not attempted because ${moveLabel(current)} could not be sent. ${refusal} Later moves on this team were not checked against the resulting roster.`,
            );
            continue;
          }
          const execution = yield* executeItem({
            userId,
            item: current,
            change,
            facts: check.facts,
            context: check.context,
          });
          outcomes.push({
            itemId: current.id,
            outcome: execution.outcome,
            detail: execution.detail,
            at: yield* DateTime.now,
            position,
            steps: execution.steps,
            settled: execution.settled,
            ...(execution.trade === undefined ? {} : { trade: execution.trade }),
          });
          if (execution.outcome !== "executed") {
            stopped.set(teamId, stoppedDetailFor(current, execution.outcome, execution.detail));
          }
        }
      }

      if (outcomes.length > 0) {
        yield* repository.recordItemOutcomes({
          userId,
          setId: loaded.set.id,
          outcomes,
        });
      }

      const completedAt = yield* DateTime.now;
      yield* repository.completeSubmission({
        userId,
        setId: loaded.set.id,
        submissionId: claimed.submissionId,
        at: completedAt,
      });
      const settledLineups = yield* settleLineups({
        userId,
        submissionId: claimed.submissionId,
        items: sendable,
        outcomes,
        checks: checkByTeam,
        at: completedAt,
      });
      if (settledLineups.length > 0) {
        const touched = new Set(settledLineups.map((entry) => entry.team));
        yield* repository.recordLineups({
          userId,
          setId: loaded.set.id,
          lineups: [
            ...loaded.set.lineups.filter((entry) => !touched.has(entry.team)),
            ...settledLineups,
          ],
          at: completedAt,
        });
      }
      const final = yield* repository.load(userId, loaded.set.id);
      if (final === undefined) {
        return yield* ProposalPersistenceFailed.make({
          cause: new Error("A submitted proposal set could not be read back"),
        });
      }
      yield* Effect.annotateCurrentSpan({
        "proposal.items_submitted": sendable.length,
        "proposal.items_skipped": final.items.filter((item) => item.outcome === "skipped").length,
        "proposal.items_executed": final.items.filter((item) => item.outcome === "executed").length,
        "proposal.items_pending": final.items.filter((item) => item.outcome === "pending").length,
        "proposal.items_failed": final.items.filter((item) => item.outcome === "failed").length,
        "proposal.items_unknown": final.items.filter((item) => item.outcome === "unknown").length,
        "proposal.teams_stopped": stopped.size,
      });
      return yield* buildReview(
        tokens,
        userId,
        teams,
        final.set,
        final.submissions,
        final.items,
        final.steps,
        completedAt,
      );
    });

    function executeItem(input: {
      readonly userId: UserId;
      readonly item: ProposalItemRecord;
      readonly change: ProposalItemChange;
      readonly facts: TeamFacts;
      readonly context: TeamContext;
    }): Effect.Effect<ItemExecution> {
      return Effect.gen(function* () {
        if (input.item.connection !== input.context.owned.connection.id) {
          return {
            outcome: "skipped",
            detail:
              "This team now belongs to a different connection than the one the move was staged against, so nothing was sent with another connection's sign-in.",
            steps: [],
            settled: true,
          };
        }
        if (input.item.kind === "trade") {
          return yield* executeTradeItem(input);
        }
        const steps: Array<ProposalStepCommand> = [];
        const repair = input.change.reserveMove;
        const repairFirst = repair !== undefined && repair.order !== "after";
        if (repairFirst) {
          const run = yield* executeReserveMove(input, repair);
          steps.push(run.step);
          if (run.outcome !== "executed") {
            return {
              outcome: run.outcome,
              ...(run.detail === undefined ? {} : { detail: run.detail }),
              steps: [
                ...steps,
                ...movementStepsOf(
                  input.change,
                  "skipped",
                  run.outcome === "unknown" ? unknownReserveDetail : skippedMovementDetail,
                  run.step.decidedAt,
                ),
              ],
              settled: false,
            };
          }
        }
        const moved =
          input.item.kind === "slot_move" ||
          input.item.kind === "activate" ||
          input.item.kind === "stash"
            ? yield* executeSlotMove(input, steps)
            : yield* executeTransaction(input, steps);
        if (moved.outcome !== "executed") {
          return moved;
        }
        if (repair !== undefined && !repairFirst) {
          const run = yield* executeReserveMove(input, repair);
          const after = [...moved.steps, run.step];
          return run.outcome === "executed"
            ? { ...moved, steps: after }
            : {
                outcome: run.outcome,
                ...(run.detail === undefined ? {} : { detail: run.detail }),
                steps: after,
                settled: false,
              };
        }
        const placement = placementAfterOf(input.item);
        if (placement === undefined) {
          return moved;
        }
        const run = yield* executeReserveMove(input, placement);
        const after = [...moved.steps, run.step];
        return run.outcome === "executed"
          ? { ...moved, steps: after }
          : {
              outcome: run.outcome,
              ...(run.detail === undefined ? {} : { detail: run.detail }),
              steps: after,
              settled: false,
            };
      });
    }

    function settleLineups(input: {
      readonly userId: UserId;
      readonly submissionId: string;
      readonly items: ReadonlyArray<ProposalItemRecord>;
      readonly outcomes: ReadonlyArray<ProposalOutcomeCommand>;
      readonly checks: ReadonlyMap<TeamId, TeamCheck>;
      readonly at: DateTime.Utc;
    }): Effect.Effect<ReadonlyArray<StoredProposalLineup>> {
      return Effect.gen(function* () {
        const teamOfItem = new Map(input.items.map((item) => [item.id, item.team] as const));
        const touched = new Set(input.items.map((item) => item.team));
        const executed = new Set(
          input.outcomes.flatMap((outcome) => {
            const team = teamOfItem.get(outcome.itemId);
            return outcome.outcome === "executed" && team !== undefined ? [team] : [];
          }),
        );
        const pending = new Set(
          input.outcomes.flatMap((outcome) => {
            const team = teamOfItem.get(outcome.itemId);
            return outcome.outcome === "pending" && team !== undefined ? [team] : [];
          }),
        );
        const runnable = [...executed].filter(
          (team) => input.checks.get(team)?.context !== undefined,
        );
        const settled: Array<StoredProposalLineup> = [];
        if (runnable.length > 0) {
          const submitted = yield* Effect.result(
            lineups.submit(input.userId, {
              requestId: input.submissionId,
              teams: runnable.map((team) => ({ team, period: { coverage: "current" as const } })),
            }),
          );
          if (submitted._tag === "Failure") {
            for (const team of runnable) {
              settled.push(
                notStartedLineup(team, lineupFailureDetail(submitted.failure), input.at),
              );
            }
          } else {
            const byTeam = new Map(submitted.success.runs.map((run) => [run.team, run] as const));
            for (const team of runnable) {
              const run = byTeam.get(team);
              settled.push(
                run === undefined
                  ? notStartedLineup(
                      team,
                      "The lineup run was not returned, so this team's lineup was left as it was.",
                      input.at,
                    )
                  : lineupOf(team, run, input.at),
              );
            }
          }
        }
        for (const team of executed) {
          if (runnable.includes(team)) {
            continue;
          }
          settled.push(
            notStartedLineup(
              team,
              "This team's connection is not ready, so its lineup was left as it was.",
              input.at,
            ),
          );
        }
        for (const team of touched) {
          if (executed.has(team)) {
            continue;
          }
          settled.push(
            pending.has(team)
              ? {
                  team,
                  status: "pending" as const,
                  detail:
                    "The waiver claim is still pending, so this team's lineup was left as it was.",
                  at: DateTime.formatIso(input.at),
                }
              : {
                  team,
                  status: "not_needed" as const,
                  detail: "No item changed this team's roster, so its lineup was left as it was.",
                  at: DateTime.formatIso(input.at),
                },
          );
        }
        return settled;
      });
    }

    function placementAfterOf(item: ProposalItemRecord): StoredReserveMove | undefined {
      const placement = item.placement;
      if (
        placement === undefined ||
        (item.kind !== "free_agent_add" && item.kind !== "waiver_claim") ||
        item.intent?.to !== "reserve"
      ) {
        return undefined;
      }
      return {
        playerKey: placement.playerKey,
        ...(placement.playerName === undefined ? {} : { playerName: placement.playerName }),
        ...(placement.fromSlot === undefined ? {} : { fromSlot: placement.fromSlot }),
        toSlot: placement.toSlot,
        order: "after",
      };
    }

    function executeReserveMove(
      input: {
        readonly userId: UserId;
        readonly facts: TeamFacts;
        readonly context: TeamContext;
      },
      move: StoredReserveMove,
    ): Effect.Effect<ReserveMoveRun> {
      return Effect.gen(function* () {
        const step = (
          outcome: ProposalOutcome,
          detail: string | undefined,
          decidedAt: DateTime.Utc,
        ): ProposalStepCommand => ({
          kind: "reserve_move",
          playerKey: move.playerKey,
          ...(move.playerName === undefined ? {} : { playerName: move.playerName }),
          fromSlot: move.fromSlot,
          toSlot: move.toSlot,
          outcome,
          ...(detail === undefined ? {} : { detail }),
          decidedAt,
        });
        const coverage = proposalCoverage(input.facts.league);
        if (coverage === undefined) {
          const decidedAt = yield* DateTime.now;
          const detail =
            "The league publishes no current date or scoring week, so the reserve move could not be targeted. Nothing was sent for this move.";
          return { step: step("failed", detail, decidedAt), outcome: "failed" as const, detail };
        }
        const reserve = yield* Effect.result(
          input.context.provider.applyReserveMove({
            ...providerIdentity(input.context),
            providerTeamKey: input.facts.providerTeamKey,
            coverage,
            providerPlayerKey: move.playerKey,
            slot: move.toSlot,
          }),
        );
        const decidedAt = yield* DateTime.now;
        if (reserve._tag === "Failure") {
          if (reserve.failure._tag === "provider.session_rejected") {
            yield* queries.recordSessionRejected(
              input.userId,
              input.context.owned,
              sessionEvidenceOf(reserve.failure),
            );
          }
          const detail = sessionFailureDetail(reserve.failure._tag, "reserve move");
          return { step: step("failed", detail, decidedAt), outcome: "failed" as const, detail };
        }
        const outcome = writeOutcome(reserve.success);
        const detail = writeDetail(reserve.success, "reserve move");
        return {
          step: step(outcome, detail, decidedAt),
          outcome,
          ...(detail === undefined ? {} : { detail }),
        };
      });
    }

    function executeTransaction(
      input: {
        readonly userId: UserId;
        readonly item: ProposalItemRecord;
        readonly change: ProposalItemChange;
        readonly facts: TeamFacts;
        readonly context: TeamContext;
      },
      steps: ReadonlyArray<ProposalStepCommand>,
    ): Effect.Effect<ItemExecution> {
      return Effect.gen(function* () {
        const transaction = yield* Effect.result(
          input.context.provider.applyTransaction({
            ...providerIdentity(input.context),
            providerLeagueKey: input.facts.league.providerLeagueKey,
            providerTeamKey: input.facts.providerTeamKey,
            adds: input.change.adds.map((add) => add.key),
            drops: input.change.drops.map((drop) => drop.key),
            faabBid: input.item.kind === "waiver_claim" ? input.item.bid : undefined,
          }),
        );
        const stepAt = yield* DateTime.now;
        if (transaction._tag === "Failure") {
          if (transaction.failure._tag === "provider.session_rejected") {
            yield* queries.recordSessionRejected(
              input.userId,
              input.context.owned,
              sessionEvidenceOf(transaction.failure),
            );
          }
          const detail = sessionFailureDetail(transaction.failure._tag, "transaction");
          return {
            outcome: "failed",
            detail,
            steps: [...steps, ...movementStepsOf(input.change, "failed", detail, stepAt)],
            settled: false,
          };
        }
        const outcome = writeOutcome(transaction.success);
        if (outcome === "executed") {
          const pending =
            input.item.kind === "waiver_claim" ||
            input.change.adds.some(
              (add) => input.facts.players.get(add.key)?.rosterStatus === "waiver",
            );
          const movementOutcome = pending ? "pending" : "executed";
          const detail = pending ? waiverPendingDetail : undefined;
          return {
            outcome: movementOutcome,
            ...(detail === undefined ? {} : { detail }),
            steps: [...steps, ...movementStepsOf(input.change, movementOutcome, detail, stepAt)],
            settled: movementOutcome === "executed",
          };
        }
        const detail = writeDetail(transaction.success, "transaction");
        return {
          outcome,
          ...(detail === undefined ? {} : { detail }),
          steps: [...steps, ...movementStepsOf(input.change, outcome, detail, stepAt)],
          settled: false,
        };
      });
    }

    function executeSlotMove(
      input: {
        readonly userId: UserId;
        readonly item: ProposalItemRecord;
        readonly change: ProposalItemChange;
        readonly facts: TeamFacts;
        readonly context: TeamContext;
      },
      steps: ReadonlyArray<ProposalStepCommand>,
    ): Effect.Effect<ItemExecution> {
      return Effect.gen(function* () {
        const move = input.item.kind === "slot_move" ? input.item.slotMove : input.item.placement;
        const recordedFromSlot =
          input.item.kind === "slot_move" ? undefined : input.item.placement?.fromSlot;
        if (move === undefined) {
          return {
            outcome: "skipped",
            detail: "This move names no player and destination place, so nothing was sent.",
            steps,
            settled: true,
          };
        }
        const rostered = input.facts.roster.players.find(
          (player) => player.providerPlayerKey === move.playerKey,
        );
        const step = (
          outcome: ProposalOutcome,
          detail: string | undefined,
          decidedAt: DateTime.Utc,
        ): ProposalStepCommand => ({
          kind: "slot_move",
          playerKey: move.playerKey,
          playerName: rostered?.name ?? move.playerName,
          ...(rostered?.slot.status === "verified"
            ? { fromSlot: rostered.slot.slot }
            : recordedFromSlot === undefined
              ? {}
              : { fromSlot: recordedFromSlot }),
          toSlot: move.toSlot,
          outcome,
          ...(detail === undefined ? {} : { detail }),
          decidedAt,
        });
        const coverage = proposalCoverage(input.facts.league);
        if (coverage === undefined) {
          const stepAt = yield* DateTime.now;
          const detail =
            "The league publishes no current date or scoring week, so the slot move could not be targeted. Nothing was sent for this move.";
          return {
            outcome: "failed",
            detail,
            steps: [...steps, step("failed", detail, stepAt)],
            settled: false,
          };
        }
        const applied = yield* Effect.result(
          input.context.provider.applyReserveMove({
            ...providerIdentity(input.context),
            providerTeamKey: input.facts.providerTeamKey,
            coverage,
            providerPlayerKey: move.playerKey,
            slot: move.toSlot,
          }),
        );
        const stepAt = yield* DateTime.now;
        if (applied._tag === "Failure") {
          if (applied.failure._tag === "provider.session_rejected") {
            yield* queries.recordSessionRejected(
              input.userId,
              input.context.owned,
              sessionEvidenceOf(applied.failure),
            );
          }
          const detail = sessionFailureDetail(applied.failure._tag, "slot move");
          return {
            outcome: "failed",
            detail,
            steps: [...steps, step("failed", detail, stepAt)],
            settled: false,
          };
        }
        const outcome = writeOutcome(applied.success);
        const detail = writeDetail(applied.success, "slot move");
        return {
          outcome,
          ...(detail === undefined ? {} : { detail }),
          steps: [...steps, step(outcome, detail, stepAt)],
          settled: outcome === "executed",
        };
      });
    }

    function executeTradeItem(input: {
      readonly userId: UserId;
      readonly item: ProposalItemRecord;
      readonly change: ProposalItemChange;
      readonly facts: TeamFacts;
      readonly context: TeamContext;
    }): Effect.Effect<ItemExecution> {
      return Effect.gen(function* () {
        const counterpartyKey = input.item.counterpartyKey;
        if (counterpartyKey === undefined) {
          return {
            outcome: "failed",
            detail: "This trade names no counterparty, so no offer was sent.",
            steps: [],
            settled: false,
          };
        }
        const send = input.change.drops.map((drop) => drop.key);
        const receive = input.change.adds.map((add) => add.key);
        if (send.length === 0 || receive.length === 0) {
          return {
            outcome: "failed",
            detail:
              "A trade needs at least one player going out and one coming back, so no offer was sent.",
            steps: [],
            settled: false,
          };
        }
        const requestedAt = yield* DateTime.now;
        const sent = yield* Effect.result(
          input.context.provider.proposeTrade({
            ...providerIdentity(input.context),
            providerLeagueKey: input.facts.league.providerLeagueKey,
            providerTeamKey: input.facts.providerTeamKey,
            counterpartyTeamKey: counterpartyKey,
            send,
            receive,
            note: undefined,
          }),
        );
        const decidedAt = yield* DateTime.now;
        if (sent._tag === "Failure") {
          if (sent.failure._tag === "provider.session_rejected") {
            yield* queries.recordSessionRejected(
              input.userId,
              input.context.owned,
              sessionEvidenceOf(sent.failure),
            );
          }
          return {
            outcome: "failed",
            detail: sessionFailureDetail(sent.failure._tag, "transaction"),
            steps: [],
            settled: false,
          };
        }
        switch (sent.success.status) {
          case "accepted":
            return {
              outcome: "pending",
              detail: `Offer sent to ${input.item.counterpartyName ?? "the counterparty"}. The other manager decides; we cannot accept on their behalf.`,
              steps: [],
              settled: false,
              trade: {
                providerKey: sent.success.transactionKey,
                state: "pending",
                requestedAt,
                detail: `Offer created ${DateTime.formatIso(decidedAt)}.`,
              },
            };
          case "unknown":
            return {
              outcome: "unknown",
              detail:
                "Your league did not confirm the trade offer, so it may or may not exist. It was not retried. Check the trade page before proposing again.",
              steps: [],
              settled: false,
            };
          case "rejected":
            return {
              outcome: "failed",
              detail:
                writeDetail(sent.success, "trade offer") ??
                "Your league rejected the trade offer. Nothing was retried.",
              steps: [],
              settled: false,
            };
          case "not_sent":
            return {
              outcome: "failed",
              detail: notSentDetail("request", sent.success),
              steps: [],
              settled: false,
            };
        }
      });
    }

    const readPendingOffers: TransactionProposals["Service"]["readPendingOffers"] = Effect.fn(
      "TransactionProposals.readPendingOffers",
    )(function* (userId: UserId, input) {
      const loaded = yield* Effect.result(
        loadTeamContext(queries, encryption, registry, userId, input.team),
      );
      if (loaded._tag === "Failure") {
        switch (loaded.failure._tag) {
          case "query.team_not_found":
            return yield* ProposalTeamNotFound.make({ team: input.team });
          case "query.connection_not_ready":
            return yield* ProposalConnectionNotReady.make({
              team: input.team,
              status: loaded.failure.status,
            });
          case "query.cursor_invalid":
          case "query.reference_invalid":
          case "query.selection_invalid":
          case "query.persistence_failed":
            return yield* ProposalPersistenceFailed.make({ cause: loaded.failure });
        }
      }
      const context = loaded.success;
      const agentNotes = yield* queries
        .recentAgentNotes(userId, input.team)
        .pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
      const fetchedAt = yield* DateTime.now;
      const outcome = yield* context.provider
        .readPendingTrades({
          ...providerIdentity(context),
          providerLeagueKey: context.owned.team.providerLeagueKey,
          providerTeamKey: context.owned.team.providerTeamKey,
        })
        .pipe(
          Effect.matchEffect({
            onSuccess: (trades) => Effect.succeed({ status: "ok" as const, trades }),
            onFailure: (error) => {
              if (error._tag === "provider.operation_unsupported") {
                return Effect.succeed({ status: "unsupported" as const, detail: error.reason });
              }
              const unavailable = ProposalProviderUnavailable.make({
                detail:
                  error._tag === "provider.session_rejected"
                    ? "Your league rejected the stored sign-in. Reconnect and read the offers again."
                    : error._tag === "provider.request_failed"
                      ? "The pending trade offers at your league could not be read."
                      : "The pending trade offers at your league could not be verified.",
              });
              return error._tag === "provider.session_rejected"
                ? queries
                    .recordSessionRejected(userId, context.owned, sessionEvidenceOf(error))
                    .pipe(Effect.andThen(unavailable))
                : unavailable;
            },
          }),
        );
      const team = teamView(context.owned.team);
      if (outcome.status === "unsupported") {
        return yield* Schema.decodeEffect(PendingTradeOffersResultSchema)({
          status: "unsupported",
          team,
          readOnly: true,
          offers: [],
          ownerNote: ownerNoteOf(context.owned.team),
          agentNotes,
          coverage: [
            {
              resource: "pending_trade_offers",
              status: "unsupported",
              source: "provider",
              fetchedAt,
              detail: outcome.detail,
            },
          ],
          detail:
            "Your league publishes no pending trade offers for this read, so none are shown rather than an empty success.",
        }).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
      }
      const offers = yield* toPendingTradeOffers(
        tokens,
        userId,
        context.owned.team.providerLeagueKey,
        context.owned.team.providerTeamKey,
        outcome.trades,
      );
      return yield* Schema.decodeEffect(PendingTradeOffersResultSchema)({
        status: "available",
        team,
        readOnly: true,
        offers,
        ownerNote: ownerNoteOf(context.owned.team),
        agentNotes,
        coverage: [
          {
            resource: "pending_trade_offers",
            status: "available",
            source: "provider_pending_trade",
            fetchedAt,
          },
        ],
        detail:
          "Read-only. These are this team's pending trade offers as your league publishes them to this account. Lineupgrade cannot accept, reject, or vote on an offer; a signed-in person can withdraw an offer this account made from the review page.",
      }).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
    });

    function loadPendingOffers(
      userId: UserId,
      teamIds: ReadonlyArray<TeamId>,
      teamsById: ReadonlyMap<TeamId, ProposalTeamRecord>,
    ): Effect.Effect<
      ReadonlyMap<TeamId, ReadonlyArray<PendingTradeOffer>>,
      ProposalPersistenceFailed
    > {
      return Effect.gen(function* () {
        const rejected: Array<{
          readonly owned: Parameters<typeof queries.recordSessionRejected>[1];
          readonly evidence: Parameters<typeof queries.recordSessionRejected>[2];
        }> = [];
        const feeds = yield* Effect.forEach(
          [...new Set(teamIds)],
          (teamId) =>
            Effect.gen(function* () {
              const team = teamsById.get(teamId);
              if (team === undefined) {
                return { teamId, leagueKey: undefined, teamKey: undefined, trades: [] } as const;
              }
              const loaded = yield* Effect.result(
                loadTeamContext(queries, encryption, registry, userId, teamId),
              );
              if (loaded._tag === "Failure") {
                return { teamId, leagueKey: undefined, teamKey: undefined, trades: [] } as const;
              }
              const context = loaded.success;
              const offers = yield* Effect.result(
                context.provider.readPendingTrades({
                  ...providerIdentity(context),
                  providerLeagueKey: team.providerLeagueKey,
                  providerTeamKey: context.owned.team.providerTeamKey,
                }),
              );
              if (offers._tag === "Failure") {
                if (offers.failure._tag === "provider.session_rejected") {
                  rejected.push({
                    owned: context.owned,
                    evidence: sessionEvidenceOf(offers.failure),
                  });
                }
                return { teamId, leagueKey: undefined, teamKey: undefined, trades: [] } as const;
              }
              return {
                teamId,
                leagueKey: team.providerLeagueKey,
                teamKey: context.owned.team.providerTeamKey,
                trades: offers.success,
              } as const;
            }),
          { concurrency: 3 },
        );
        yield* queries.recordSessionRejectedMany(userId, rejected);
        const withTrades = feeds.filter(
          (
            feed,
          ): feed is {
            readonly teamId: TeamId;
            readonly leagueKey: string;
            readonly teamKey: string;
            readonly trades: ReadonlyArray<ProviderPendingTrade>;
          } => feed.leagueKey !== undefined && feed.trades.length > 0,
        );
        const mappedGroups = yield* toPendingTradeOffersGroups(
          tokens,
          userId,
          withTrades.map((feed) => ({
            leagueKey: feed.leagueKey,
            teamKey: feed.teamKey,
            trades: feed.trades,
          })),
        );
        const mappedByTeam = new Map<TeamId, ReadonlyArray<PendingTradeOffer>>();
        for (const [feedIndex, feed] of withTrades.entries()) {
          mappedByTeam.set(feed.teamId, Array.getUnsafe(mappedGroups, feedIndex));
        }
        return new Map(
          feeds.map((feed) => [feed.teamId, mappedByTeam.get(feed.teamId) ?? []] as const),
        );
      });
    }

    const withdrawTrade: TransactionProposals["Service"]["withdrawTrade"] = Effect.fn(
      "TransactionProposals.withdrawTrade",
    )(function* (userId: UserId, input) {
      const decoded = yield* Schema.decodeEffect(WithdrawTradeInput)(input).pipe(
        Effect.mapError(() =>
          ProposalContentInvalid.make({
            detail:
              "A withdrawal names one owned team and exactly one pending offer, either a stored proposal item or a pending offer at your league.",
          }),
        ),
      );
      if ((decoded.item === undefined) === (decoded.offer === undefined)) {
        return yield* ProposalContentInvalid.make({
          detail:
            "A withdrawal names exactly one target: a proposal item id or a pending offer reference at your league.",
        });
      }
      const loaded = yield* Effect.result(
        loadTeamContext(queries, encryption, registry, userId, decoded.team),
      );
      if (loaded._tag === "Failure") {
        switch (loaded.failure._tag) {
          case "query.team_not_found":
            return yield* ProposalTeamNotFound.make({ team: decoded.team });
          case "query.connection_not_ready":
            return yield* ProposalConnectionNotReady.make({
              team: decoded.team,
              status: loaded.failure.status,
            });
          case "query.cursor_invalid":
          case "query.reference_invalid":
          case "query.selection_invalid":
          case "query.persistence_failed":
            return yield* ProposalPersistenceFailed.make({ cause: loaded.failure });
        }
      }
      const context = loaded.success;
      let transactionKey: string;
      let item: ProposalItemRecord | undefined;
      if (decoded.item !== undefined) {
        item = yield* repository.loadItem(userId, decoded.item);
        if (item === undefined || item.kind !== "trade" || item.team !== decoded.team) {
          return yield* ProposalTradeNotFound.make({
            detail:
              "That trade proposal is not available for this team. Reload the review and try again.",
          });
        }
        if (item.connection !== context.owned.connection.id) {
          return yield* ProposalTradeNotPending.make({
            state: item.trade?.state ?? "pending",
            detail:
              "This team now belongs to a different connection, so the offer was not withdrawn with the stored sign-in. Reload and check the trade page.",
          });
        }
        if (item.trade === undefined || item.trade.state !== "pending") {
          return yield* ProposalTradeNotPending.make({
            state: item.trade?.state ?? "expired",
            detail:
              item.trade === undefined
                ? "This trade was never offered to your league, so there is nothing to withdraw."
                : `This offer is ${item.trade.state}, so it is no longer pending.`,
          });
        }
        transactionKey = item.trade.providerKey;
      } else {
        if (decoded.offer === undefined) {
          return yield* ProposalTradeNotFound.make({
            detail:
              "That pending offer reference did not come from a read of this team's league. Read the pending offers again.",
          });
        }
        const opened = yield* Effect.result(
          tokens.openTradeOfferRef({
            userId,
            leagueKey: context.owned.team.providerLeagueKey,
            ref: decoded.offer,
          }),
        );
        if (opened._tag === "Failure") {
          return yield* ProposalTradeNotFound.make({
            detail:
              "That pending offer reference did not come from a read of this team's league. Read the pending offers again.",
          });
        }
        transactionKey = opened.success;
      }
      const before = yield* Effect.result(
        context.provider.readPendingTrades({
          ...providerIdentity(context),
          providerLeagueKey: context.owned.team.providerLeagueKey,
          providerTeamKey: context.owned.team.providerTeamKey,
        }),
      );
      if (before._tag === "Failure") {
        if (before.failure._tag === "provider.session_rejected") {
          yield* queries.recordSessionRejected(
            userId,
            context.owned,
            sessionEvidenceOf(before.failure),
          );
        }
        return yield* ProposalProviderUnavailable.make({
          detail:
            "The pending trade offers at your league could not be read, so nothing was withdrawn. Check the trade page before trying again.",
        });
      }
      if (!before.success.some((offer) => offer.transactionKey === transactionKey)) {
        return yield* ProposalTradeNotPending.make({
          state: item?.trade?.state ?? "expired",
          detail:
            "Your league does not list this offer as pending, so nothing was withdrawn. Reload to check.",
        });
      }
      const withdrawn = yield* Effect.result(
        context.provider.withdrawTrade({
          ...providerIdentity(context),
          transactionKey,
        }),
      );
      if (withdrawn._tag === "Failure") {
        if (withdrawn.failure._tag === "provider.session_rejected") {
          yield* queries.recordSessionRejected(
            userId,
            context.owned,
            sessionEvidenceOf(withdrawn.failure),
          );
        }
        return yield* ProposalProviderUnavailable.make({
          detail:
            withdrawn.failure._tag === "provider.session_rejected"
              ? "Your league rejected the stored sign-in, so the offer was not withdrawn. Reconnect and check the trade page."
              : "The withdrawal request could not be prepared, so nothing was withdrawn.",
        });
      }
      switch (withdrawn.success.status) {
        case "accepted": {
          const after = yield* Effect.result(
            context.provider.readPendingTrades({
              ...providerIdentity(context),
              providerLeagueKey: context.owned.team.providerLeagueKey,
              providerTeamKey: context.owned.team.providerTeamKey,
            }),
          );
          if (
            after._tag === "Success" &&
            after.success.some((offer) => offer.transactionKey === transactionKey)
          ) {
            return yield* ProposalProviderUnavailable.make({
              detail:
                "Your league accepted the withdrawal but still lists the offer as pending. Nothing else was attempted; check the trade page.",
            });
          }
          const at = yield* DateTime.now;
          if (item?.trade !== undefined) {
            yield* repository.saveTradeStates({
              userId,
              changes: [
                {
                  itemId: item.id,
                  state: "withdrawn",
                  trade: {
                    ...item.trade,
                    state: "withdrawn",
                    settledAt: at,
                    detail: "Withdrawn before acceptance. Your league deletes a withdrawn offer.",
                  },
                  at,
                },
              ],
            });
          }
          return yield* Schema.decodeEffect(WithdrawTradeResultSchema)({
            status: "withdrawn",
            tradeState: "withdrawn",
            detail:
              "Your league confirmed the withdrawal and no longer lists the offer. Nothing was accepted on the other manager's behalf.",
          }).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        }
        case "unknown":
          return yield* ProposalProviderUnavailable.make({
            detail:
              "Your league did not confirm the withdrawal, so it may or may not have applied. It was not retried. Check the trade page.",
          });
        case "not_sent":
        case "rejected":
          return yield* ProposalProviderUnavailable.make({
            detail: withdrawalDetail(withdrawn.success),
          });
      }
    });

    return TransactionProposals.of({
      propose,
      revalidate,
      withdrawItems,
      read,
      submit,
      readPendingOffers,
      withdrawTrade,
    });

    function stageTrades(
      userId: UserId,
      candidates: ReadonlyArray<OpenedDraft>,
    ): Effect.Effect<ReadonlyMap<number, StagedTrade>> {
      if (candidates.length === 0) {
        return Effect.succeed(new Map());
      }
      const byTeam = new Map<TeamId, Array<OpenedDraft>>();
      for (const candidate of candidates) {
        const current = byTeam.get(candidate.team.id) ?? [];
        current.push(candidate);
        byTeam.set(candidate.team.id, current);
      }
      return Effect.gen(function* () {
        const groups = yield* Effect.forEach(
          [...byTeam.entries()],
          ([teamId, entries]) => stageTeamTrades(userId, teamId, entries),
          { concurrency: 3 },
        );
        return new Map(groups.flatMap((group) => [...group.entries()]));
      });
    }

    function stageTeamTrades(
      userId: UserId,
      teamId: TeamId,
      candidates: ReadonlyArray<OpenedDraft>,
    ): Effect.Effect<ReadonlyMap<number, StagedTrade>> {
      return Effect.gen(function* () {
        const refused = new Map<number, StagedTrade>();
        const context = yield* Effect.result(
          loadTeamContext(queries, encryption, registry, userId, teamId),
        );
        if (context._tag === "Failure") {
          for (const candidate of candidates) {
            refused.set(candidate.index, {
              outcome: "refused",
              refusal: tradeRefusal(
                candidate.index,
                "trade_state_unavailable",
                `Item ${String(candidate.index + 1)} cannot be checked because ${queryFailureDetail(context.failure)}`,
                "Read the team, the league, and both rosters again, then propose the trade.",
              ),
            });
          }
          return refused;
        }
        const owned = context.success;
        const leagueKey = owned.owned.team.providerLeagueKey;
        const identity = providerIdentity(owned);
        const [leagueResult, rosterResult, teamsResult] = yield* Effect.all(
          [
            Effect.result(
              owned.provider.readLeague({
                ...identity,
                providerLeagueKey: leagueKey,
                sport: owned.owned.team.sport,
              }),
            ),
            Effect.result(
              owned.provider.readRoster({
                ...identity,
                providerTeamKey: owned.owned.team.providerTeamKey,
                period: undefined,
              }),
            ),
            Effect.result(
              owned.provider.readLeagueTeams({ ...identity, providerLeagueKey: leagueKey }),
            ),
          ] as const,
          { concurrency: "unbounded" },
        );
        if (
          leagueResult._tag === "Failure" ||
          rosterResult._tag === "Failure" ||
          teamsResult._tag === "Failure"
        ) {
          const failure =
            leagueResult._tag === "Failure"
              ? leagueResult.failure._tag
              : rosterResult._tag === "Failure"
                ? rosterResult.failure._tag
                : teamsResult._tag === "Failure"
                  ? teamsResult.failure._tag
                  : "unknown";
          if (failure === "provider.session_rejected") {
            yield* queries.recordSessionRejected(userId, owned.owned);
          }
          for (const candidate of candidates) {
            refused.set(candidate.index, {
              outcome: "refused",
              refusal: tradeRefusal(
                candidate.index,
                "trade_state_unavailable",
                `Item ${String(candidate.index + 1)} cannot be checked against your league (${failure}).`,
                "Read the team, the league, and both rosters again, then propose the trade.",
              ),
            });
          }
          return refused;
        }
        const league = leagueResult.success;
        const roster = rosterResult.success;
        const leagueTeams = teamsResult.success;
        const rosterByPlayer = new Map(
          roster.players.map((player) => [player.providerPlayerKey, player] as const),
        );
        const teamByKey = new Map(leagueTeams.map((team) => [team.providerTeamKey, team] as const));
        const counterpartyKeys = [
          ...new Set(
            candidates.flatMap((candidate) =>
              candidate.counterpartyKey === undefined ? [] : [candidate.counterpartyKey],
            ),
          ),
        ];
        const opponentRosters = yield* Effect.forEach(
          counterpartyKeys,
          (key) =>
            Effect.result(
              owned.provider.readRoster({
                ...identity,
                providerTeamKey: key,
                period: undefined,
              }),
            ).pipe(Effect.map((result) => [key, result] as const)),
          { concurrency: 3 },
        );
        const opponentByKey = new Map(opponentRosters);
        const windowClosed = tradeWindowClosed(league);
        for (const candidate of candidates) {
          const counterpartyKey = candidate.counterpartyKey;
          if (
            counterpartyKey === undefined ||
            counterpartyKey === owned.owned.team.providerTeamKey
          ) {
            refused.set(candidate.index, {
              outcome: "refused",
              refusal: tradeRefusal(
                candidate.index,
                "trade_counterparty_invalid",
                `Item ${String(candidate.index + 1)} names a counterparty that is not another team in this league.`,
                "Read this league's teams again and name another team in the same league as the counterparty.",
              ),
            });
            continue;
          }
          const counterparty = teamByKey.get(counterpartyKey);
          if (counterparty === undefined) {
            refused.set(candidate.index, {
              outcome: "refused",
              refusal: tradeRefusal(
                candidate.index,
                "trade_counterparty_invalid",
                `Item ${String(candidate.index + 1)} names a counterparty in another league.`,
                "Read this league's teams again and name another team in the same league as the counterparty.",
              ),
            });
            continue;
          }
          if (league.tradeEndDate === undefined || league.currentDate === undefined) {
            refused.set(candidate.index, {
              outcome: "refused",
              refusal: tradeRefusal(
                candidate.index,
                "trade_state_unavailable",
                `Item ${String(candidate.index + 1)} cannot be checked because the league publishes no trade end date or current date.`,
                "Read the league again; a trade cannot be checked until your league publishes both dates.",
              ),
            });
            continue;
          }
          if (windowClosed) {
            refused.set(candidate.index, {
              outcome: "refused",
              refusal: tradeRefusal(
                candidate.index,
                "trade_window_closed",
                `Item ${String(candidate.index + 1)} cannot be proposed because the league's trade window closed on ${league.tradeEndDate}.`,
                "Wait for the league's next trade window and propose the trade then.",
              ),
            });
            continue;
          }
          const opponent = opponentByKey.get(counterpartyKey);
          if (opponent?._tag === "Failure") {
            refused.set(candidate.index, {
              outcome: "refused",
              refusal: tradeRefusal(
                candidate.index,
                "trade_state_unavailable",
                `Item ${String(candidate.index + 1)} cannot be checked because the counterparty's roster could not be read.`,
                "Read the league's teams and the counterparty's roster again, then propose the trade.",
              ),
            });
            continue;
          }
          const opponentPlayers = new Map(
            opponent?.success.players.map(
              (player) => [player.providerPlayerKey, player] as const,
            ) ?? [],
          );
          const missingDrop = candidate.drops.find((key) => !rosterByPlayer.has(key));
          if (missingDrop !== undefined) {
            refused.set(candidate.index, {
              outcome: "refused",
              refusal: tradeRefusal(
                candidate.index,
                "trade_player_not_rostered",
                `Item ${String(candidate.index + 1)} sends a player who is not on this team's roster.`,
                "Read this team's roster again and name only a player your league still lists on it.",
              ),
            });
            continue;
          }
          const missingAdd = candidate.adds.find((key) => !opponentPlayers.has(key));
          if (missingAdd !== undefined) {
            refused.set(candidate.index, {
              outcome: "refused",
              refusal: tradeRefusal(
                candidate.index,
                "trade_player_not_rostered",
                `Item ${String(candidate.index + 1)} asks for a player who is not on ${counterparty.name}'s roster.`,
                "Read both rosters again and name only players your league still lists on the team they would leave.",
              ),
            });
            continue;
          }
          refused.set(candidate.index, {
            outcome: "staged",
            counterpartyKey,
            counterpartyName: counterparty.name,
            adds: candidate.adds.map((key) => {
              const player = opponentPlayers.get(key);
              if (player === undefined) {
                throw new Error("A staged trade add lost its roster row");
              }
              return proposalPlayerOf(player);
            }),
            drops: candidate.drops.map((key) => {
              const player = rosterByPlayer.get(key);
              if (player === undefined) {
                throw new Error("A staged trade drop lost its roster row");
              }
              return proposalPlayerOf(player);
            }),
          });
        }
        return refused;
      });
    }

    function loadTeamData(
      userId: UserId,
      team: ProposalTeamRecord | undefined,
      items: ReadonlyArray<ProposalItemRecord>,
    ): Effect.Effect<TeamData> {
      return Effect.gen(function* () {
        if (team === undefined) {
          return {
            status: "failed",
            detail:
              "Current state could not be read: this team is no longer linked to the account.",
          } satisfies TeamData;
        }
        const loaded = yield* Effect.result(
          loadTeamContext(queries, encryption, registry, userId, team.id),
        );
        if (loaded._tag === "Failure") {
          return {
            status: "failed",
            detail: `Current state could not be read: ${queryFailureDetail(loaded.failure)}`,
          } satisfies TeamData;
        }
        const context = loaded.success;
        const league = yield* Effect.result(
          context.provider.readLeague({
            ...providerIdentity(context),
            providerLeagueKey: context.owned.team.providerLeagueKey,
            sport: context.owned.team.sport,
          }),
        );
        if (league._tag === "Failure") {
          return {
            status: "failed",
            detail: yield* providerFailureDetail(userId, context, league.failure._tag),
          } satisfies TeamData;
        }
        const settings = league.success;
        const coverage = proposalCoverage(settings);
        if (coverage === undefined) {
          return {
            status: "failed",
            detail:
              "Current state could not be read: the league publishes no current date or scoring week, so the roster the moves would apply to cannot be read.",
          } satisfies TeamData;
        }
        const addKeys = [
          ...new Set(
            items
              .filter((item) => item.kind !== "trade")
              .flatMap((item) => item.adds.map((add) => add.key)),
          ),
        ];
        const needsBudget = items.some((item) => item.bid !== undefined);
        const needsTrade = items.some((item) => item.kind === "trade");
        const counterpartyKeys = [
          ...new Set(
            items.flatMap((item) =>
              item.kind === "trade" && item.counterpartyKey !== undefined
                ? [item.counterpartyKey]
                : [],
            ),
          ),
        ].filter((key) => key !== context.owned.team.providerTeamKey);
        const roster: Effect.Effect<Result.Result<ProviderRoster, ProviderReadFailure>> =
          Effect.result(
            context.provider.readRoster({
              ...providerIdentity(context),
              providerTeamKey: context.owned.team.providerTeamKey,
              period: coverage,
            }),
          );
        const leagueTeams: Effect.Effect<
          Result.Result<ReadonlyArray<ProviderLeagueTeam>, ProviderReadFailure>
        > =
          needsBudget || needsTrade
            ? Effect.result(
                context.provider.readLeagueTeams({
                  ...providerIdentity(context),
                  providerLeagueKey: context.owned.team.providerLeagueKey,
                }),
              )
            : Effect.succeed(Result.succeed<ReadonlyArray<ProviderLeagueTeam>>([]));
        const details: Effect.Effect<
          Result.Result<ReadonlyArray<ProviderPlayerDetail>, ProviderReadFailure>
        > =
          addKeys.length === 0
            ? Effect.succeed(Result.succeed<ReadonlyArray<ProviderPlayerDetail>>([]))
            : Effect.result(
                context.provider.readPlayerDetails({
                  ...providerIdentity(context),
                  providerLeagueKey: context.owned.team.providerLeagueKey,
                  providerPlayerKeys: addKeys,
                  sport: context.owned.team.sport,
                  period: { kind: "season" },
                  currentPeriod: settings.periodWindow?.current,
                  seasonStart: settings.startDate,
                  seasonEnd: settings.endDate,
                }),
              );
        const timingRule = settings.rosterChange?.rule;
        const currentWeek =
          settings.rosterCoverage === "week" ? settings.periodWindow?.current : undefined;
        const needsWeeks =
          timingRule === "weekly_lock" &&
          currentWeek !== undefined &&
          items.some(
            (item) =>
              (item.kind === "free_agent_add" || item.kind === "waiver_claim") &&
              item.adds.length > 0,
          );
        const weeks: Effect.Effect<
          Result.Result<ReadonlyArray<ProviderPlayerWeekFact>, ProviderReadFailure>
        > = needsWeeks
          ? Effect.result(
              context.provider.readPlayerWeeks({
                ...providerIdentity(context),
                providerLeagueKey: context.owned.team.providerLeagueKey,
                providerPlayerKeys: addKeys,
                week: { week: currentWeek },
              }),
            )
          : Effect.succeed(Result.succeed<ReadonlyArray<ProviderPlayerWeekFact>>([]));
        const tradeRosters: Effect.Effect<
          ReadonlyMap<string, Result.Result<ProviderRoster, ProviderReadFailure>>
        > =
          counterpartyKeys.length === 0
            ? Effect.succeed(new Map())
            : Effect.forEach(
                counterpartyKeys,
                (key) =>
                  Effect.result(
                    context.provider.readRoster({
                      ...providerIdentity(context),
                      providerTeamKey: key,
                      period: coverage,
                    }),
                  ).pipe(Effect.map((result) => [key, result] as const)),
                { concurrency: 3 },
              ).pipe(Effect.map((entries) => new Map(entries)));
        const noTradeFeed: TradeFeed | undefined = undefined;
        const tradeFeed: Effect.Effect<TradeFeed | undefined> = !needsTrade
          ? Effect.succeed(noTradeFeed)
          : Effect.gen(function* () {
              const pending = yield* Effect.result(
                context.provider.readPendingTrades({
                  ...providerIdentity(context),
                  providerLeagueKey: context.owned.team.providerLeagueKey,
                  providerTeamKey: context.owned.team.providerTeamKey,
                }),
              );
              if (pending._tag === "Failure") {
                if (pending.failure._tag === "provider.session_rejected") {
                  yield* queries.recordSessionRejected(
                    userId,
                    context.owned,
                    sessionEvidenceOf(pending.failure),
                  );
                }
                return {
                  pending: [],
                  completed: [],
                  completedUnavailable: true,
                } satisfies TradeFeed;
              }
              const completed = yield* Effect.result(
                context.provider.readCompletedTrades({
                  ...providerIdentity(context),
                  providerLeagueKey: context.owned.team.providerLeagueKey,
                  providerTeamKey: context.owned.team.providerTeamKey,
                  limit: 50,
                }),
              );
              return {
                pending: pending.success,
                completed: completed._tag === "Success" ? completed.success : [],
                completedUnavailable: completed._tag === "Failure",
              } satisfies TradeFeed;
            });
        const [rosterResult, teamsResult, detailsResult, weeksResult, tradeRostersResult, feed] =
          yield* Effect.all(
            [roster, leagueTeams, details, weeks, tradeRosters, tradeFeed] as const,
            {
              concurrency: "unbounded",
            },
          );
        if (rosterResult._tag === "Failure") {
          return {
            status: "failed",
            detail: yield* providerFailureDetail(userId, context, rosterResult.failure._tag),
          } satisfies TeamData;
        }
        if (teamsResult._tag === "Failure") {
          return {
            status: "failed",
            detail: yield* providerFailureDetail(userId, context, teamsResult.failure._tag),
          } satisfies TeamData;
        }
        if (detailsResult._tag === "Failure") {
          return {
            status: "failed",
            detail: yield* providerFailureDetail(userId, context, detailsResult.failure._tag),
          } satisfies TeamData;
        }
        const facts: TeamFacts = {
          league: settings,
          roster: rosterResult.success,
          leagueTeams: teamsResult.success,
          providerTeamKey: context.owned.team.providerTeamKey,
          players: new Map(
            detailsResult.success.map((detail) => [detail.providerPlayerKey, detail] as const),
          ),
          weeks: new Map(
            (weeksResult._tag === "Success" ? weeksResult.success : []).map((week) => [
              week.providerPlayerKey,
              week,
            ]),
          ),
          tradeRosters: new Map(
            [...tradeRostersResult.entries()].flatMap(([key, result]) =>
              result._tag === "Success" ? [[key, result.success] as const] : [],
            ),
          ),
        };
        return {
          status: "ready",
          facts,
          context,
          tradeFeed: feed,
        } satisfies TeamData;
      });
    }

    function providerFailureDetail(
      userId: UserId,
      context: TeamContext,
      failure: string,
    ): Effect.Effect<string> {
      const detail = `Current state could not be read: a read from your league failed (${failure}).`;
      return failure === "provider.session_rejected"
        ? queries.recordSessionRejected(userId, context.owned).pipe(Effect.as(detail))
        : Effect.succeed(detail);
    }

    function evaluateTeam(
      teamId: TeamId,
      data: TeamData,
      items: ReadonlyArray<ProposalItemRecord>,
      at: DateTime.Utc,
    ): TeamCheck {
      if (data.status === "failed") {
        return failedCheck(teamId, items, data.detail, at);
      }
      const budget = budgetOf(data.facts, items);
      const changes = items.map((item) =>
        evaluateItem(item, data.facts, budget, at, data.tradeFeed),
      );
      const placed = placeTeam(data.facts, items, changes, at);
      const plan = orderFor(data.facts, items, placed.changes, placed.resolutions);
      const ordered = orderChanges(placed.changes, items, plan, at);
      const order = publishedOrder(plan.plan, items, ordered);
      return {
        team: teamId,
        ...(budget === undefined ? {} : { budget }),
        facts: data.facts,
        context: data.context,
        ...(data.tradeFeed === undefined ? {} : { tradeFeed: data.tradeFeed }),
        changes: ordered,
        ...(order === undefined ? {} : { order }),
      };
    }

    function checkTeam(
      userId: UserId,
      teamId: TeamId,
      team: ProposalTeamRecord | undefined,
      items: ReadonlyArray<ProposalItemRecord>,
      at: DateTime.Utc,
    ): Effect.Effect<TeamCheck> {
      return loadTeamData(userId, team, items).pipe(
        Effect.map((data) => evaluateTeam(teamId, data, items, at)),
      );
    }
  }),
);

type TeamPlan = {
  readonly plan: ProposalOrderPlan | undefined;
  readonly refused: ReadonlyMap<
    string,
    { readonly code: ProposalOrderRefusalCode; readonly detail: string }
  >;
};

type PlacementResolution = {
  readonly move?: {
    readonly player: { readonly key: string; readonly name: string };
    readonly toSlot: string;
  };
  readonly after?: {
    readonly playerKey: string;
    readonly playerName: string;
    readonly fromSlot?: string;
    readonly toSlot: string;
  };
};

type PlacedTeam = {
  readonly changes: ReadonlyArray<ProposalItemChange>;
  readonly resolutions: ReadonlyMap<string, PlacementResolution>;
};

function placeTeam(
  facts: TeamFacts,
  items: ReadonlyArray<ProposalItemRecord>,
  changes: ReadonlyArray<ProposalItemChange>,
  at: DateTime.Utc,
): PlacedTeam {
  const placementItems = items.flatMap((item, index) => {
    const change = changes[index];
    if (change === undefined || item.kind === "trade" || change.staleness.status !== "current") {
      return [];
    }
    return [
      {
        id: item.id,
        adds: change.adds.map((add) => ({
          key: add.key,
          name: add.name ?? add.key,
          positions: facts.players.get(add.key)?.eligiblePositions ?? [],
        })),
        drops: change.drops.map((drop) => ({ key: drop.key, name: drop.name ?? drop.key })),
        move:
          item.kind === "slot_move" && item.slotMove !== undefined
            ? {
                player: {
                  key: item.slotMove.playerKey,
                  name: item.slotMove.playerName ?? item.slotMove.playerKey,
                },
                toSlot: item.slotMove.toSlot,
              }
            : undefined,
        intent: placementIntentOf(item),
      },
    ];
  });
  if (placementItems.length === 0) {
    return { changes, resolutions: new Map() };
  }
  const placed = placeIntentItems({
    constraints: facts.league.rosterConstraints,
    slots: facts.league.rosterPositions.map((slot) => ({
      position: slot.position,
      kind: slot.kind,
      count: slot.count,
      eligibility: slot.eligibility,
    })),
    players: facts.roster.players.map((player) => ({
      key: player.providerPlayerKey,
      name: player.name,
      positions: player.eligiblePositions,
      slot: player.slot.status === "verified" ? player.slot.slot : undefined,
      editable: player.isEditable === true,
      injured: player.injuryCode !== undefined || player.injuryDetail !== undefined,
    })),
    items: placementItems,
  });
  return applyPlacement(placed, changes, at);
}

function placementIntentOf(item: ProposalItemRecord): ProposalPlacementIntent | undefined {
  if (item.kind === "activate" || item.kind === "stash") {
    const player = item.intent?.player;
    return player === undefined
      ? undefined
      : { kind: item.kind, player: { key: player.key, name: player.name ?? player.key } };
  }
  if ((item.kind === "free_agent_add" || item.kind === "waiver_claim") && item.adds.length === 1) {
    return { kind: "add", to: item.intent?.to ?? "active" };
  }
  return undefined;
}

function applyPlacement(
  placed: ProposalPlacementResult,
  changes: ReadonlyArray<ProposalItemChange>,
  at: DateTime.Utc,
): PlacedTeam {
  const refused = new Map(placed.refused.map((entry) => [entry.item, entry] as const));
  const placements = new Map(placed.placements.map((entry) => [entry.item, entry] as const));
  const moves = new Map(placed.moves.map((entry) => [entry.item, entry] as const));
  const after = new Map(placed.after.map((entry) => [entry.item, entry.repair] as const));
  const resolutions = new Map<string, PlacementResolution>();
  const updated = changes.map((change) => {
    const refusal = refused.get(change.id);
    if (refusal !== undefined) {
      return {
        ...change,
        placement: undefined,
        staleness:
          refusal.code === "slot_illegal"
            ? checked([], [{ code: refusal.code, detail: refusal.detail }], at)
            : staleCheck([{ code: refusal.code, detail: refusal.detail }], at),
      };
    }
    const placement = placements.get(change.id);
    if (placement === undefined) {
      return change;
    }
    const move = moves.get(change.id);
    const repair = after.get(change.id);
    resolutions.set(change.id, {
      ...(move === undefined ? {} : { move }),
      ...(repair === undefined ? {} : { after: repair }),
    });
    return {
      ...change,
      placement: {
        playerKey: placement.playerKey,
        playerName: placement.playerName,
        ...(placement.fromSlot === undefined ? {} : { fromSlot: placement.fromSlot }),
        toSlot: placement.toSlot,
        detail: placement.detail,
      },
    };
  });
  return { changes: updated, resolutions };
}

function orderFor(
  facts: TeamFacts,
  items: ReadonlyArray<ProposalItemRecord>,
  changes: ReadonlyArray<ProposalItemChange>,
  resolutions: ReadonlyMap<string, PlacementResolution>,
): TeamPlan {
  let remaining: Array<ProposalOrderItem> = [];
  for (const [index, change] of changes.entries()) {
    const item = items[index];
    if (item === undefined || item.kind === "trade" || change.staleness.status !== "current") {
      continue;
    }
    remaining.push(orderItemOf(facts, item, change, resolutions.get(item.id)));
  }
  if (remaining.length === 0) {
    return { plan: undefined, refused: new Map() };
  }
  const players: ReadonlyArray<ProposalOrderPlayer> = facts.roster.players.map((player) => ({
    key: player.providerPlayerKey,
    name: player.name,
    positions: player.eligiblePositions,
    slot: player.slot.status === "verified" ? player.slot.slot : undefined,
    editable: player.isEditable === true,
    injured: player.injuryCode !== undefined || player.injuryDetail !== undefined,
  }));
  const slots = facts.league.rosterPositions.map((slot) => ({
    position: slot.position,
    kind: slot.kind,
    count: slot.count,
    eligibility: slot.eligibility,
  }));
  const timing = {
    rule: facts.league.rosterChange?.rule,
    currentDate: facts.league.currentDate,
  };
  const refused = new Map<
    string,
    { readonly code: ProposalOrderRefusalCode; readonly detail: string }
  >();
  for (;;) {
    const plan = planProposalOrder({
      constraints: facts.league.rosterConstraints,
      slots,
      players,
      timing,
      items: remaining,
    });
    if (plan.status !== "conflict") {
      return { plan, refused };
    }
    const blocked = plan.conflicts.flatMap((conflict) => conflict.reasons ?? []);
    const removed = new Set(blocked.map((reason) => reason.item));
    if (removed.size === 0) {
      return { plan, refused };
    }
    for (const reason of blocked) {
      refused.set(reason.item, { code: reason.code, detail: reason.detail });
    }
    remaining = remaining.filter((item) => !removed.has(item.id));
    if (remaining.length === 0) {
      return { plan: undefined, refused };
    }
  }
}

function orderItemOf(
  facts: TeamFacts,
  item: ProposalItemRecord,
  change: ProposalItemChange,
  resolution: PlacementResolution | undefined,
): ProposalOrderItem {
  const declared = item.kind === "slot_move" ? item.slotMove : undefined;
  const declaredName =
    declared === undefined
      ? undefined
      : (facts.roster.players.find((player) => player.providerPlayerKey === declared.playerKey)
          ?.name ??
        declared.playerName ??
        declared.playerKey);
  const move =
    declared !== undefined
      ? {
          player: {
            key: declared.playerKey,
            name: declaredName ?? declared.playerKey,
          },
          toSlot: declared.toSlot,
        }
      : resolution?.move;
  const adds = change.adds.map((add) => ({
    key: add.key,
    name: add.name ?? add.key,
    positions: facts.players.get(add.key)?.eligiblePositions ?? [],
  }));
  const drops = change.drops.map((drop) => ({
    key: drop.key,
    name: drop.name ?? drop.key,
  }));
  return {
    id: item.id,
    label:
      item.kind === "activate" || item.kind === "stash"
        ? `${item.kind === "activate" ? "Activate" : "Stash"} ${move?.player.name ?? "this player"}`
        : orderItemLabel(adds, drops, move),
    adds,
    drops,
    move,
    mayRepair:
      item.kind !== "slot_move" &&
      item.kind !== "activate" &&
      item.kind !== "stash" &&
      !(
        (item.kind === "free_agent_add" || item.kind === "waiver_claim") &&
        item.intent?.to === "reserve"
      ),
    ...(resolution?.after === undefined ? {} : { placeAfter: resolution.after }),
  };
}

function orderItemLabel(
  adds: ReadonlyArray<{ readonly name: string }>,
  drops: ReadonlyArray<{ readonly name: string }>,
  move: ProposalOrderItem["move"],
): string {
  if (move !== undefined) {
    return `Move ${move.player.name} to ${move.toSlot}`;
  }
  const names = (players: ReadonlyArray<{ readonly name: string }>): string =>
    players.map((player) => player.name).join(", ");
  if (adds.length > 0 && drops.length > 0) {
    return `Add ${names(adds)} and drop ${names(drops)}`;
  }
  if (adds.length > 0) {
    return `Add ${names(adds)}`;
  }
  return drops.length > 0 ? `Drop ${names(drops)}` : "This move";
}

function proposalStaleCode(code: ProposalOrderRefusalCode): ProposalStaleCode {
  switch (code) {
    case "roster_full":
      return "roster_full";
    case "move_not_rostered":
      return "move_not_rostered";
    case "move_slot_unknown":
      return "move_slot_unknown";
    case "drop_not_rostered":
      return "drop_not_rostered";
    case "add_already_rostered":
      return "player_unavailable";
    case "move_locked":
    case "move_slot_full":
    case "slot_illegal":
      return "slot_illegal";
    case "state_unavailable":
      return "state_unavailable";
  }
}

function orderChanges(
  changes: ReadonlyArray<ProposalItemChange>,
  items: ReadonlyArray<ProposalItemRecord>,
  teamPlan: TeamPlan,
  at: DateTime.Utc,
): ReadonlyArray<ProposalItemChange> {
  const order = teamPlan.plan;
  const repairs = new Map(
    order?.status === "ordered"
      ? order.steps.flatMap((step) =>
          step.reserveMove === undefined ? [] : [[step.item, step.reserveMove] as const],
        )
      : [],
  );
  const sequenced = new Set(items.filter((item) => item.kind !== "trade").map((item) => item.id));
  const details = new Map<string, Array<string>>();
  if (order?.status === "conflict") {
    const blocked =
      "No order of this team's moves keeps the lineup legal, so the whole set is refused and nothing is sent.";
    const all = order.conflicts.map((conflict) => conflict.detail);
    for (const change of changes) {
      if (change.staleness.status !== "current" || !sequenced.has(change.id)) {
        continue;
      }
      const named = order.conflicts
        .filter((conflict) => conflict.items.includes(change.id))
        .map((conflict) => conflict.detail);
      details.set(change.id, named.length > 0 ? named : [blocked, ...all]);
    }
  } else if (order?.status === "unresolved") {
    for (const change of changes) {
      if (change.staleness.status === "current" && sequenced.has(change.id)) {
        details.set(change.id, [order.detail]);
      }
    }
  }
  return changes.map((change) => {
    if (change.staleness.status !== "current") {
      return change;
    }
    const called = teamPlan.refused.get(change.id);
    if (called !== undefined) {
      const code = proposalStaleCode(called.code);
      return {
        ...change,
        ...(code === "roster_full"
          ? { staleness: staleCheck([{ code, detail: called.detail }], at) }
          : { staleness: checked([], [{ code, detail: called.detail }], at) }),
      };
    }
    const repair = repairs.get(change.id);
    if (repair !== undefined) {
      return { ...change, reserveMove: repair };
    }
    const reasons = details.get(change.id);
    if (reasons === undefined) {
      return change;
    }
    return {
      ...change,
      staleness:
        order?.status === "unresolved"
          ? staleCheck(
              reasons.map((detail) => ({ code: "order_unresolved" as const, detail })),
              at,
            )
          : checked(
              [],
              reasons.map((detail) => ({ code: "order_conflict" as const, detail })),
              at,
            ),
    };
  });
}

function publishedOrder(
  plan: ProposalOrderPlan | undefined,
  items: ReadonlyArray<ProposalItemRecord>,
  changes: ReadonlyArray<ProposalItemChange>,
): ProposalOrderPlan | undefined {
  if (plan === undefined || plan.status !== "ordered") {
    return plan;
  }
  const trades = items.flatMap((item, index) => {
    const change = changes[index];
    return item.kind !== "trade" || change?.staleness.status !== "current"
      ? []
      : [{ item: item.id, position: plan.steps.length }];
  });
  if (trades.length === 0) {
    return plan;
  }
  return {
    ...plan,
    steps: [
      ...plan.steps,
      ...trades.map((trade, index) => ({ ...trade, position: plan.steps.length + index })),
    ],
  };
}

function storedOrders(
  existing: ReadonlyArray<StoredProposalOrder>,
  checks: ReadonlyArray<TeamCheck>,
): Effect.Effect<ReadonlyArray<StoredProposalOrder>, ProposalPersistenceFailed> {
  if (checks.length === 0) {
    return Effect.succeed(existing);
  }
  const checked = new Set(checks.map((check) => check.team));
  const planned = checks.filter(
    (check): check is TeamCheck & { readonly order: ProposalOrderPlan } =>
      check.order !== undefined,
  );
  return Effect.forEach(planned, (check) =>
    Schema.decodeUnknownEffect(StoredProposalOrderPlan)(orderJson(check.order)).pipe(
      Effect.map((order) => ({ team: check.team, order })),
      Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })),
    ),
  ).pipe(
    Effect.map((entries) => [...existing.filter((entry) => !checked.has(entry.team)), ...entries]),
  );
}

function orderJson(order: ProposalOrderPlan): unknown {
  switch (order.status) {
    case "ordered":
      return {
        status: "ordered",
        timing: order.timing,
        ...(order.effectiveDate === undefined ? {} : { effectiveDate: order.effectiveDate }),
        rosterPlaces: order.rosterPlaces,
        steps: order.steps.map((step) => ({
          item: step.item,
          position: step.position,
          ...(step.rosterPlace === undefined ? {} : { rosterPlace: step.rosterPlace }),
        })),
      };
    case "conflict":
      return {
        status: "conflict",
        timing: order.timing,
        ...(order.effectiveDate === undefined ? {} : { effectiveDate: order.effectiveDate }),
        conflicts: order.conflicts.map((conflict) => ({
          items: [...conflict.items],
          detail: conflict.detail,
        })),
      };
    case "unresolved":
      return {
        status: "unresolved",
        timing: order.timing,
        ...(order.effectiveDate === undefined ? {} : { effectiveDate: order.effectiveDate }),
        detail: order.detail,
      };
  }
}

function buildReview(
  tokens: QueryTokens["Service"],
  userId: UserId,
  teams: ReadonlyArray<ProposalTeamRecord>,
  set: ProposalSetRecord,
  submissions: ReadonlyArray<StoredProposalSubmission>,
  items: ReadonlyArray<ProposalItemRecord>,
  steps: ReadonlyArray<ProposalStepRecord>,
  now: DateTime.Utc,
  checks?: ReadonlyMap<TeamId, TeamCheck>,
  offersByTeam?: ReadonlyMap<TeamId, ReadonlyArray<PendingTradeOffer>>,
): Effect.Effect<ProposalSetReview, ProposalPersistenceFailed> {
  return Effect.gen(function* () {
    const teamsById = new Map(teams.map((team) => [team.id, team] as const));
    const itemsByTeam = new Map<TeamId, Array<ProposalItemRecord>>();
    for (const item of items) {
      const current = itemsByTeam.get(item.team) ?? [];
      current.push(item);
      itemsByTeam.set(item.team, current);
    }
    const stepsByItem = new Map<string, Array<ProposalStepRecord>>();
    for (const step of steps) {
      const current = stepsByItem.get(step.itemId) ?? [];
      current.push(step);
      stepsByItem.set(step.itemId, current);
    }
    const reviewed = [];
    for (const teamId of set.teams) {
      const team = teamsById.get(teamId);
      if (team === undefined) {
        continue;
      }
      const check = checks?.get(teamId);
      const order = check?.order ?? set.orders.find((entry) => entry.team === teamId)?.order;
      const lineup = set.lineups.find((entry) => entry.team === teamId);
      const teamItems = [];
      for (const item of itemsByTeam.get(teamId) ?? []) {
        teamItems.push(
          yield* toItem(
            tokens,
            userId,
            team,
            item,
            check?.facts,
            check?.changes.find((change) => change.id === item.id)?.reserveMove ?? item.reserveMove,
            stepsByItem.get(item.id),
          ),
        );
      }
      reviewed.push(
        yield* Schema.decodeEffect(ProposalTeamSchema)({
          team: teamView(team),
          ...(check?.budget === undefined ? {} : { budget: check.budget }),
          ...(check?.facts === undefined
            ? {}
            : {
                tradeRules: {
                  ...(check.facts.league.tradeEndDate === undefined
                    ? {}
                    : { endDate: check.facts.league.tradeEndDate }),
                  ...(check.facts.league.tradeRatification === undefined
                    ? {}
                    : { ratification: check.facts.league.tradeRatification }),
                  ...(check.facts.league.tradeObjectionDays === undefined
                    ? {}
                    : { objectionDays: check.facts.league.tradeObjectionDays }),
                },
              }),
          ...(check?.failure === undefined ? {} : { failure: check.failure }),
          ...(order === undefined ? {} : { order }),
          ...(lineup === undefined ? {} : { lineup: lineupView(lineup) }),
          items: teamItems,
          pendingOffers: offersByTeam?.get(teamId) ?? [],
        }).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause }))),
      );
    }
    return yield* Schema.decodeEffect(ProposalSetReviewSchema)({
      set: toSet(set, submissions, items, now),
      teams: reviewed,
    }).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
  });
}

function evaluateItem(
  item: ProposalItemRecord,
  facts: TeamFacts,
  budget: ProposalBudget | undefined,
  at: DateTime.Utc,
  feed: TradeFeed | undefined,
): ProposalItemChange {
  if (item.kind === "trade") {
    return evaluateTradeItem(item, facts, at, feed);
  }
  if (item.kind === "slot_move") {
    return evaluateSlotMoveItem(item, facts, at);
  }
  if (item.kind === "activate" || item.kind === "stash") {
    return evaluateIntentItem(item, facts, at);
  }
  const reasons: Array<StoredProposalStaleReason> = [];
  const adds = item.adds.map((add) => ({ ...add }));
  const drops = item.drops.map((drop) => ({ ...drop }));
  for (const add of adds) {
    const detail = facts.players.get(add.key);
    const name = detail?.name ?? add.name;
    if (detail === undefined) {
      reasons.push({
        code: "player_unavailable",
        playerKey: add.key,
        detail: `${name ?? "An added player"} is not published in this league's player pool, so the add can no longer be made.`,
      });
      continue;
    }
    if (detail.name !== undefined) {
      add.name = detail.name;
    }
    if (detail.displayPosition !== undefined) {
      add.position = detail.displayPosition;
    }
    if (detail.proTeam !== undefined) {
      add.proTeam = detail.proTeam;
    }
    const availability = addAvailability(detail);
    if (availability !== undefined) {
      add.availability = availability;
    }
    if (detail.rosterStatus === "rostered") {
      reasons.push({
        code: "player_unavailable",
        playerKey: add.key,
        detail: `${name ?? "The added player"} is already rostered in this league, so the add can no longer be made.`,
      });
      continue;
    }
    if (detail.rosterStatus === "unknown") {
      reasons.push({
        code: "player_unavailable",
        playerKey: add.key,
        detail: `Your league does not publish whether ${name ?? "an added player"} is available, so the add cannot be checked.`,
      });
      continue;
    }
    const week = facts.weeks.get(add.key);
    if (week !== undefined && !week.plays) {
      reasons.push({
        code: "player_team_on_bye",
        playerKey: add.key,
        detail: `${name ?? "The added player"} does not play in scoring week ${String(week.week)}, and this league applies a roster change to that week.`,
      });
    }
  }
  const rostered = new Map(
    facts.roster.players.map((player) => [player.providerPlayerKey, player] as const),
  );
  for (const drop of drops) {
    const player = rostered.get(drop.key);
    if (player === undefined) {
      reasons.push({
        code: "drop_not_rostered",
        playerKey: drop.key,
        detail: `${drop.name ?? "The dropped player"} is no longer on this team's roster, so there is nothing to drop.`,
      });
      continue;
    }
    drop.name = player.name;
    drop.position = player.displayPosition;
    if (player.proTeamAbbreviation !== undefined) {
      drop.proTeam = player.proTeamAbbreviation;
    }
    const availability = player.injuryDetail ?? player.injuryCode;
    if (availability !== undefined) {
      drop.availability = availability;
    }
  }
  if (
    facts.league.endDate !== undefined &&
    facts.league.currentDate !== undefined &&
    facts.league.currentDate > facts.league.endDate
  ) {
    reasons.push({
      code: "period_closed",
      detail: `The league's period ended on ${facts.league.endDate}, and the current date at your league is ${facts.league.currentDate}.`,
    });
  }
  if (item.bid !== undefined) {
    if (facts.league.usesFaab === false) {
      reasons.push({
        code: "bid_not_available",
        detail: "This league does not use a FAAB waiver budget, so a bid cannot be made.",
      });
    } else if (budget?.status === "published" && item.bid > budget.remaining) {
      reasons.push({
        code: "bid_exceeds_budget",
        detail: `The bid of ${String(item.bid)} exceeds this team's remaining FAAB budget of ${String(budget.remaining)}.`,
      });
    }
  }
  return {
    id: item.id,
    adds,
    drops,
    staleness: checked(reasons, [], at),
  };
}

function evaluateIntentItem(
  item: ProposalItemRecord,
  facts: TeamFacts,
  at: DateTime.Utc,
): ProposalItemChange {
  const intent = item.intent;
  if (intent === undefined || intent.player === undefined) {
    return {
      id: item.id,
      adds: [],
      drops: [],
      staleness: staleCheck(
        [
          {
            code: "state_unavailable",
            detail:
              item.kind === "activate"
                ? "This activate names no player, so there is nothing to move."
                : "This stash names no player, so there is nothing to move.",
          },
        ],
        at,
      ),
    };
  }
  const player = facts.roster.players.find(
    (entry) => entry.providerPlayerKey === intent.player?.key,
  );
  if (player === undefined) {
    return {
      id: item.id,
      adds: [],
      drops: [],
      staleness: staleCheck(
        [
          {
            code: "move_not_rostered",
            playerKey: intent.player.key,
            detail: `${intent.player.name ?? "The moved player"} is no longer on this team's roster, so the move cannot be made.`,
          },
        ],
        at,
      ),
    };
  }
  return {
    id: item.id,
    adds: [],
    drops: [],
    staleness: currentCheck(at),
  };
}

function evaluateSlotMoveItem(
  item: ProposalItemRecord,
  facts: TeamFacts,
  at: DateTime.Utc,
): ProposalItemChange {
  const move = item.slotMove;
  if (move === undefined) {
    return {
      id: item.id,
      adds: [],
      drops: [],
      staleness: staleCheck(
        [
          {
            code: "state_unavailable",
            detail: "This slot move names no player and destination slot, so it cannot be planned.",
          },
        ],
        at,
      ),
    };
  }
  const player = facts.roster.players.find((entry) => entry.providerPlayerKey === move.playerKey);
  if (player === undefined) {
    return {
      id: item.id,
      adds: [],
      drops: [],
      staleness: staleCheck(
        [
          {
            code: "move_not_rostered",
            playerKey: move.playerKey,
            detail: `${move.playerName ?? "The moved player"} is no longer on this team's roster, so the move cannot be made.`,
          },
        ],
        at,
      ),
    };
  }
  const illegal: Array<StoredProposalStaleReason> = [];
  if (player.slot.status !== "verified") {
    illegal.push({
      code: "slot_illegal",
      playerKey: player.providerPlayerKey,
      detail: `Your league reports no verified slot for ${player.name}, so the move cannot be planned.`,
    });
  }
  const slot = facts.league.rosterPositions.find((position) => position.position === move.toSlot);
  if (slot === undefined) {
    illegal.push({
      code: "move_slot_unknown",
      playerKey: player.providerPlayerKey,
      detail: `The league does not declare a ${move.toSlot} slot, so ${player.name} cannot move there.`,
    });
  } else {
    const rule = rosterRuleOf(facts.league.rosterConstraints, facts.league.rosterPositions);
    const placement = slotPlacement(rule, slot.position, player.eligiblePositions);
    if (placement.legal === "unknown") {
      illegal.push({
        code: "state_unavailable",
        playerKey: player.providerPlayerKey,
        detail: `The league does not publish how reserve eligibility is established, so ${player.name} cannot be moved to the ${slot.position} reserve list.`,
      });
    } else if (!placement.legal) {
      illegal.push({
        code: "slot_illegal",
        playerKey: player.providerPlayerKey,
        detail: slotMismatchDetail({
          name: player.name,
          slot: slot.position,
          kind: slot.kind,
          positions: player.eligiblePositions,
        }),
      });
    }
  }
  return { id: item.id, adds: [], drops: [], staleness: checked([], illegal, at) };
}

function evaluateTradeItem(
  item: ProposalItemRecord,
  facts: TeamFacts,
  at: DateTime.Utc,
  feed: TradeFeed | undefined,
): ProposalItemChange {
  const adds = item.adds.map((add) => ({ ...add }));
  const drops = item.drops.map((drop) => ({ ...drop }));
  const counterpartyName = item.counterpartyName ?? "the counterparty";
  if (item.trade !== undefined && item.trade.state !== "pending") {
    return { id: item.id, adds, drops, staleness: item.staleness };
  }
  if (item.trade !== undefined) {
    const trade = refreshedTrade(item, item.trade, facts, feed, at);
    return {
      id: item.id,
      adds,
      drops,
      staleness: item.staleness,
      trade: trade.trade,
      state: trade.state,
    };
  }
  const reasons: Array<StoredProposalStaleReason> = [];
  const counterpartyKey = item.counterpartyKey;
  const counterparty =
    counterpartyKey === undefined
      ? undefined
      : facts.leagueTeams.find((team) => team.providerTeamKey === counterpartyKey);
  if (counterpartyKey === undefined || counterparty === undefined) {
    reasons.push({
      code: "trade_counterparty_missing",
      detail: `${counterpartyName} is no longer a team in this league, so this offer cannot be made.`,
    });
  }
  if (tradeWindowClosed(facts.league)) {
    reasons.push({
      code: "trade_window_closed",
      detail: `The league's trade window closed on ${facts.league.tradeEndDate ?? "an unpublished date"}, so this offer cannot be made.`,
    });
  }
  const rostered = new Map(
    facts.roster.players.map((player) => [player.providerPlayerKey, player] as const),
  );
  for (const drop of drops) {
    const player = rostered.get(drop.key);
    if (player === undefined) {
      reasons.push({
        code: "trade_player_not_rostered",
        playerKey: drop.key,
        detail: `${drop.name ?? "A player you are sending"} is no longer on your roster.`,
      });
      continue;
    }
    drop.name = player.name;
    drop.position = player.displayPosition;
    if (player.proTeamAbbreviation !== undefined) {
      drop.proTeam = player.proTeamAbbreviation;
    }
    const availability = player.injuryDetail ?? player.injuryCode;
    if (availability !== undefined) {
      drop.availability = availability;
    }
  }
  const opponent =
    counterpartyKey === undefined ? undefined : facts.tradeRosters.get(counterpartyKey);
  if (counterpartyKey !== undefined && opponent === undefined) {
    reasons.push({
      code: "state_unavailable",
      detail: `${counterpartyName}'s roster could not be read, so the players coming back cannot be checked.`,
    });
  }
  const opponentPlayers = new Map(
    (opponent?.players ?? []).map((player) => [player.providerPlayerKey, player] as const),
  );
  for (const add of adds) {
    const player = opponentPlayers.get(add.key);
    if (player === undefined) {
      reasons.push({
        code: "trade_player_not_rostered",
        playerKey: add.key,
        detail: `${add.name ?? "A player you asked for"} is no longer on ${counterpartyName}'s roster.`,
      });
      continue;
    }
    add.name = player.name;
    add.position = player.displayPosition;
    if (player.proTeamAbbreviation !== undefined) {
      add.proTeam = player.proTeamAbbreviation;
    }
    const availability = player.injuryDetail ?? player.injuryCode;
    if (availability !== undefined) {
      add.availability = availability;
    }
  }
  const capacity = facts.league.rosterPositions.reduce(
    (total, position) => (position.kind === "reserve" ? total : total + position.count),
    0,
  );
  const reservePositions = facts.league.rosterPositions.filter(
    (position) => position.kind === "reserve",
  );
  const reserveNames = new Set(reservePositions.map((position) => position.position));
  const inReserve = facts.roster.players.filter(
    (player) => player.slot.status === "verified" && reserveNames.has(player.slot.slot),
  );
  const occupied = facts.roster.players.length - inReserve.length;
  const droppedKeys = new Set(drops.map((drop) => drop.key));
  const legality = illegalSlots(facts, droppedKeys);
  for (const reason of legality) {
    reasons.push(reason);
  }
  const dropped = drops.filter((drop) => rostered.has(drop.key)).length;
  const current = adds.filter((add) => opponentPlayers.has(add.key)).length;
  if (capacity > 0 && occupied - dropped + current > capacity) {
    reasons.push({
      code: "roster_full",
      detail: `This trade would leave ${String(occupied - dropped + current)} roster players and the league allows ${String(capacity)}.`,
    });
  }
  return {
    id: item.id,
    adds,
    drops,
    staleness: checked(reasons, legality, at),
  };
}

function refreshedTrade(
  item: ProposalItemRecord,
  trade: StoredProposalTrade,
  facts: TeamFacts,
  feed: TradeFeed | undefined,
  at: DateTime.Utc,
): { readonly trade: StoredProposalTrade; readonly state: ProposalItemState } {
  if (feed === undefined) {
    return { trade, state: item.state };
  }
  const pending = feed.pending.find((offer) => offer.transactionKey === trade.providerKey);
  if (pending !== undefined) {
    const proposedAt = Schema.decodeOption(Schema.DateTimeUtcFromString)(pending.proposedAt);
    return {
      trade: {
        ...trade,
        state: "pending",
        ...(proposedAt._tag === "Some" ? { proposedAt: proposedAt.value } : {}),
        detail: undefined,
      },
      state: "pending",
    };
  }
  if (feed.completedUnavailable) {
    return {
      trade: {
        ...trade,
        detail:
          "Your league no longer lists this offer, and its completed trades could not be read. Check the trade page.",
      },
      state: "pending",
    };
  }
  const accepted = feed.completed.find((transaction) =>
    matchesAcceptedTrade(item, trade, facts, transaction),
  );
  if (accepted !== undefined) {
    return {
      trade: {
        ...trade,
        state: "accepted",
        settledAt: at,
        detail: `${item.counterpartyName ?? "The other manager"} accepted this offer. It is no longer waiting for a response.`,
      },
      state: "accepted",
    };
  }
  if (tradeWindowClosed(facts.league)) {
    return {
      trade: {
        ...trade,
        state: "expired",
        settledAt: at,
        detail: `Your league no longer lists this offer and the trade window closed on ${facts.league.tradeEndDate ?? "an unpublished date"}.`,
      },
      state: "expired",
    };
  }
  return {
    trade: {
      ...trade,
      state: "expired",
      settledAt: at,
      detail:
        "Your league no longer lists this offer and it is not among its completed trades. It publishes no ended record, so it was withdrawn or expired elsewhere.",
    },
    state: "expired",
  };
}

function matchesAcceptedTrade(
  item: ProposalItemRecord,
  trade: StoredProposalTrade,
  facts: TeamFacts,
  transaction: ProviderTransaction,
): boolean {
  if (transaction.type !== "trade" || item.counterpartyKey === undefined) {
    return false;
  }
  if (Date.parse(transaction.occurredAt) + 300_000 < DateTime.toEpochMillis(trade.requestedAt)) {
    return false;
  }
  const own = facts.providerTeamKey;
  const counterparty = item.counterpartyKey;
  const involves = (teamKey: string): boolean =>
    transaction.teams.some((team) => team.providerTeamKey === teamKey);
  if (!involves(own) || !involves(counterparty)) {
    return false;
  }
  const movement = (playerKey: string, from: string, to: string): boolean =>
    transaction.players.some(
      (player) =>
        player.providerPlayerKey === playerKey &&
        player.movement.from?.providerTeamKey === from &&
        player.movement.to?.providerTeamKey === to,
    );
  return (
    item.drops.every((drop) => movement(drop.key, own, counterparty)) &&
    item.adds.every((add) => movement(add.key, counterparty, own))
  );
}

function budgetOf(
  facts: TeamFacts,
  items: ReadonlyArray<ProposalItemRecord>,
): ProposalBudget | undefined {
  if (!items.some((item) => item.bid !== undefined)) {
    return undefined;
  }
  if (facts.league.usesFaab === false) {
    return { status: "not_published", detail: "This league does not use a FAAB waiver budget." };
  }
  const own = facts.leagueTeams.find((team) => team.providerTeamKey === facts.providerTeamKey);
  if (own?.remainingBudget === undefined) {
    return {
      status: "not_published",
      detail:
        "Your league publishes no remaining FAAB balance for this team, so the bid cannot be checked against it.",
    };
  }
  return { status: "published", remaining: own.remainingBudget };
}

function currentCheck(at: DateTime.Utc): StoredProposalStaleness {
  return { status: "current", checkedAt: at, reasons: [] };
}

function tradeWindowClosed(league: ProviderLeagueSettings): boolean {
  return (
    league.tradeEndDate !== undefined &&
    league.currentDate !== undefined &&
    league.currentDate > league.tradeEndDate
  );
}

function tradeRefusal(
  index: number,
  refusal: ProposalItemRefused["refusal"],
  reason: string,
  fix: string,
): ProposalItemRefused {
  return { position: index + 1, outcome: "refused", refusal, reason, fix };
}

function proposalPlayerOf(player: ProviderRoster["players"][number]): StoredProposalPlayer {
  const availability = player.injuryDetail ?? player.injuryCode;
  return {
    key: player.providerPlayerKey,
    name: player.name,
    position: player.displayPosition,
    ...(player.proTeamAbbreviation === undefined ? {} : { proTeam: player.proTeamAbbreviation }),
    ...(availability === undefined ? {} : { availability }),
  };
}

function withdrawalDetail(write: ProviderWriteResult): string {
  switch (write.status) {
    case "accepted":
      return "Your league accepted the withdrawal.";
    case "rejected":
      return clamped(rejectionDetail("withdrawal", write));
    case "not_sent":
      return notSentDetail("withdrawal", write);
    case "unknown":
      return "Your league did not confirm the withdrawal, so it may or may not have applied. It was not retried. Check the trade page.";
  }
}

function addAvailability(detail: ProviderPlayerDetail): string | undefined {
  if (detail.availabilityDetail !== undefined) {
    return detail.availabilityDetail;
  }
  switch (detail.rosterStatus) {
    case "free_agent":
      return "Free agent";
    case "waiver":
      return "On waivers";
    case "rostered":
      return "Rostered in this league";
    case "unknown":
      return undefined;
  }
}

function staleCheck(
  reasons: ReadonlyArray<StoredProposalStaleReason>,
  at: DateTime.Utc,
): StoredProposalStaleness {
  return { status: "stale", checkedAt: at, reasons };
}

function checked(
  staleReasons: ReadonlyArray<StoredProposalStaleReason>,
  illegalReasons: ReadonlyArray<StoredProposalStaleReason>,
  at: DateTime.Utc,
): StoredProposalStaleness {
  return illegalReasons.length === 0
    ? staleReasons.length === 0
      ? currentCheck(at)
      : staleCheck(staleReasons, at)
    : { status: "illegal", checkedAt: at, reasons: [...staleReasons, ...illegalReasons] };
}

function failedCheck(
  team: TeamId,
  items: ReadonlyArray<ProposalItemRecord>,
  detail: string,
  at: DateTime.Utc,
): TeamCheck {
  return {
    team,
    failure: detail,
    changes: items.map((item) => ({
      id: item.id,
      adds: item.adds,
      drops: item.drops,
      staleness: staleCheck([{ code: "state_unavailable", detail }], at),
    })),
  };
}

function proposalShape(
  draft: ProposalItemDraft,
): { readonly refusal: "kind_invalid" | "bid_invalid"; readonly detail: string } | undefined {
  const bid = draft.bid ?? undefined;
  const move = draft.slotMove ?? undefined;
  const to = draft.to ?? undefined;
  const intentPlayer = draft.player ?? undefined;
  const onlyAddsNameDestination = (): ReturnType<typeof proposalShape> =>
    to === undefined
      ? undefined
      : {
          refusal: "kind_invalid",
          detail: "Only an add names a destination, with `to` set to `active` or `reserve`.",
        };
  const onlyIntentNamesPlayer = (): ReturnType<typeof proposalShape> =>
    intentPlayer === undefined
      ? undefined
      : {
          refusal: "kind_invalid",
          detail: "Only an activate or stash names a player, with `player`.",
        };
  const onlySlotMoveNamesDestination = (): ReturnType<typeof proposalShape> =>
    move === undefined
      ? undefined
      : { refusal: "kind_invalid", detail: "Only a slot move item names a destination slot." };
  switch (draft.kind) {
    case "activate":
    case "stash": {
      const intent =
        draft.kind === "activate"
          ? "An activate moves one reserve-list player onto the active roster."
          : "A stash moves one active player onto a reserve list that accepts their positions.";
      if (draft.adds.length > 0 || draft.drops.length > 0) {
        return {
          refusal: "kind_invalid",
          detail: `${intent} It cannot also add or drop a player; use a separate item for that.`,
        };
      }
      const destination = onlySlotMoveNamesDestination();
      if (destination !== undefined) {
        return destination;
      }
      if (intentPlayer === undefined) {
        return {
          refusal: "kind_invalid",
          detail: `${intent} Name the player with \`player\`.`,
        };
      }
      if (to !== undefined) {
        return {
          refusal: "kind_invalid",
          detail: `${intent} It chooses the place itself, so it does not name \`to\`.`,
        };
      }
      return bid === undefined
        ? undefined
        : {
            refusal: "bid_invalid",
            detail: `${intent} It carries no FAAB bid. Use a waiver claim to spend a bid.`,
          };
    }
    case "slot_move":
      if (draft.adds.length > 0 || draft.drops.length > 0) {
        return {
          refusal: "kind_invalid",
          detail:
            "A slot move names one rostered player and one destination slot the league declares. It cannot also add or drop a player; use a separate item for that.",
        };
      }
      if (move === undefined) {
        return {
          refusal: "kind_invalid",
          detail:
            "A slot move names the player to move, with `slotMove.player`, and the destination slot, with `slotMove.toSlot`.",
        };
      }
      if (intentPlayer !== undefined) {
        return {
          refusal: "kind_invalid",
          detail: "A slot move names its player with `slotMove.player`, not `player`.",
        };
      }
      if (to !== undefined) {
        return {
          refusal: "kind_invalid",
          detail: "A slot move names its destination with `slotMove.toSlot`, not `to`.",
        };
      }
      return bid === undefined
        ? undefined
        : {
            refusal: "bid_invalid",
            detail: "A slot move carries no FAAB bid. Use a waiver claim to spend a bid.",
          };
    case "drop":
      if (draft.adds.length > 0) {
        return {
          refusal: "kind_invalid",
          detail:
            "A drop item cannot also add a player. Use a free-agent add with drop players instead.",
        };
      }
      if (draft.drops.length === 0) {
        return {
          refusal: "kind_invalid",
          detail: "A drop item names at least one player to drop.",
        };
      }
      {
        const destination = onlySlotMoveNamesDestination();
        if (destination !== undefined) {
          return destination;
        }
      }
      {
        const destination = onlyAddsNameDestination();
        if (destination !== undefined) {
          return destination;
        }
      }
      {
        const player = onlyIntentNamesPlayer();
        if (player !== undefined) {
          return player;
        }
      }
      return bid === undefined
        ? undefined
        : {
            refusal: "bid_invalid",
            detail: "A drop item cannot carry a FAAB bid. Use a waiver claim to spend a bid.",
          };
    case "free_agent_add":
    case "waiver_claim": {
      if (draft.adds.length === 0) {
        return {
          refusal: "kind_invalid",
          detail:
            draft.kind === "free_agent_add"
              ? "A free-agent add names at least one player to add."
              : "A waiver claim names at least one player to add.",
        };
      }
      {
        const destination = onlySlotMoveNamesDestination();
        if (destination !== undefined) {
          return destination;
        }
      }
      {
        const player = onlyIntentNamesPlayer();
        if (player !== undefined) {
          return player;
        }
      }
      if (to === "reserve" && draft.adds.length !== 1) {
        return {
          refusal: "kind_invalid",
          detail:
            "A reserve add names one player, because each player needs their own reserve place. Use one item for each player you want on a reserve list.",
        };
      }
      if (draft.kind === "free_agent_add") {
        return bid === undefined
          ? undefined
          : {
              refusal: "bid_invalid",
              detail: "A free-agent add carries no bid. Use a waiver claim for a FAAB bid.",
            };
      }
      return bid === undefined
        ? { refusal: "bid_invalid", detail: "A waiver claim requires a FAAB bid." }
        : undefined;
    }
    case "trade":
      if (draft.adds.length === 0 || draft.drops.length === 0) {
        return {
          refusal: "kind_invalid",
          detail:
            "A trade names at least one player going out and at least one player coming back.",
        };
      }
      {
        const destination = onlySlotMoveNamesDestination();
        if (destination !== undefined) {
          return destination;
        }
      }
      {
        const destination = onlyAddsNameDestination();
        if (destination !== undefined) {
          return destination;
        }
      }
      {
        const player = onlyIntentNamesPlayer();
        if (player !== undefined) {
          return player;
        }
      }
      return bid === undefined
        ? undefined
        : {
            refusal: "bid_invalid",
            detail: "A trade carries no FAAB bid. Use a waiver claim to spend a bid.",
          };
  }
}
function proposalItemKey(input: {
  readonly team: string;
  readonly kind: string;
  readonly counterpartyKey: string | undefined;
  readonly adds: ReadonlyArray<string>;
  readonly drops: ReadonlyArray<string>;
  readonly slotMove: { readonly player: string; readonly toSlot: string } | undefined;
  readonly intent: StoredProposalIntent | undefined;
  readonly bid: number | undefined;
  readonly reason: string;
}): string {
  return JSON.stringify([
    input.team,
    input.kind,
    input.counterpartyKey ?? null,
    [...input.adds].sort(),
    [...input.drops].sort(),
    input.slotMove?.player ?? null,
    input.slotMove?.toSlot ?? null,
    intentKey(input.intent),
    input.bid ?? null,
    input.reason,
  ]);
}

function proposalMoveKey(
  team: string,
  kind: string,
  counterpartyKey: string | undefined,
  adds: ReadonlyArray<string>,
  drops: ReadonlyArray<string>,
  slotMove: { readonly player: string; readonly toSlot: string } | undefined,
  intent: StoredProposalIntent | undefined,
  bid: number | undefined,
): string {
  return JSON.stringify([
    team,
    kind,
    counterpartyKey ?? null,
    [...adds].sort(),
    [...drops].sort(),
    slotMove?.player ?? null,
    slotMove?.toSlot ?? null,
    intentKey(intent),
    bid ?? null,
  ]);
}

function intentKey(intent: StoredProposalIntent | undefined): ReadonlyArray<string | null> | null {
  return intent === undefined ? null : [intent.kind, intent.player?.key ?? null, intent.to ?? null];
}

function recordItemKey(item: ProposalItemRecord): string {
  return proposalItemKey({
    team: item.team,
    kind: item.kind,
    counterpartyKey: item.counterpartyKey,
    adds: item.adds.map((add) => add.key),
    drops: item.drops.map((drop) => drop.key),
    slotMove:
      item.slotMove === undefined
        ? undefined
        : { player: item.slotMove.playerKey, toSlot: item.slotMove.toSlot },
    intent: item.intent,
    bid: item.bid,
    reason: item.reason,
  });
}

function recordMoveKey(item: ProposalItemRecord): string {
  return proposalMoveKey(
    item.team,
    item.kind,
    item.counterpartyKey,
    item.adds.map((add) => add.key),
    item.drops.map((drop) => drop.key),
    item.slotMove === undefined
      ? undefined
      : { player: item.slotMove.playerKey, toSlot: item.slotMove.toSlot },
    item.intent,
    item.bid,
  );
}

function refusedItem(
  index: number,
  refusal: ProposalItemRefusal,
  reason: string,
  fix: string,
): ProposalItemRefused {
  return { position: index + 1, outcome: "refused", refusal, reason, fix };
}

function refusalFromCheck(position: number, change: ProposalItemChange): ProposalItemRefused {
  const reasons = change.staleness.reasons;
  const first = reasons[0];
  return {
    position,
    outcome: "refused",
    refusal: first?.code ?? "state_unavailable",
    reason:
      reasons.length === 0
        ? "This move cannot run against the set's end state."
        : reasons.map((reason) => reason.detail).join(" "),
    fix:
      reasons.length === 0
        ? staleFix("state_unavailable")
        : [...new Set(reasons.map((reason) => staleFix(reason.code)))].join(" "),
  };
}

function staleFix(code: ProposalStaleCode): string {
  switch (code) {
    case "player_unavailable":
      return "Read the player pool again and name a player your league still publishes as available; a player already rostered in this league cannot be added.";
    case "drop_not_rostered":
      return "Read this team's roster again and name only a player your league still lists on it.";
    case "move_not_rostered":
      return "Read this team's roster again and name a player your league still lists on it.";
    case "move_slot_unknown":
      return "Read the league again and name a slot it declares.";
    case "roster_full":
      return "Add the drop or slot move that frees a roster place to this set, then propose again.";
    case "slot_illegal":
      return "Make the named player's slot legal: move them in your league, or propose a slot move or drop that opens a slot accepting them.";
    case "reserve_unavailable":
      return "Choose a player your league lists as eligible for a reserve list, or read the league's reserve lists again before proposing.";
    case "intent_invalid":
      return "Read this team's roster again: the named player is already on that part of the roster, so propose the move the roster still needs.";
    case "order_conflict":
      return "Withdraw or change one of the named moves so the team has a legal order, then propose again.";
    case "order_unresolved":
      return "Split this team's moves into smaller sets and propose them separately.";
    case "period_closed":
      return "Wait for the league's next period and propose again.";
    case "player_team_on_bye":
      return "Choose a player whose professional team plays in that scoring week, then propose again.";
    case "bid_exceeds_budget":
      return "Lower the bid to the team's remaining FAAB balance or less, then propose again.";
    case "bid_not_available":
      return "Remove the bid; this league does not use a FAAB budget.";
    case "state_unavailable":
      return "Read the team, roster, and league again; your league did not publish the state this move needs.";
    case "trade_window_closed":
      return "Wait for the league's next trade window and propose the trade then.";
    case "trade_counterparty_missing":
      return "Read the league's teams again and name a counterparty that is still in the league.";
    case "trade_player_not_rostered":
      return "Read both rosters again and name only players your league still lists on the team they would leave.";
  }
}

function namedCommand(
  command: ProposalItemCommand,
  facts: TeamFacts | undefined,
): ProposalItemCommand {
  const nameOf = (key: string): string | undefined =>
    facts?.roster.players.find((player) => player.providerPlayerKey === key)?.name;
  const withMove =
    command.slotMove === undefined
      ? command
      : (() => {
          const name = nameOf(command.slotMove.playerKey);
          return name === undefined
            ? command
            : { ...command, slotMove: { ...command.slotMove, playerName: name } };
        })();
  const player = withMove.intent?.player;
  if (player === undefined) {
    return withMove;
  }
  const name = nameOf(player.key);
  return name === undefined || withMove.intent === undefined
    ? withMove
    : { ...withMove, intent: { ...withMove.intent, player: { ...player, name } } };
}

function commandRecord(input: {
  readonly command: ProposalItemCommand;
  readonly id: ProposalItemRecord["id"];
  readonly setId: ProposalSetRecord["id"];
  readonly position: number;
  readonly userId: UserId;
  readonly at: DateTime.Utc;
}): ProposalItemRecord {
  const command = input.command;
  return {
    id: input.id,
    setId: input.setId,
    position: input.position,
    userId: input.userId,
    team: command.team,
    connection: command.connection,
    kind: command.kind,
    adds: command.adds,
    drops: command.drops,
    ...(command.slotMove === undefined ? {} : { slotMove: command.slotMove }),
    ...(command.intent === undefined ? {} : { intent: command.intent }),
    ...(command.counterpartyKey === undefined ? {} : { counterpartyKey: command.counterpartyKey }),
    ...(command.counterpartyName === undefined
      ? {}
      : { counterpartyName: command.counterpartyName }),
    ...(command.bid === undefined ? {} : { bid: command.bid }),
    reason: command.reason,
    state: "proposed",
    settled: false,
    staleness: currentCheck(input.at),
    createdAt: input.at,
    updatedAt: input.at,
  };
}

function toSet(
  set: ProposalSetRecord,
  submissions: ReadonlyArray<StoredProposalSubmission>,
  items: ReadonlyArray<ProposalItemRecord>,
  now: DateTime.Utc,
): ProposalSet {
  return {
    id: set.id,
    proposedBy: set.proposedBy,
    createdAt: set.createdAt,
    expiresAt: set.expiresAt,
    expired: isExpired(set, now),
    submissions: submissions.map((submission): ProposalSubmission => ({
      submittedAt: submission.submittedAt,
      ...(submission.completedAt === undefined ? {} : { completedAt: submission.completedAt }),
    })),
    settled: isSettledSet(submissions, items),
    reviewPath: reviewPath(set.id),
  };
}

function isExpired(set: ProposalSetRecord, now: DateTime.Utc): boolean {
  return DateTime.toEpochMillis(now) >= DateTime.toEpochMillis(set.expiresAt);
}

function reviewPath(set: string): string {
  return `/transactions/${set}`;
}

function teamView(team: {
  readonly id: TeamId;
  readonly name: string;
  readonly provider: ProposalTeamRecord["provider"];
  readonly league: ProposalTeamRecord["league"];
  readonly sport: ProposalTeamRecord["sport"];
  readonly season: number;
}): QueryTeam {
  return {
    id: team.id,
    name: team.name,
    provider: team.provider,
    league: team.league,
    sport: team.sport,
    season: team.season,
  };
}

function isOpen(state: ProposalItemState): boolean {
  return state === "proposed";
}

function isPlayerKey(value: string | undefined): value is string {
  return value !== undefined;
}

function queryFailureDetail(failure: QueryError): string {
  switch (failure._tag) {
    case "query.team_not_found":
      return "this team is not available to the account.";
    case "query.connection_not_ready":
      return `the team's connection is ${failure.status}.`;
    case "query.cursor_invalid":
    case "query.reference_invalid":
    case "query.selection_invalid":
    case "query.persistence_failed":
      return "the stored state could not be read.";
  }
}

function toItem(
  tokens: QueryTokens["Service"],
  userId: UserId,
  team: ProposalTeamRecord,
  record: ProposalItemRecord,
  facts: TeamFacts | undefined,
  repair: StoredReserveMove | undefined,
  steps: ReadonlyArray<ProposalStepRecord> | undefined,
): Effect.Effect<ProposalItem, ProposalPersistenceFailed> {
  return Effect.gen(function* () {
    const leagueKey = team.providerLeagueKey;
    const addRefs = yield* tokens.sealPlayerRefs({
      userId,
      leagueKey,
      playerKeys: record.adds.map((add) => add.key),
    });
    const dropRefs = yield* tokens.sealPlayerRefs({
      userId,
      leagueKey,
      playerKeys: record.drops.map((drop) => drop.key),
    });
    const reasonKeys = record.staleness.reasons.flatMap((reason) =>
      reason.playerKey === undefined ? [] : [reason.playerKey],
    );
    const reasonRefs = yield* tokens.sealPlayerRefs({ userId, leagueKey, playerKeys: reasonKeys });
    const executionSteps = steps ?? [];
    const rostered = new Map(
      (facts?.roster.players ?? []).map((player) => [player.providerPlayerKey, player] as const),
    );
    const declared = record.kind === "slot_move" ? record.slotMove : undefined;
    const rosterPlayer = declared === undefined ? undefined : rostered.get(declared.playerKey);
    const slotMove: MoveViewSource | undefined =
      declared === undefined
        ? undefined
        : {
            playerKey: declared.playerKey,
            playerName: rosterPlayer?.name ?? declared.playerName,
            fromSlot: rosterPlayer?.slot.status === "verified" ? rosterPlayer.slot.slot : undefined,
            toSlot: declared.toSlot,
          };
    const stepKeys = [
      ...executionSteps.map((step) => step.playerKey),
      ...(slotMove === undefined ? [] : [slotMove.playerKey]),
      ...(repair === undefined ? [] : [repair.playerKey]),
      ...(record.placement === undefined ? [] : [record.placement.playerKey]),
    ];
    const stepRefs = yield* tokens.sealPlayerRefs({ userId, leagueKey, playerKeys: stepKeys });
    const counterpartyRoster =
      record.counterpartyKey === undefined
        ? undefined
        : facts?.tradeRosters.get(record.counterpartyKey);
    const counterpartyPlayers = new Map(
      (counterpartyRoster?.players ?? []).map(
        (player) => [player.providerPlayerKey, player] as const,
      ),
    );
    const counterpartyRef =
      record.counterpartyKey === undefined
        ? undefined
        : yield* tokens.sealCounterpartyRef({
            userId,
            leagueKey,
            teamKey: record.counterpartyKey,
          });
    let reasonOffset = 0;
    const execution: ProposalItem["execution"] =
      record.outcome === undefined
        ? undefined
        : {
            ...(record.executionPosition === undefined
              ? {}
              : { position: record.executionPosition }),
            outcome: record.outcome,
            ...(record.outcomeDetail === undefined ? {} : { detail: record.outcomeDetail }),
            decidedAt: record.outcomeAt ?? record.updatedAt,
            steps: executionSteps.map((step, index): ProposalExecutionStep => ({
              kind: step.kind,
              player: {
                ref: Array.getUnsafe(stepRefs, index),
                ...(step.playerName === undefined ? {} : { name: step.playerName }),
              },
              ...(step.fromSlot === undefined ? {} : { fromSlot: step.fromSlot }),
              ...(step.toSlot === undefined ? {} : { toSlot: step.toSlot }),
              outcome: step.outcome,
              ...(step.detail === undefined ? {} : { detail: step.detail }),
              decidedAt: step.decidedAt,
            })),
          };
    const slot =
      slotMove === undefined ? undefined : moveView(slotMove, stepRefs, executionSteps.length);
    const reserve =
      repair === undefined
        ? undefined
        : {
            ...moveView(repair, stepRefs, executionSteps.length + (slotMove === undefined ? 0 : 1)),
            order: repair.order,
          };
    const placed =
      record.placement === undefined
        ? undefined
        : {
            ...moveView(
              record.placement,
              stepRefs,
              executionSteps.length +
                (slotMove === undefined ? 0 : 1) +
                (repair === undefined ? 0 : 1),
            ),
            detail: record.placement.detail,
          };
    return yield* Schema.decodeEffect(ProposalItemSchema)({
      id: record.id,
      team: record.team,
      kind: record.kind,
      adds: record.adds.map((add, index) => {
        const detail = facts?.players.get(add.key);
        const tradePlayer = counterpartyPlayers.get(add.key);
        const availability =
          detail !== undefined
            ? addAvailability(detail)
            : tradePlayer === undefined
              ? add.availability
              : (tradePlayer.injuryDetail ?? tradePlayer.injuryCode);
        const position = displayValue(detail?.displayPosition, add.position);
        const proTeam = displayValue(detail?.proTeam, add.proTeam);
        const tradePosition = tradePlayer?.displayPosition ?? position;
        const tradeProTeam = tradePlayer?.proTeamAbbreviation ?? proTeam;
        return {
          ref: Array.getUnsafe(addRefs, index),
          ...(add.name === undefined ? {} : { name: add.name }),
          ...(tradePosition === undefined ? {} : { position: tradePosition }),
          ...(tradeProTeam === undefined ? {} : { proTeam: tradeProTeam }),
          ...(availability === undefined ? {} : { availability }),
        };
      }),
      drops: record.drops.map((drop, index) => {
        const player = rostered.get(drop.key);
        const availability =
          player === undefined ? drop.availability : (player.injuryDetail ?? player.injuryCode);
        return {
          ref: Array.getUnsafe(dropRefs, index),
          ...(drop.name === undefined ? {} : { name: drop.name }),
          ...(displayValue(player?.displayPosition, drop.position) === undefined
            ? {}
            : { position: displayValue(player?.displayPosition, drop.position) }),
          ...(displayValue(player?.proTeamAbbreviation, drop.proTeam) === undefined
            ? {}
            : { proTeam: displayValue(player?.proTeamAbbreviation, drop.proTeam) }),
          ...(availability === undefined ? {} : { availability }),
        };
      }),
      ...(record.bid === undefined ? {} : { bid: record.bid }),
      reason: record.reason,
      state: record.state,
      settled: isSettledItem(record),
      staleness: {
        status: record.staleness.status,
        ...(record.staleness.checkedAt === undefined
          ? {}
          : { checkedAt: record.staleness.checkedAt }),
        reasons: record.staleness.reasons.map((reason) => {
          if (reason.playerKey === undefined) {
            return { code: reason.code, detail: reason.detail };
          }
          const ref = Array.getUnsafe(reasonRefs, reasonOffset);
          reasonOffset += 1;
          return { code: reason.code, player: ref, detail: reason.detail };
        }),
      },
      ...(execution === undefined ? {} : { execution }),
      ...(slot === undefined ? {} : { slotMove: slot }),
      ...(reserve === undefined ? {} : { reserveMove: reserve }),
      ...(placed === undefined ? {} : { placement: placed }),
      ...(counterpartyRef === undefined
        ? {}
        : {
            counterparty: {
              ref: counterpartyRef,
              ...(record.counterpartyName === undefined ? {} : { name: record.counterpartyName }),
              ...(record.counterpartyKey === undefined ||
              facts?.leagueTeams.find((entry) => entry.providerTeamKey === record.counterpartyKey)
                ?.managerName === undefined
                ? {}
                : {
                    managerName: facts.leagueTeams.find(
                      (entry) => entry.providerTeamKey === record.counterpartyKey,
                    )?.managerName,
                  }),
            },
          }),
      ...(record.trade === undefined
        ? {}
        : {
            trade: {
              state: record.trade.state,
              requestedAt: record.trade.requestedAt,
              ...(record.trade.proposedAt === undefined
                ? {}
                : { proposedAt: record.trade.proposedAt }),
              ...(record.trade.settledAt === undefined
                ? {}
                : { settledAt: record.trade.settledAt }),
              ...(record.trade.detail === undefined ? {} : { detail: record.trade.detail }),
            },
          }),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
  });
}

function moveView(
  move: MoveViewSource,
  refs: ReadonlyArray<PlayerRef>,
  index: number,
): NonNullable<ProposalItem["slotMove"]> {
  const ref = Array.getUnsafe(refs, index);
  return {
    player: {
      ref,
      ...(move.playerName === undefined ? {} : { name: move.playerName }),
    },
    ...(move.fromSlot === undefined ? {} : { fromSlot: move.fromSlot }),
    toSlot: move.toSlot,
  };
}

type MoveViewSource = {
  readonly playerKey: string;
  readonly playerName?: string;
  readonly fromSlot?: string;
  readonly toSlot: string;
};

function displayValue(
  primary: string | undefined,
  fallback: string | undefined,
): string | undefined {
  return primary ?? fallback;
}

function checkOutcomeDetail(staleness: StoredProposalStaleness | undefined): string {
  if (staleness === undefined) {
    return "This move could not be checked against current state, so it was not attempted.";
  }
  return staleness.reasons
    .map((reason) => reason.detail)
    .join(" ")
    .slice(0, 800);
}

function executionSequence(
  items: ReadonlyArray<ProposalItemRecord>,
  order: ProposalOrderPlan | undefined,
  changes: ReadonlyMap<string, ProposalItemChange>,
): ReadonlyArray<ProposalItemRecord> {
  const byId = new Map<string, ProposalItemRecord>(items.map((item) => [item.id, item] as const));
  const ordered =
    order?.status === "ordered"
      ? order.steps.flatMap((step) => {
          const item = byId.get(step.item);
          return item === undefined ? [] : [item];
        })
      : [];
  const placed = new Set(ordered.map((item) => item.id));
  const rest = items.filter(
    (item) => !placed.has(item.id) && changes.get(item.id)?.staleness.status === "current",
  );
  return [...ordered, ...rest];
}

function executableRefusal(
  item: ProposalItemRecord,
  transaction: ProviderCapabilities["transactionRequest"],
): string | undefined {
  if (item.kind === "slot_move") {
    return item.slotMove === undefined
      ? "This slot move names no player and destination slot, so there is nothing to send."
      : undefined;
  }
  if (item.kind === "activate" || item.kind === "stash") {
    return item.placement === undefined
      ? "This move names no place for the player, so there is nothing to send."
      : undefined;
  }
  if (item.adds.length + item.drops.length === 0) {
    return "This move names no player to add or drop, so there is nothing to send.";
  }
  if (item.kind === "trade") {
    if (item.counterpartyKey === undefined) {
      return "This trade names no counterparty, so there is nobody to make the offer to.";
    }
    if (item.adds.length === 0 || item.drops.length === 0) {
      return "A trade needs at least one player going out and one coming back before it can be sent.";
    }
    return undefined;
  }
  if (item.adds.length > transaction.maximumAdds || item.drops.length > transaction.maximumDrops) {
    return `A transaction request to your league carries at most ${String(transaction.maximumAdds)} ${transaction.maximumAdds === 1 ? "add" : "adds"} and ${String(transaction.maximumDrops)} ${transaction.maximumDrops === 1 ? "drop" : "drops"}, and this move names ${String(item.adds.length)} to add and ${String(item.drops.length)} to drop. Split it into separate items and propose a fresh set.`;
  }
  if (item.kind === "waiver_claim" && item.bid === undefined) {
    return "A waiver claim needs a FAAB bid before it can be sent.";
  }
  return undefined;
}

function stoppedDetailFor(
  item: ProposalItemRecord,
  outcome: ProposalOutcome,
  detail: string | undefined,
): string {
  const label = moveLabel(item);
  const words = detail === undefined ? "" : ` ${detail}`;
  switch (outcome) {
    case "failed":
      return `Not attempted because ${label} failed.${words} Later moves on this team were not checked against the resulting roster.`;
    case "unknown":
      return `Not attempted because ${label} may or may not have applied.${words} Later moves on this team were not checked against the resulting roster.`;
    case "pending":
      return `Not attempted because ${label} is still pending and may change the roster when it resolves.${words} Later moves on this team were not checked against the resulting roster.`;
    case "skipped":
    case "executed":
      return "Not attempted because an earlier move on this team did not complete.";
  }
}

function withdrawalRefusal(
  item: ProposalItemId,
  state: ProposalItemState | undefined,
): ProposalItemWithdrawalRefusal {
  return state === undefined
    ? {
        item,
        detail:
          "This move does not belong to the set. Read the set again and name a move it contains.",
      }
    : {
        item,
        state,
        detail: `This move is ${state} and can no longer be withdrawn. ${withdrawalStateDetail(state)}`,
      };
}

function lastSubmittedAt(loaded: {
  readonly submissions: ReadonlyArray<StoredProposalSubmission>;
}): DateTime.Utc {
  const last = loaded.submissions[loaded.submissions.length - 1];
  if (last === undefined) {
    throw new Error("A settled proposal set requires a submission");
  }
  return last.submittedAt;
}

function blocksReplacement(item: ProposalItemRecord): boolean {
  return (
    item.state === "proposed" ||
    item.state === "executed" ||
    item.state === "pending" ||
    item.state === "unknown" ||
    item.state === "accepted"
  );
}

function withdrawalStateDetail(state: ProposalItemState): string {
  switch (state) {
    case "proposed":
      return "It is still open.";
    case "executed":
      return "It has already run.";
    case "pending":
      return "It is waiting on your league or the other manager.";
    case "failed":
      return "It was attempted and failed; its outcome is part of the record.";
    case "skipped":
      return "It was submitted and skipped; its outcome is part of the record.";
    case "unknown":
      return "It may or may not have run and is never retried automatically.";
    case "accepted":
      return "The other manager accepted it, so it is no longer open.";
    case "withdrawn":
      return "It was already withdrawn.";
    case "expired":
      return "Your league expired it, so it is no longer open.";
  }
}

function moveLabel(item: ProposalItemRecord): string {
  if (item.kind === "slot_move" && item.slotMove !== undefined) {
    return `Moving ${item.slotMove.playerName ?? "a player"} to ${item.slotMove.toSlot}`;
  }
  if ((item.kind === "activate" || item.kind === "stash") && item.placement !== undefined) {
    return `Moving ${item.placement.playerName ?? "a player"} to ${item.placement.toSlot}`;
  }
  const adds = item.adds.flatMap((add) => (add.name === undefined ? [] : [add.name]));
  const drops = item.drops.flatMap((drop) => (drop.name === undefined ? [] : [drop.name]));
  if (item.kind === "trade" && adds.length > 0 && drops.length > 0) {
    return `Trading ${drops.join(", ")} to ${item.counterpartyName ?? "the counterparty"} for ${adds.join(", ")}`;
  }
  if (adds.length > 0 && drops.length > 0) {
    return `Adding ${adds.join(", ")} and dropping ${drops.join(", ")}`;
  }
  if (adds.length > 0) {
    return `Adding ${adds.join(", ")}`;
  }
  if (drops.length > 0) {
    return `Dropping ${drops.join(", ")}`;
  }
  return "This move";
}

function lineupView(lineup: StoredProposalLineup): ProposalTeamLineup {
  return {
    status: lineup.status,
    detail: lineup.detail,
    ...(lineup.run === undefined ? {} : { run: lineup.run }),
    at: lineup.at,
  };
}

function lineupOf(team: TeamId, run: LineupRun, at: DateTime.Utc): StoredProposalLineup {
  const summary = run.outcome?.summary.trim() ?? "";
  const decidedAt = DateTime.formatIso(at);
  switch (run.status) {
    case "completed":
    case "skipped":
      return {
        team,
        status: "settled",
        detail: summary === "" ? "The lineup is settled." : summary,
        run: run.run,
        at: decidedAt,
      };
    case "failed":
    case "blocked":
    case "uncertain":
      return {
        team,
        status: run.status,
        detail: summary === "" ? "The lineup did not settle." : summary,
        run: run.run,
        at: decidedAt,
      };
    case "superseded":
      return {
        team,
        status: "superseded",
        detail: summary === "" ? "A later lineup run replaced this one." : summary,
        run: run.run,
        at: decidedAt,
      };
    case "queued":
    case "reading":
    case "planning":
    case "validating":
    case "applying":
    case "verifying":
    case "retry-wait":
      return {
        team,
        status: "pending",
        detail:
          "The lineup run is queued; its outcome is reported separately from the transactions.",
        run: run.run,
        at: decidedAt,
      };
  }
}

function notStartedLineup(team: TeamId, detail: string, at: DateTime.Utc): StoredProposalLineup {
  return { team, status: "not_started", detail, at: DateTime.formatIso(at) };
}

function lineupFailureDetail(error: LineupError): string {
  switch (error._tag) {
    case "lineup.connection_not_ready":
      return "This team's connection is not ready, so its lineup was left as it was.";
    case "lineup.team_not_found":
      return "This team is not available to this account, so its lineup was left as it was.";
    case "lineup.request_conflict":
      return "Another lineup request already holds this submission's reference, so no lineup run was made.";
    case "lineup.selection_invalid":
      return "The lineup request was refused, so this team's lineup was left as it was.";
    case "lineup.run_not_found":
      return "The lineup run could not be found after it was requested.";
    case "lineup.persistence_failed":
      return "The lineup run could not be stored, so this team's lineup was left as it was.";
  }
}

function proposalCoverage(league: ProviderLeagueSettings): ProviderRosterCoverage | undefined {
  if (league.rosterCoverage === "week") {
    const week = league.periodWindow?.current;
    return week === undefined ? undefined : { type: "week", week };
  }
  const date = rosterChangeDate({
    rule: league.rosterChange?.rule,
    currentDate: league.currentDate,
  });
  return date === undefined ? undefined : { type: "date", date };
}

type ReserveMoveRun = {
  readonly step: ProposalStepCommand;
  readonly outcome: ProposalOutcome;
  readonly detail?: string;
};

function movementStepsOf(
  change: ProposalItemChange,
  outcome: ProposalOutcome,
  detail: string | undefined,
  decidedAt: DateTime.Utc,
): ReadonlyArray<ProposalStepCommand> {
  const step = (
    kind: "add" | "drop",
    player: { readonly key: string; readonly name?: string },
  ): ProposalStepCommand => ({
    kind,
    playerKey: player.key,
    ...(player.name === undefined ? {} : { playerName: player.name }),
    outcome,
    ...(detail === undefined ? {} : { detail }),
    decidedAt,
  });
  return [
    ...change.adds.map((add) => step("add", add)),
    ...change.drops.map((drop) => step("drop", drop)),
  ];
}

function skippedOutcome(
  item: ProposalItemRecord,
  detail: string,
  at: DateTime.Utc,
  position: number | undefined,
  settled: boolean,
): ProposalOutcomeCommand {
  return {
    itemId: item.id,
    outcome: "skipped",
    detail,
    at,
    position,
    steps: [],
    settled,
  };
}

function writeOutcome(write: ProviderWriteResult): ProposalOutcome {
  switch (write.status) {
    case "accepted":
      return "executed";
    case "rejected":
    case "not_sent":
      return "failed";
    case "unknown":
      return "unknown";
  }
}

function writeDetail(
  write: ProviderWriteResult,
  subject: "reserve move" | "slot move" | "transaction" | "trade offer",
): string | undefined {
  switch (write.status) {
    case "accepted":
      return undefined;
    case "rejected":
      return clamped(rejectionDetail(subject, write));
    case "not_sent":
      return notSentDetail("request", write);
    case "unknown":
      return `Your league did not confirm the ${subject}; it may or may not have applied. It was not retried.`;
  }
}

function rejectionDetail(
  subject: "reserve move" | "slot move" | "transaction" | "trade offer" | "withdrawal",
  write: Extract<ProviderWriteResult, { readonly status: "rejected" }>,
): string {
  const status = write.httpStatus === undefined ? "" : ` with HTTP ${String(write.httpStatus)}`;
  return write.detail === undefined
    ? `Your league rejected the ${subject}${status} without giving a reason.`
    : `Your league rejected the ${subject}${status}. It said: ${write.detail}`;
}

function notSentDetail(
  subject: "request" | "withdrawal",
  write: Extract<ProviderWriteResult, { readonly status: "not_sent" }>,
): string {
  if (write.detail !== undefined) {
    return clamped(`Your league did not send the ${subject}. It said: ${write.detail}`);
  }
  return write.reason === "session_incomplete"
    ? `The ${subject} was not sent because your league did not issue a write token.`
    : `The ${subject} was not sent to your league.`;
}

function sessionFailureDetail(
  tag: "provider.session_rejected" | "provider.response_invalid",
  subject: "reserve move" | "slot move" | "transaction",
): string {
  return tag === "provider.session_rejected"
    ? `Your league rejected the stored sign-in, so this ${subject} was not sent. Reconnect before proposing a fresh set.`
    : `The request to your league could not be prepared, so this ${subject} was not sent.`;
}

function clamped(value: string): string {
  return value.length <= 500 ? value : `${value.slice(0, 497)}...`;
}

function illegalSlots(
  facts: TeamFacts,
  droppedKeys: ReadonlySet<string>,
): ReadonlyArray<StoredProposalStaleReason> {
  const rule = rosterRuleOf(facts.league.rosterConstraints, facts.league.rosterPositions);
  const byKey = new Map(
    facts.roster.players.map((player) => [player.providerPlayerKey, player] as const),
  );
  return rosterOccupancy({
    rule,
    players: facts.roster.players.map((player) => ({
      key: player.providerPlayerKey,
      name: player.name,
      slot: player.slot.status === "verified" ? player.slot.slot : undefined,
      positions: player.eligiblePositions,
    })),
  }).illegal.flatMap((occupant) => {
    if (droppedKeys.has(occupant.key)) {
      return [];
    }
    const player = byKey.get(occupant.key);
    const providerNote =
      player?.injuryDetail === undefined ? "" : ` Your league reports "${player.injuryDetail}".`;
    return [
      {
        code: "slot_illegal" as const,
        playerKey: occupant.key,
        detail: `${occupant.detail}${providerNote} Move them to a legal slot in your league, then revalidate this set.`,
      },
    ];
  });
}

function tradePartiesTeam(trade: ProviderPendingTrade, providerTeamKey: string): boolean {
  return (
    trade.proposer?.providerTeamKey === providerTeamKey ||
    trade.receiver?.providerTeamKey === providerTeamKey
  );
}

function toPendingTradeOffers(
  tokens: QueryTokens["Service"],
  userId: UserId,
  leagueKey: string,
  teamKey: string,
  trades: ReadonlyArray<ProviderPendingTrade>,
): Effect.Effect<ReadonlyArray<PendingTradeOffer>, ProposalPersistenceFailed> {
  return toPendingTradeOffersGroups(tokens, userId, [{ leagueKey, teamKey, trades }]).pipe(
    Effect.map((groups) => Array.getUnsafe(groups, 0)),
  );
}

function toPendingTradeOffersGroups(
  tokens: QueryTokens["Service"],
  userId: UserId,
  groups: ReadonlyArray<{
    readonly leagueKey: string;
    readonly teamKey: string;
    readonly trades: ReadonlyArray<ProviderPendingTrade>;
  }>,
): Effect.Effect<ReadonlyArray<ReadonlyArray<PendingTradeOffer>>, ProposalPersistenceFailed> {
  return Effect.gen(function* () {
    const ownGroups = groups.map((group) => ({
      ...group,
      trades: group.trades.filter((trade) => tradePartiesTeam(trade, group.teamKey)),
    }));
    const playerKeysByGroup = ownGroups.map((group) =>
      group.trades.flatMap((trade) => trade.players.map((player) => player.providerPlayerKey)),
    );
    const teamKeysByGroup = ownGroups.map((group) => {
      const keys = new Set<string>();
      for (const trade of group.trades) {
        const remember = (team: ProviderTransactionTeam | undefined): void => {
          if (team !== undefined) {
            keys.add(team.providerTeamKey);
          }
        };
        remember(trade.proposer);
        remember(trade.receiver);
        for (const player of trade.players) {
          remember(player.movement.from);
          remember(player.movement.to);
        }
        for (const pick of trade.picks) {
          remember(pick.from);
          remember(pick.to);
          remember(pick.original);
        }
      }
      return [...keys];
    });
    const playerRefsByGroup = yield* tokens.sealPlayerRefGroups({
      userId,
      groups: ownGroups.map((group, index) => ({
        leagueKey: group.leagueKey,
        playerKeys: Array.getUnsafe(playerKeysByGroup, index),
      })),
    });
    const teamRefsByGroup = yield* tokens.sealCounterpartyRefGroups({
      userId,
      groups: ownGroups.map((group, index) => ({
        leagueKey: group.leagueKey,
        teamKeys: Array.getUnsafe(teamKeysByGroup, index),
      })),
    });
    const offerRefsByGroup = yield* tokens.sealTradeOfferRefGroups({
      userId,
      groups: ownGroups.map((group) => ({
        leagueKey: group.leagueKey,
        transactionKeys: group.trades.map((trade) => trade.transactionKey),
      })),
    });
    const result: Array<ReadonlyArray<PendingTradeOffer>> = [];
    for (const [groupIndex, group] of ownGroups.entries()) {
      const playerRefs = Array.getUnsafe(playerRefsByGroup, groupIndex);
      const teamRefs = Array.getUnsafe(teamRefsByGroup, groupIndex);
      const offerRefs = Array.getUnsafe(offerRefsByGroup, groupIndex);
      const teamKeys = Array.getUnsafe(teamKeysByGroup, groupIndex);
      const partyByTeam = new Map(
        teamKeys.map((key, index) => [key, Array.getUnsafe(teamRefs, index)] as const),
      );
      const partyOf = (team: ProviderTransactionTeam | undefined): PendingParty | undefined => {
        if (team === undefined) {
          return undefined;
        }
        const ref = partyByTeam.get(team.providerTeamKey);
        if (ref === undefined) {
          throw new Error("A pending trade party is missing its reference");
        }
        return team.name === undefined ? { ref } : { ref, name: team.name };
      };
      const offers: Array<PendingTradeOffer> = [];
      let playerOffset = 0;
      for (const [tradeIndex, trade] of group.trades.entries()) {
        const proposedAt = yield* Schema.decodeEffect(Schema.DateTimeUtcFromString)(
          trade.proposedAt,
        ).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        const proposingTeam = partyOf(trade.proposer);
        const receivingTeam = partyOf(trade.receiver);
        offers.push({
          offerRef: Array.getUnsafe(offerRefs, tradeIndex),
          proposedAt,
          ...(trade.note === undefined ? {} : { note: trade.note }),
          canRespond: trade.canRespond,
          ...(proposingTeam === undefined ? {} : { proposingTeam }),
          ...(receivingTeam === undefined ? {} : { receivingTeam }),
          players: trade.players.map((player, playerIndex) => {
            const from = partyOf(player.movement.from);
            const to = partyOf(player.movement.to);
            return {
              player: Array.getUnsafe(playerRefs, playerOffset + playerIndex),
              ...(player.name === undefined ? {} : { name: player.name }),
              ...(player.displayPosition === undefined
                ? {}
                : { displayPosition: player.displayPosition }),
              ...(player.proTeam === undefined ? {} : { proTeam: player.proTeam }),
              ...(from === undefined ? {} : { from }),
              ...(to === undefined ? {} : { to }),
            };
          }),
          picks: trade.picks.map((pick) => {
            const from = partyOf(pick.from);
            const to = partyOf(pick.to);
            const original = partyOf(pick.original);
            return {
              round: pick.round,
              ...(from === undefined ? {} : { from }),
              ...(to === undefined ? {} : { to }),
              ...(original === undefined ? {} : { original }),
            };
          }),
          ...(trade.incomplete === undefined
            ? {}
            : {
                incomplete: {
                  code:
                    trade.incomplete.code === "no_movements"
                      ? ("no_movements" as const)
                      : ("movement_missing_party" as const),
                  detail: trade.incomplete.detail,
                },
              }),
        });
        playerOffset += trade.players.length;
      }
      result.push(offers);
    }
    return result;
  });
}
