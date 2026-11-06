import { Array, DateTime, Effect, Layer, Result, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { TeamId } from "#contexts/connections/FantasyTeam.ts";
import {
  planProposalOrder,
  slotAcceptsPositions,
  slotMismatchDetail,
} from "#contexts/connections/ProposalOrder.ts";
import type {
  ProposalOrderItem,
  ProposalOrderPlan,
  ProposalOrderPlayer,
} from "#contexts/connections/ProposalOrder.ts";
import type {
  ProviderCapabilities,
  ProviderLeagueSettings,
  ProviderLeagueTeam,
  ProviderNativeTarget,
  ProviderPendingTrade,
  ProviderPlayerDetail,
  ProviderReadFailure,
  ProviderRoster,
  ProviderTransaction,
  ProviderTransactionTeam,
  ProviderWriteResult,
} from "#contexts/connections/Provider.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";
import type { QueryError, QueryTeam } from "#contexts/connections/QueryValues.ts";
import type { CounterpartyRef, PlayerRef } from "#contexts/connections/QueryValues.ts";
import type {
  PendingTradeOffer,
  ProposalBudget,
  ProposalExecutionStep,
  ProposalItem,
  ProposalItemDraft,
  ProposalItemRefused,
  ProposalItemState,
  ProposalOutcome,
  ProposalSet,
  ProposalSetProvenance,
  ProposalSetReview,
  ProposalSubmission,
  ProposeTransactionsResult,
} from "#contexts/connections/TransactionProposals.ts";
import {
  PendingTradeOffersResult as PendingTradeOffersResultSchema,
  ProposalConnectionNotReady,
  ProposalContentInvalid,
  ProposalItem as ProposalItemSchema,
  ProposalNothingAccepted,
  ProposalNothingIncluded,
  ProposalPersistenceFailed,
  ProposalProviderUnavailable,
  ProposalSetAlreadySubmitted,
  ProposalSetExpired,
  ProposalSetNotFound,
  ProposalSetReview as ProposalSetReviewSchema,
  ProposalTeam as ProposalTeamSchema,
  ProposalTeamNotFound,
  ProposalTradeNotFound,
  ProposalTradeNotPending,
  ProposeTransactionsInput,
  ProposeTransactionsResult as ProposeTransactionsResultSchema,
  SubmitTransactionProposalInput,
  TransactionProposals,
  WithdrawTradeInput,
  WithdrawTradeResult as WithdrawTradeResultSchema,
} from "#contexts/connections/TransactionProposals.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import { loadTeamContext, ownerNoteOf, providerIdentity } from "./QueryContext.ts";
import type { TeamContext } from "./QueryContext.ts";
import { QueryRepository } from "./QueryRepository.ts";
import { QueryTokens } from "./QueryTokens.ts";
import {
  StoredProposalOrderPlan,
  type ProposalItemRecord,
  type ProposalSetRecord,
  type ProposalStepRecord,
  type ProposalTeamRecord,
  type StoredProposalOrder,
  type StoredProposalPlayer,
  type StoredProposalStaleReason,
  type StoredProposalStaleness,
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
  "A proposal set needs one to twenty items. Each item names an owned team, a kind, the players to add or drop, an optional FAAB bid of 0 or more, and a reason of at most 500 characters. A drop item adds nobody, a free-agent add carries no bid, a waiver claim requires a bid, a trade names a counterparty with at least one player going out and one coming back, and a slot move names one rostered player and one destination slot without adding or dropping anyone. A trade carries no bid and no draft picks.";

const submitInvalidDetail =
  "A submission names one proposal set and one to twenty of its move ids. Reload the review and submit again.";
const excludedDetail = "Left out of this submission.";
const skippedMovementDetail =
  "Not attempted because the reserve move did not complete, so the transaction was not sent.";
const unknownReserveDetail =
  "We could not confirm whether the reserve move applied, so the add or drop was not attempted. Nothing was retried.";
const waiverPendingDetail =
  "The provider has not processed this waiver claim yet. It may still be awarded or lost, so this move is pending rather than done.";

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

type TradeFeed = {
  readonly pending: ReadonlyArray<ProviderPendingTrade>;
  readonly completed: ReadonlyArray<ProviderTransaction>;
  readonly completedUnavailable: boolean;
};

type ItemExecution = {
  readonly outcome: ProposalOutcome;
  readonly detail?: string;
  readonly steps: ReadonlyArray<ProposalStepCommand>;
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

    const propose: TransactionProposals["Service"]["propose"] = Effect.fn(
      "TransactionProposals.propose",
    )(function* (userId: UserId, proposer: ProposalSetProvenance, input) {
      const decoded = yield* Schema.decodeEffect(ProposeTransactionsInput)(input).pipe(
        Effect.mapError(() => ProposalContentInvalid.make({ detail: contentInvalidDetail })),
      );
      const ownedTeams = yield* repository.listTeams(userId);
      const teamsById = new Map(ownedTeams.map((team) => [team.id, team] as const));
      const refusals: Array<ProposalItemRefused> = [];
      const accepted: Array<AcceptedDraft> = [];
      const firstIndexByKey = new Map<string, number>();
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
          refusals.push({
            index,
            outcome: "refused",
            refusal: "team_not_owned",
            detail: `Item ${String(index + 1)} names a team this account does not have. List your teams and propose the item against one of them.`,
          });
          continue;
        }
        if ((draft.picks ?? []).length > 0) {
          const tradeProposal = tradeProposalByProvider.get(team.provider);
          if (tradeProposal === undefined) {
            throw new Error(`Team ${team.id} references an unregistered provider`);
          }
          if (tradeProposal.assets.includes("draft_pick")) {
            throw new Error(
              "A provider accepts draft picks in a trade proposal, but a proposal item cannot carry one",
            );
          }
          refusals.push({
            index,
            outcome: "refused",
            refusal: "draft_pick_included",
            detail: tradeProposal.detail,
          });
          continue;
        }
        const shape = proposalShape(draft);
        if (shape !== undefined) {
          refusals.push({
            index,
            outcome: "refused",
            refusal: shape.refusal,
            detail: shape.detail,
          });
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
            (entry.draft.slotMove === undefined || entry.draft.slotMove === null ? 0 : 1);
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
        const adds = addKeys.filter(isPlayerKey);
        const drops = dropKeys.filter(isPlayerKey);
        if (adds.length !== addKeys.length || drops.length !== dropKeys.length) {
          refusals.push({
            index,
            outcome: "refused",
            refusal: "reference_invalid",
            detail: `Item ${String(index + 1)} carries a player reference this account did not receive from a read of that team's league. Read the roster or the player pool again and propose with those references.`,
          });
          continue;
        }
        if (draft.kind === "slot_move" && !isPlayerKey(moveRef)) {
          refusals.push({
            index,
            outcome: "refused",
            refusal: "reference_invalid",
            detail: `Item ${String(index + 1)} carries a player reference this account did not receive from a read of that team's league. Read the roster again and name the player to move from that read.`,
          });
          continue;
        }
        if (
          draft.kind === "trade" &&
          (draft.counterparty === undefined || draft.counterparty === null)
        ) {
          refusals.push({
            index,
            outcome: "refused",
            refusal: "kind_invalid",
            detail: `Item ${String(index + 1)} is a trade without a counterparty team. Name the team the offer goes to.`,
          });
          continue;
        }
        if (counterpartyInvalid.has(index)) {
          refusals.push({
            index,
            outcome: "refused",
            refusal: "reference_invalid",
            detail: `Item ${String(index + 1)} carries a counterparty reference this account did not receive from a read of that team's league. Read the league's teams again and name the counterparty from that read.`,
          });
          continue;
        }
        candidates.push({
          index,
          team,
          draft,
          adds,
          drops,
          slotMoveKey: isPlayerKey(moveRef) ? moveRef : undefined,
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
          refusals.push({
            index,
            outcome: "refused",
            refusal: "player_in_both",
            detail: `Item ${String(index + 1)} adds and drops the same player. A transaction moves a player once.`,
          });
          continue;
        }
        const slotMove =
          candidate.slotMoveKey === undefined ||
          draft.slotMove === undefined ||
          draft.slotMove === null
            ? undefined
            : { player: candidate.slotMoveKey, toSlot: draft.slotMove.toSlot };
        const key = proposalItemKey({
          team: draft.team,
          kind: draft.kind,
          counterpartyKey,
          adds,
          drops,
          slotMove,
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
          draft.bid ?? undefined,
        );
        const firstIndex = firstIndexByKey.get(moveKey);
        if (firstIndex !== undefined) {
          refusals.push({
            index,
            outcome: "refused",
            refusal: "duplicate_item",
            detail: `Item ${String(index + 1)} repeats item ${String(firstIndex + 1)} for the same team and players. Keep one of them.`,
          });
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

      if (accepted.length === 0) {
        return yield* ProposalNothingAccepted.make({
          refusals,
          detail:
            "No item was accepted into a set, so no review was created. Fix the refused items and propose again.",
        });
      }

      const now = yield* DateTime.now;
      const client = decoded.client ?? undefined;
      const created = yield* repository.create({
        userId,
        proposedBy: client === undefined ? proposer : { ...proposer, client },
        fingerprintSource: accepted
          .map((entry) => entry.key)
          .sort()
          .join("\n"),
        teams: ownedTeams.map((team) => team.id),
        items: accepted.map((entry) => entry.command),
        at: now,
      });
      const recordsByKey = new Map(
        created.items.map((item) => [recordItemKey(item), item] as const),
      );
      const outcomes: Array<ProposeTransactionsResult["items"][number]> = [];
      for (const entry of accepted) {
        const record = recordsByKey.get(entry.key);
        if (record === undefined) {
          throw new Error("A created proposal item is missing from the set");
        }
        outcomes.push({
          index: entry.index,
          outcome: "accepted",
          item: yield* toItem(tokens, userId, entry.team, record, undefined, undefined, undefined),
        });
      }
      for (const refusal of refusals) {
        outcomes.push(refusal);
      }
      outcomes.sort((left, right) => left.index - right.index);
      yield* Effect.annotateCurrentSpan({
        "proposal.set_created": created.created,
        "proposal.items": accepted.length,
        "proposal.items_refused": refusals.length,
      });
      return yield* Schema.decodeEffect(ProposeTransactionsResultSchema)({
        set: toSet(created.set, now),
        created: created.created,
        items: outcomes,
        detail: created.created
          ? `Created proposal set ${created.set.id} with ${String(accepted.length)} item${accepted.length === 1 ? "" : "s"}. It is ready for the review screen; nothing has been sent to the provider.`
          : `This exact set was already proposed as ${created.set.id}. The existing set is returned instead of a duplicate; nothing has been sent to the provider.`,
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
      const submitted = loaded.set.submittedAt !== undefined;
      if (!submitted && isExpired(loaded.set, now)) {
        return yield* ProposalSetExpired.make({
          set: loaded.set.id,
          expiresAt: loaded.set.expiresAt,
        });
      }
      const teams = yield* repository.loadTeams(userId, loaded.set.teams);
      const teamsById = new Map(teams.map((team) => [team.id, team] as const));
      const openItems = submitted ? [] : loaded.items.filter((item) => isOpen(item.state));
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
        items,
        loaded.steps,
        now,
        checkedByTeam,
        offersByTeam,
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
      if (loaded.set.submittedAt !== undefined) {
        return yield* ProposalSetAlreadySubmitted.make({
          set: loaded.set.id,
          submittedAt: loaded.set.submittedAt,
        });
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
      const included = loaded.items.filter((item) => include.has(item.id));
      if (included.length === 0) {
        return yield* ProposalNothingIncluded.make({
          detail:
            "No move is selected for submission. Include at least one current move, or propose a fresh set.",
        });
      }
      if (included.length !== include.size) {
        return yield* ProposalContentInvalid.make({
          detail:
            "A selected move does not belong to this proposal set. Reload the review and submit again.",
        });
      }
      const teams = yield* repository.loadTeams(userId, loaded.set.teams);
      const teamsById = new Map(teams.map((team) => [team.id, team] as const));
      const openIncluded = included.filter((item) => isOpen(item.state));
      const itemsByTeam = new Map<TeamId, Array<ProposalItemRecord>>();
      for (const item of openIncluded) {
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
      if (!claimed) {
        const latest = yield* repository.load(userId, decoded.set);
        if (latest?.set.submittedAt !== undefined) {
          return yield* ProposalSetAlreadySubmitted.make({
            set: latest.set.id,
            submittedAt: latest.set.submittedAt,
          });
        }
        if (latest !== undefined && isExpired(latest.set, now)) {
          return yield* ProposalSetExpired.make({
            set: latest.set.id,
            expiresAt: latest.set.expiresAt,
          });
        }
        return yield* ProposalPersistenceFailed.make({
          cause: new Error("The proposal set could not be claimed for submission"),
        });
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
          openIncluded.filter((item) => item.team === teamId),
          checkByTeam.get(teamId)?.order,
          changeById,
        );
        sequenceByTeam.set(teamId, sequence);
        for (const [index, item] of sequence.entries()) {
          positionByItem.set(item.id, index);
        }
      }

      const outcomes: Array<ProposalOutcomeCommand> = [];

      for (const item of loaded.items) {
        const current = itemById.get(item.id) ?? item;
        if (!include.has(item.id)) {
          outcomes.push(skippedOutcome(current, excludedDetail, now));
          continue;
        }
        if (!isOpen(current.state)) {
          outcomes.push(
            skippedOutcome(
              current,
              `This move is already ${current.state} and was not attempted.`,
              now,
            ),
          );
          continue;
        }
        const change = changeById.get(item.id);
        if (change === undefined || change.staleness.status !== "current") {
          outcomes.push(
            skippedOutcome(
              current,
              checkOutcomeDetail(change?.staleness),
              now,
              positionByItem.get(current.id),
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
            outcomes.push(skippedOutcome(current, stoppedDetail, decidedAt, position));
            continue;
          }
          if (check?.facts === undefined || check.context === undefined) {
            outcomes.push(
              skippedOutcome(
                current,
                "Current state could not be read, so this move was not attempted.",
                decidedAt,
                position,
              ),
            );
            continue;
          }
          const refusal = executableRefusal(
            current,
            check.context.provider.capabilities.transactionRequest,
          );
          if (refusal !== undefined) {
            outcomes.push(skippedOutcome(current, refusal, decidedAt, position));
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
        at: completedAt,
      });
      const final = yield* repository.load(userId, loaded.set.id);
      if (final === undefined) {
        return yield* ProposalPersistenceFailed.make({
          cause: new Error("A submitted proposal set could not be read back"),
        });
      }
      yield* Effect.annotateCurrentSpan({
        "proposal.items_submitted": included.length,
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
              "This team now belongs to a different provider connection than the one the move was staged against, so nothing was sent with another connection's session.",
            steps: [],
          };
        }
        if (input.item.kind === "trade") {
          return yield* executeTradeItem(input);
        }
        if (input.item.kind === "slot_move") {
          return yield* executeSlotMove(input);
        }
        const steps: Array<ProposalStepCommand> = [];
        const movementSteps = (
          outcome: ProposalOutcome,
          detail: string | undefined,
          decidedAt: DateTime.Utc,
        ): ReadonlyArray<ProposalStepCommand> => [
          ...input.change.adds.map((add) => ({
            kind: "add" as const,
            playerKey: add.key,
            ...(add.name === undefined ? {} : { playerName: add.name }),
            outcome,
            ...(detail === undefined ? {} : { detail }),
            decidedAt,
          })),
          ...input.change.drops.map((drop) => ({
            kind: "drop" as const,
            playerKey: drop.key,
            ...(drop.name === undefined ? {} : { playerName: drop.name }),
            outcome,
            ...(detail === undefined ? {} : { detail }),
            decidedAt,
          })),
        ];
        if (input.change.reserveMove !== undefined) {
          const move = input.change.reserveMove;
          const coverage = reserveCoverage(input.facts.league);
          if (coverage === undefined) {
            const stepAt = yield* DateTime.now;
            const detail =
              "The league publishes no current date or scoring week, so the reserve move could not be targeted. Nothing was sent for this move.";
            steps.push({
              kind: "reserve_move",
              playerKey: move.playerKey,
              ...(move.playerName === undefined ? {} : { playerName: move.playerName }),
              fromSlot: move.fromSlot,
              toSlot: move.toSlot,
              outcome: "failed",
              detail,
              decidedAt: stepAt,
            });
            appendSteps(steps, movementSteps("skipped", skippedMovementDetail, stepAt));
            return { outcome: "failed", detail, steps };
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
          const stepAt = yield* DateTime.now;
          if (reserve._tag === "Failure") {
            if (reserve.failure._tag === "provider.session_rejected") {
              yield* queries.recordSessionRejected(input.userId, input.context.owned);
            }
            const detail = sessionFailureDetail(reserve.failure._tag, "reserve move");
            steps.push({
              kind: "reserve_move",
              playerKey: move.playerKey,
              ...(move.playerName === undefined ? {} : { playerName: move.playerName }),
              fromSlot: move.fromSlot,
              toSlot: move.toSlot,
              outcome: "failed",
              detail,
              decidedAt: stepAt,
            });
            appendSteps(steps, movementSteps("skipped", skippedMovementDetail, stepAt));
            return { outcome: "failed", detail, steps };
          }
          const outcome = writeOutcome(reserve.success);
          const detail = writeDetail(reserve.success, "reserve move");
          steps.push({
            kind: "reserve_move",
            playerKey: move.playerKey,
            ...(move.playerName === undefined ? {} : { playerName: move.playerName }),
            fromSlot: move.fromSlot,
            toSlot: move.toSlot,
            outcome,
            ...(detail === undefined ? {} : { detail }),
            decidedAt: stepAt,
          });
          if (outcome !== "executed") {
            appendSteps(
              steps,
              movementSteps(
                "skipped",
                outcome === "unknown" ? unknownReserveDetail : skippedMovementDetail,
                stepAt,
              ),
            );
            return { outcome, ...(detail === undefined ? {} : { detail }), steps };
          }
        }

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
            yield* queries.recordSessionRejected(input.userId, input.context.owned);
          }
          const detail = sessionFailureDetail(transaction.failure._tag, "transaction");
          appendSteps(steps, movementSteps("failed", detail, stepAt));
          return { outcome: "failed", detail, steps };
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
          appendSteps(steps, movementSteps(movementOutcome, detail, stepAt));
          return { outcome: movementOutcome, ...(detail === undefined ? {} : { detail }), steps };
        }
        const detail = writeDetail(transaction.success, "transaction");
        appendSteps(steps, movementSteps(outcome, detail, stepAt));
        return { outcome, ...(detail === undefined ? {} : { detail }), steps };
      });
    }

    function executeSlotMove(input: {
      readonly userId: UserId;
      readonly item: ProposalItemRecord;
      readonly change: ProposalItemChange;
      readonly facts: TeamFacts;
      readonly context: TeamContext;
    }): Effect.Effect<ItemExecution> {
      return Effect.gen(function* () {
        const move = input.item.slotMove;
        if (move === undefined) {
          return {
            outcome: "skipped",
            detail: "This slot move names no player and destination slot, so nothing was sent.",
            steps: [],
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
          ...(rostered?.slot.status === "verified" ? { fromSlot: rostered.slot.slot } : {}),
          toSlot: move.toSlot,
          outcome,
          ...(detail === undefined ? {} : { detail }),
          decidedAt,
        });
        const coverage = reserveCoverage(input.facts.league);
        if (coverage === undefined) {
          const stepAt = yield* DateTime.now;
          const detail =
            "The league publishes no current date or scoring week, so the slot move could not be targeted. Nothing was sent for this move.";
          return { outcome: "failed", detail, steps: [step("failed", detail, stepAt)] };
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
            yield* queries.recordSessionRejected(input.userId, input.context.owned);
          }
          const detail = sessionFailureDetail(applied.failure._tag, "slot move");
          return { outcome: "failed", detail, steps: [step("failed", detail, stepAt)] };
        }
        const outcome = writeOutcome(applied.success);
        const detail = writeDetail(applied.success, "slot move");
        return {
          outcome,
          ...(detail === undefined ? {} : { detail }),
          steps: [step(outcome, detail, stepAt)],
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
            yield* queries.recordSessionRejected(input.userId, input.context.owned);
          }
          return {
            outcome: "failed",
            detail: sessionFailureDetail(sent.failure._tag, "transaction"),
            steps: [],
          };
        }
        switch (sent.success.status) {
          case "accepted":
            return {
              outcome: "pending",
              detail: `Offer sent to ${input.item.counterpartyName ?? "the counterparty"}. The other manager decides; we cannot accept on their behalf.`,
              steps: [],
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
                "The provider did not confirm the trade offer, so it may or may not exist. It was not retried. Check the provider's trade page before proposing again.",
              steps: [],
            };
          case "rejected":
            return {
              outcome: "failed",
              detail:
                writeDetail(sent.success, "trade offer") ??
                "The provider rejected the trade offer. Nothing was retried.",
              steps: [],
            };
          case "not_sent":
            return {
              outcome: "failed",
              detail: notSentDetail("request", sent.success),
              steps: [],
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
                    ? "The provider rejected the stored session. Reconnect the connection and read the offers again."
                    : error._tag === "provider.request_failed"
                      ? "The provider's pending trade offers could not be read."
                      : "The provider's pending trade offers could not be verified.",
              });
              return error._tag === "provider.session_rejected"
                ? queries
                    .recordSessionRejected(userId, context.owned)
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
            "This provider publishes no pending trade offers for this read, so none are shown rather than an empty success.",
        }).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
      }
      const offers = yield* toPendingTradeOffers(
        tokens,
        userId,
        context.owned.team.providerLeagueKey,
        outcome.trades,
      );
      return yield* Schema.decodeEffect(PendingTradeOffersResultSchema)({
        status: "available",
        team,
        readOnly: true,
        offers,
        ownerNote: ownerNoteOf(context.owned.team),
        coverage: [
          {
            resource: "pending_trade_offers",
            status: "available",
            source: "provider_pending_trade",
            fetchedAt,
          },
        ],
        detail:
          "Read-only. These are this team's pending trade offers as the provider publishes them to this account. Lineupgrade cannot accept, reject, or vote on an offer; a signed-in person can withdraw an offer this account made from the review page.",
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
        const rejected: Array<Parameters<typeof queries.recordSessionRejected>[1]> = [];
        const feeds = yield* Effect.forEach(
          [...new Set(teamIds)],
          (teamId) =>
            Effect.gen(function* () {
              const team = teamsById.get(teamId);
              if (team === undefined) {
                return { teamId, leagueKey: undefined, trades: [] } as const;
              }
              const loaded = yield* Effect.result(
                loadTeamContext(queries, encryption, registry, userId, teamId),
              );
              if (loaded._tag === "Failure") {
                return { teamId, leagueKey: undefined, trades: [] } as const;
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
                  rejected.push(context.owned);
                }
                return { teamId, leagueKey: undefined, trades: [] } as const;
              }
              return {
                teamId,
                leagueKey: team.providerLeagueKey,
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
            readonly trades: ReadonlyArray<ProviderPendingTrade>;
          } => feed.leagueKey !== undefined && feed.trades.length > 0,
        );
        const mappedGroups = yield* toPendingTradeOffersGroups(
          tokens,
          userId,
          withTrades.map((feed) => ({ leagueKey: feed.leagueKey, trades: feed.trades })),
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
              "A withdrawal names one owned team and exactly one pending offer, either a stored proposal item or a provider pending offer.",
          }),
        ),
      );
      if ((decoded.item === undefined) === (decoded.offer === undefined)) {
        return yield* ProposalContentInvalid.make({
          detail:
            "A withdrawal names exactly one target: a proposal item id or a provider pending offer reference.",
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
              "This team now belongs to a different provider connection, so the offer was not withdrawn with the stored session. Reload and read the provider's trade page.",
          });
        }
        if (item.trade === undefined || item.trade.state !== "pending") {
          return yield* ProposalTradeNotPending.make({
            state: item.trade?.state ?? "expired",
            detail:
              item.trade === undefined
                ? "This trade was never proposed to the provider, so there is nothing to withdraw."
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
          yield* queries.recordSessionRejected(userId, context.owned);
        }
        return yield* ProposalProviderUnavailable.make({
          detail:
            "The provider's pending trade offers could not be read, so nothing was withdrawn. Check the provider's trade page before trying again.",
        });
      }
      if (!before.success.some((offer) => offer.transactionKey === transactionKey)) {
        return yield* ProposalTradeNotPending.make({
          state: item?.trade?.state ?? "expired",
          detail:
            "The provider does not list this offer as pending, so nothing was withdrawn. Reload to read its current state.",
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
          yield* queries.recordSessionRejected(userId, context.owned);
        }
        return yield* ProposalProviderUnavailable.make({
          detail:
            withdrawn.failure._tag === "provider.session_rejected"
              ? "The provider rejected the stored session, so the offer was not withdrawn. Reconnect the connection and check its trade page."
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
                "The provider accepted the withdrawal but still lists the offer as pending. Nothing else was attempted; check the provider's trade page.",
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
                    detail: "Withdrawn before acceptance. The provider deletes a withdrawn offer.",
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
              "The provider confirmed the withdrawal and no longer lists the offer. Nothing was accepted on the other manager's behalf.",
          }).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
        }
        case "unknown":
          return yield* ProposalProviderUnavailable.make({
            detail:
              "The provider did not confirm the withdrawal, so it may or may not have applied. It was not retried. Check the provider's trade page.",
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
                `Item ${String(candidate.index + 1)} cannot be checked against the provider (${failure}).`,
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
                `Item ${String(candidate.index + 1)} names a counterparty in another league. Read this league's teams and name one of them.`,
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

    function checkTeam(
      userId: UserId,
      teamId: TeamId,
      team: ProposalTeamRecord | undefined,
      items: ReadonlyArray<ProposalItemRecord>,
      at: DateTime.Utc,
    ): Effect.Effect<TeamCheck> {
      return Effect.gen(function* () {
        if (team === undefined) {
          return failedCheck(
            teamId,
            items,
            "Current state could not be read: this team is no longer linked to the account.",
            at,
          );
        }
        const loaded = yield* Effect.result(
          loadTeamContext(queries, encryption, registry, userId, team.id),
        );
        if (loaded._tag === "Failure") {
          return failedCheck(
            teamId,
            items,
            `Current state could not be read: ${queryFailureDetail(loaded.failure)}`,
            at,
          );
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
          return yield* providerFailedCheck(userId, context, items, league.failure._tag, at);
        }
        const settings = league.success;
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
              period: undefined,
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
                      period: undefined,
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
                  yield* queries.recordSessionRejected(userId, context.owned);
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
        const [rosterResult, teamsResult, detailsResult, tradeRostersResult, feed] =
          yield* Effect.all([roster, leagueTeams, details, tradeRosters, tradeFeed] as const, {
            concurrency: "unbounded",
          });
        if (rosterResult._tag === "Failure") {
          return yield* providerFailedCheck(userId, context, items, rosterResult.failure._tag, at);
        }
        if (teamsResult._tag === "Failure") {
          return yield* providerFailedCheck(userId, context, items, teamsResult.failure._tag, at);
        }
        if (detailsResult._tag === "Failure") {
          return yield* providerFailedCheck(userId, context, items, detailsResult.failure._tag, at);
        }
        const facts: TeamFacts = {
          league: settings,
          roster: rosterResult.success,
          leagueTeams: teamsResult.success,
          providerTeamKey: context.owned.team.providerTeamKey,
          players: new Map(
            detailsResult.success.map((detail) => [detail.providerPlayerKey, detail] as const),
          ),
          tradeRosters: new Map(
            [...tradeRostersResult.entries()].flatMap(([key, result]) =>
              result._tag === "Success" ? [[key, result.success] as const] : [],
            ),
          ),
        };
        const budget = budgetOf(facts, items);
        const changes = items.map((item) => evaluateItem(item, facts, budget, at, feed));
        const plan = orderFor(facts, items, changes);
        const ordered = orderChanges(changes, items, plan, at);
        const order = publishedOrder(plan.plan, items, ordered);
        return {
          team: teamId,
          ...(budget === undefined ? {} : { budget }),
          facts,
          context,
          ...(feed === undefined ? {} : { tradeFeed: feed }),
          changes: ordered,
          ...(order === undefined ? {} : { order }),
        };
      });
    }

    function providerFailedCheck(
      userId: UserId,
      context: TeamContext,
      items: ReadonlyArray<ProposalItemRecord>,
      failure: string,
      at: DateTime.Utc,
    ): Effect.Effect<TeamCheck> {
      const failed = failedCheck(
        context.owned.team.id,
        items,
        `Current state could not be read: a provider read failed (${failure}).`,
        at,
      );
      return failure === "provider.session_rejected"
        ? queries.recordSessionRejected(userId, context.owned).pipe(Effect.as(failed))
        : Effect.succeed(failed);
    }
  }),
);

type TeamPlan = {
  readonly plan: ProposalOrderPlan | undefined;
  readonly refused: ReadonlyMap<string, { readonly code: string; readonly detail: string }>;
};

function orderFor(
  facts: TeamFacts,
  items: ReadonlyArray<ProposalItemRecord>,
  changes: ReadonlyArray<ProposalItemChange>,
): TeamPlan {
  let remaining: Array<ProposalOrderItem> = [];
  for (const [index, change] of changes.entries()) {
    const item = items[index];
    if (item === undefined || item.kind === "trade" || change.staleness.status !== "current") {
      continue;
    }
    remaining.push(orderItemOf(facts, item, change));
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
  const refused = new Map<string, { readonly code: string; readonly detail: string }>();
  for (;;) {
    const plan = planProposalOrder({ slots, players, timing, items: remaining });
    if (plan.status !== "conflict") {
      return { plan, refused };
    }
    const blocked = plan.conflicts
      .flatMap((conflict) => conflict.reasons ?? [])
      .filter((reason) => reason.code === "roster_full" || reason.code === "slot_illegal");
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
    declared === undefined
      ? undefined
      : {
          player: {
            key: declared.playerKey,
            name: declaredName ?? declared.playerKey,
          },
          toSlot: declared.toSlot,
        };
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
    label: orderItemLabel(adds, drops, move),
    adds,
    drops,
    move,
    mayRepair: item.kind !== "slot_move",
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
      return {
        ...change,
        ...(called.code === "roster_full"
          ? { staleness: staleCheck([{ code: "roster_full", detail: called.detail }], at) }
          : {
              staleness: checked([], [{ code: "slot_illegal", detail: called.detail }], at),
            }),
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
        steps: order.steps.map((step) => ({ item: step.item, position: step.position })),
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
          items: teamItems,
          pendingOffers: offersByTeam?.get(teamId) ?? [],
        }).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause }))),
      );
    }
    return yield* Schema.decodeEffect(ProposalSetReviewSchema)({
      set: toSet(set, now),
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
        detail: `The provider does not publish whether ${name ?? "an added player"} is available, so the add cannot be checked.`,
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
      detail: `The league's period ended on ${facts.league.endDate}, and the provider's current date is ${facts.league.currentDate}.`,
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
      detail: `The provider reports no verified slot for ${player.name}, so the move cannot be planned.`,
    });
  }
  const slot = facts.league.rosterPositions.find((position) => position.position === move.toSlot);
  if (slot === undefined) {
    illegal.push({
      code: "move_slot_unknown",
      playerKey: player.providerPlayerKey,
      detail: `The league does not declare a ${move.toSlot} slot, so ${player.name} cannot move there.`,
    });
  } else if (!slotAcceptsPositions(slot.eligibility, player.eligiblePositions)) {
    illegal.push({
      code: "slot_illegal",
      playerKey: player.providerPlayerKey,
      detail: `${player.name} is not eligible for the ${slot.position} slot: it does not accept their positions (${player.eligiblePositions.join(", ")}).`,
    });
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
          "The provider no longer lists this offer, and its completed trades could not be read. Check the provider's trade page.",
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
        detail: `The provider no longer lists this offer and the league's trade window closed on ${facts.league.tradeEndDate ?? "an unpublished date"}.`,
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
        "The provider no longer lists this offer and it is not among its completed trades. The provider publishes no ended record, so it was withdrawn or expired elsewhere.",
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
        "The provider publishes no remaining FAAB balance for this team, so the bid cannot be checked against it.",
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
  detail: string,
): ProposalItemRefused {
  return { index, outcome: "refused", refusal, detail };
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
      return "The provider accepted the withdrawal.";
    case "rejected":
      return clamped(rejectionDetail("withdrawal", write));
    case "not_sent":
      return notSentDetail("withdrawal", write);
    case "unknown":
      return "The provider did not confirm the withdrawal, so it may or may not have applied. It was not retried. Check the provider's trade page.";
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
  switch (draft.kind) {
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
      if (move !== undefined) {
        return {
          refusal: "kind_invalid",
          detail: "Only a slot move item names a destination slot.",
        };
      }
      return bid === undefined
        ? undefined
        : {
            refusal: "bid_invalid",
            detail: "A drop item cannot carry a FAAB bid. Use a waiver claim to spend a bid.",
          };
    case "free_agent_add":
      if (draft.adds.length === 0) {
        return {
          refusal: "kind_invalid",
          detail: "A free-agent add names at least one player to add.",
        };
      }
      if (move !== undefined) {
        return {
          refusal: "kind_invalid",
          detail: "Only a slot move item names a destination slot.",
        };
      }
      return bid === undefined
        ? undefined
        : {
            refusal: "bid_invalid",
            detail: "A free-agent add carries no bid. Use a waiver claim for a FAAB bid.",
          };
    case "waiver_claim":
      if (draft.adds.length === 0) {
        return {
          refusal: "kind_invalid",
          detail: "A waiver claim names at least one player to add.",
        };
      }
      if (move !== undefined) {
        return {
          refusal: "kind_invalid",
          detail: "Only a slot move item names a destination slot.",
        };
      }
      return bid === undefined
        ? { refusal: "bid_invalid", detail: "A waiver claim requires a FAAB bid." }
        : undefined;
    case "trade":
      if (draft.adds.length === 0 || draft.drops.length === 0) {
        return {
          refusal: "kind_invalid",
          detail:
            "A trade names at least one player going out and at least one player coming back.",
        };
      }
      if (move !== undefined) {
        return {
          refusal: "kind_invalid",
          detail: "Only a slot move item names a destination slot.",
        };
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
    bid ?? null,
  ]);
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
    bid: item.bid,
    reason: item.reason,
  });
}

function toSet(set: ProposalSetRecord, now: DateTime.Utc): ProposalSet {
  return {
    id: set.id,
    proposedBy: set.proposedBy,
    createdAt: set.createdAt,
    expiresAt: set.expiresAt,
    expired: isExpired(set, now),
    ...(set.submittedAt === undefined
      ? {}
      : {
          submission: {
            submittedAt: set.submittedAt,
            ...(set.completedAt === undefined ? {} : { completedAt: set.completedAt }),
          } satisfies ProposalSubmission,
        }),
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
        : moveView(repair, stepRefs, executionSteps.length + (slotMove === undefined ? 0 : 1));
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
): ProposalItem["slotMove"] {
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
    return `The provider's transaction request carries at most ${String(transaction.maximumAdds)} ${transaction.maximumAdds === 1 ? "add" : "adds"} and ${String(transaction.maximumDrops)} ${transaction.maximumDrops === 1 ? "drop" : "drops"}, and this move names ${String(item.adds.length)} to add and ${String(item.drops.length)} to drop. Split it into separate items and propose a fresh set.`;
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

function moveLabel(item: ProposalItemRecord): string {
  if (item.kind === "slot_move" && item.slotMove !== undefined) {
    return `Moving ${item.slotMove.playerName ?? "a player"} to ${item.slotMove.toSlot}`;
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

function reserveCoverage(league: ProviderLeagueSettings): ProviderNativeTarget | undefined {
  if (league.rosterCoverage === "week") {
    const week = league.periodWindow?.current;
    return week === undefined ? undefined : { type: "week", week };
  }
  return league.currentDate === undefined ? undefined : { type: "date", date: league.currentDate };
}

function appendSteps(
  steps: Array<ProposalStepCommand>,
  more: ReadonlyArray<ProposalStepCommand>,
): void {
  for (const step of more) {
    steps.push(step);
  }
}

function skippedOutcome(
  item: ProposalItemRecord,
  detail: string,
  at: DateTime.Utc,
  position?: number,
): ProposalOutcomeCommand {
  return {
    itemId: item.id,
    outcome: "skipped",
    detail,
    at,
    position,
    steps: [],
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
      return `The provider did not confirm the ${subject}; it may or may not have applied. It was not retried.`;
  }
}

function rejectionDetail(
  subject: "reserve move" | "slot move" | "transaction" | "trade offer" | "withdrawal",
  write: Extract<ProviderWriteResult, { readonly status: "rejected" }>,
): string {
  const status = write.httpStatus === undefined ? "" : ` with HTTP ${String(write.httpStatus)}`;
  return write.detail === undefined
    ? `The provider rejected the ${subject}${status} without giving a reason.`
    : `The provider rejected the ${subject}${status}. It said: ${write.detail}`;
}

function notSentDetail(
  subject: "request" | "withdrawal",
  write: Extract<ProviderWriteResult, { readonly status: "not_sent" }>,
): string {
  if (write.detail !== undefined) {
    return clamped(`The provider did not send the ${subject}. It said: ${write.detail}`);
  }
  return write.reason === "session_incomplete"
    ? `The ${subject} was not sent because the provider did not issue a write token.`
    : `The ${subject} was not sent to the provider.`;
}

function sessionFailureDetail(
  tag: "provider.session_rejected" | "provider.response_invalid",
  subject: "reserve move" | "slot move" | "transaction",
): string {
  return tag === "provider.session_rejected"
    ? `The provider rejected the stored session, so this ${subject} was not sent. Reconnect the connection before proposing a fresh set.`
    : `The provider request could not be prepared, so this ${subject} was not sent.`;
}

function clamped(value: string): string {
  return value.length <= 500 ? value : `${value.slice(0, 497)}...`;
}

function illegalSlots(
  facts: TeamFacts,
  droppedKeys: ReadonlySet<string>,
): ReadonlyArray<StoredProposalStaleReason> {
  const slotsByName = new Map(
    facts.league.rosterPositions.map((position) => [position.position, position] as const),
  );
  const reasons: Array<StoredProposalStaleReason> = [];
  for (const player of facts.roster.players) {
    if (player.slot.status !== "verified" || droppedKeys.has(player.providerPlayerKey)) {
      continue;
    }
    const slot = slotsByName.get(player.slot.slot);
    if (slot === undefined) {
      continue;
    }
    if (slotAcceptsPositions(slot.eligibility, player.eligiblePositions)) {
      continue;
    }
    const providerNote =
      player.injuryDetail === undefined ? "" : ` The provider reports "${player.injuryDetail}".`;
    reasons.push({
      code: "slot_illegal",
      playerKey: player.providerPlayerKey,
      detail: `${slotMismatchDetail({ name: player.name, slot: slot.position, positions: player.eligiblePositions })}${providerNote} Move them to a legal slot at the provider, then revalidate this set.`,
    });
  }
  return reasons;
}

function toPendingTradeOffers(
  tokens: QueryTokens["Service"],
  userId: UserId,
  leagueKey: string,
  trades: ReadonlyArray<ProviderPendingTrade>,
): Effect.Effect<ReadonlyArray<PendingTradeOffer>, ProposalPersistenceFailed> {
  return toPendingTradeOffersGroups(tokens, userId, [{ leagueKey, trades }]).pipe(
    Effect.map((groups) => Array.getUnsafe(groups, 0)),
  );
}

function toPendingTradeOffersGroups(
  tokens: QueryTokens["Service"],
  userId: UserId,
  groups: ReadonlyArray<{
    readonly leagueKey: string;
    readonly trades: ReadonlyArray<ProviderPendingTrade>;
  }>,
): Effect.Effect<ReadonlyArray<ReadonlyArray<PendingTradeOffer>>, ProposalPersistenceFailed> {
  return Effect.gen(function* () {
    const playerKeysByGroup = groups.map((group) =>
      group.trades.flatMap((trade) => trade.players.map((player) => player.providerPlayerKey)),
    );
    const teamKeysByGroup = groups.map((group) => {
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
      groups: groups.map((group, index) => ({
        leagueKey: group.leagueKey,
        playerKeys: Array.getUnsafe(playerKeysByGroup, index),
      })),
    });
    const teamRefsByGroup = yield* tokens.sealCounterpartyRefGroups({
      userId,
      groups: groups.map((group, index) => ({
        leagueKey: group.leagueKey,
        teamKeys: Array.getUnsafe(teamKeysByGroup, index),
      })),
    });
    const offerRefsByGroup = yield* tokens.sealTradeOfferRefGroups({
      userId,
      groups: groups.map((group) => ({
        leagueKey: group.leagueKey,
        transactionKeys: group.trades.map((trade) => trade.transactionKey),
      })),
    });
    const result: Array<ReadonlyArray<PendingTradeOffer>> = [];
    for (const [groupIndex, group] of groups.entries()) {
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
