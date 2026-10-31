import { Array, DateTime, Effect, Layer, Result, Schema } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { TeamId } from "#contexts/connections/FantasyTeam.ts";
import type {
  ProviderLeagueSettings,
  ProviderLeagueTeam,
  ProviderNativeTarget,
  ProviderPendingTrade,
  ProviderPlayerDetail,
  ProviderReadFailure,
  ProviderRoster,
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
  ProposeTransactionsInput,
  ProposeTransactionsResult as ProposeTransactionsResultSchema,
  SubmitTransactionProposalInput,
  TransactionProposals,
} from "#contexts/connections/TransactionProposals.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import { loadTeamContext, providerIdentity } from "./QueryContext.ts";
import type { TeamContext } from "./QueryContext.ts";
import { QueryRepository } from "./QueryRepository.ts";
import { QueryTokens } from "./QueryTokens.ts";
import type {
  ProposalItemRecord,
  ProposalSetRecord,
  ProposalStepRecord,
  ProposalTeamRecord,
  StoredProposalStaleReason,
  StoredProposalStaleness,
  StoredReserveMove,
} from "./TransactionProposalRecord.ts";
import { TransactionProposalRepository } from "./TransactionProposalRepository.ts";
import type {
  ProposalItemChange,
  ProposalItemCommand,
  ProposalOutcomeCommand,
  ProposalStepCommand,
} from "./TransactionProposalRepository.ts";

const contentInvalidDetail =
  "A proposal set needs one to twenty items. Each item names an owned team, a kind, the players to add or drop, an optional FAAB bid of 0 or more, and a reason of at most 500 characters. A drop item adds nobody, a free-agent add carries no bid, and a waiver claim requires a bid.";

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

type TeamFacts = {
  readonly league: ProviderLeagueSettings;
  readonly roster: ProviderRoster;
  readonly leagueTeams: ReadonlyArray<ProviderLeagueTeam>;
  readonly providerTeamKey: string;
  readonly players: ReadonlyMap<string, ProviderPlayerDetail>;
};

type TeamCheck = {
  readonly team: TeamId;
  readonly budget?: ProposalBudget;
  readonly failure?: string;
  readonly facts?: TeamFacts;
  readonly context?: TeamContext;
  readonly changes: ReadonlyArray<ProposalItemChange>;
};

type ItemExecution = {
  readonly outcome: ProposalOutcome;
  readonly detail?: string;
  readonly steps: ReadonlyArray<ProposalStepCommand>;
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
        refs: entries.flatMap((entry) => [...entry.draft.adds, ...entry.draft.drops]),
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
          const count = entry.draft.adds.length + entry.draft.drops.length;
          openedByIndex.set(entry.index, opened.slice(offset, offset + count));
          offset += count;
        }
      }

      for (const { index, team, draft } of prepared) {
        const opened = openedByIndex.get(index) ?? [];
        const addKeys = opened.slice(0, draft.adds.length);
        const dropKeys = opened.slice(draft.adds.length);
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
        const key = proposalItemKey({
          team: draft.team,
          kind: draft.kind,
          adds,
          drops,
          bid: draft.bid ?? undefined,
          reason: draft.reason,
        });
        const moveKey = proposalMoveKey(
          draft.team,
          draft.kind,
          adds,
          drops,
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
            kind: draft.kind,
            adds: adds.map((add) => ({ key: add })),
            drops: drops.map((drop) => ({ key: drop })),
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
      if (loaded.set.submittedAt !== undefined) {
        const submittedTeams = yield* repository.loadTeams(userId, loaded.set.teams);
        return yield* buildReview(
          tokens,
          userId,
          submittedTeams,
          loaded.set,
          loaded.items,
          loaded.steps,
          now,
        );
      }
      if (isExpired(loaded.set, now)) {
        return yield* ProposalSetExpired.make({
          set: loaded.set.id,
          expiresAt: loaded.set.expiresAt,
        });
      }
      const teams = yield* repository.loadTeams(userId, loaded.set.teams);
      const teamsById = new Map(teams.map((team) => [team.id, team] as const));
      const openItems = loaded.items.filter((item) => isOpen(item.state));
      const itemsByTeam = new Map<TeamId, Array<ProposalItemRecord>>();
      for (const item of openItems) {
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
      const saved =
        changes.length === 0
          ? []
          : yield* repository.saveChecks({
              userId,
              setId: loaded.set.id,
              changes,
              at: now,
            });
      const savedById = new Map(saved.map((item) => [item.id, item] as const));
      const checkedByTeam = new Map(checks.map((check) => [check.team, check] as const));
      const items = loaded.items.map((item) => savedById.get(item.id) ?? item);
      yield* Effect.annotateCurrentSpan({
        "proposal.items_checked": openItems.length,
        "proposal.teams_checked": checks.length,
        "proposal.teams_failed": checks.filter((check) => check.failure !== undefined).length,
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
      const saved =
        changes.length === 0
          ? []
          : yield* repository.saveChecks({
              userId,
              setId: loaded.set.id,
              changes,
              at: now,
            });
      const savedById = new Map(saved.map((item) => [item.id, item] as const));
      const itemById = new Map(
        loaded.items.map((item) => [item.id, savedById.get(item.id) ?? item] as const),
      );
      const changeById = new Map(changes.map((change) => [change.id, change] as const));
      const checkByTeam = new Map(checks.map((check) => [check.team, check] as const));

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
          outcomes.push(skippedOutcome(current, staleOutcomeDetail(change?.staleness), now));
        }
      }

      const stopped = new Map<TeamId, string>();
      for (const teamId of loaded.set.teams) {
        const check = checkByTeam.get(teamId);
        const teamItems = openIncluded
          .filter((item) => item.team === teamId)
          .sort((left, right) => left.position - right.position);
        for (const item of teamItems) {
          const current = itemById.get(item.id) ?? item;
          const change = changeById.get(item.id);
          if (change === undefined || change.staleness.status !== "current") {
            continue;
          }
          const decidedAt = yield* DateTime.now;
          const stoppedDetail = stopped.get(teamId);
          if (stoppedDetail !== undefined) {
            outcomes.push(skippedOutcome(current, stoppedDetail, decidedAt));
            continue;
          }
          if (check?.facts === undefined || check.context === undefined) {
            outcomes.push(
              skippedOutcome(
                current,
                "Current state could not be read, so this move was not attempted.",
                decidedAt,
              ),
            );
            continue;
          }
          const refusal = executableRefusal(current);
          if (refusal !== undefined) {
            outcomes.push(skippedOutcome(current, refusal, decidedAt));
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
            steps: execution.steps,
          });
          if (execution.outcome !== "executed") {
            stopped.set(teamId, stoppedDetailFor(current, execution.outcome));
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
      const offers: Array<PendingTradeOffer> = [];
      for (const trade of outcome.trades) {
        offers.push(
          yield* toPendingTradeOffer(tokens, userId, context.owned.team.providerLeagueKey, trade),
        );
      }
      return yield* Schema.decodeEffect(PendingTradeOffersResultSchema)({
        status: "available",
        team,
        readOnly: true,
        offers,
        coverage: [
          {
            resource: "pending_trade_offers",
            status: "available",
            source: "provider_pending_trade",
            fetchedAt,
          },
        ],
        detail:
          "Read-only. These are this team's pending trade offers as the provider publishes them to this account. Lineupkeep cannot accept, reject, or cancel an offer.",
      }).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
    });

    return TransactionProposals.of({ propose, revalidate, read, submit, readPendingOffers });

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
        const addKeys = [...new Set(items.flatMap((item) => item.adds.map((add) => add.key)))];
        const needsBudget = items.some((item) => item.bid !== undefined);
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
        > = needsBudget
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
        const [rosterResult, teamsResult, detailsResult] = yield* Effect.all(
          [roster, leagueTeams, details] as const,
          { concurrency: "unbounded" },
        );
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
        };
        const budget = budgetOf(facts, items);
        return {
          team: teamId,
          ...(budget === undefined ? {} : { budget }),
          facts,
          context,
          changes: items.map((item) => evaluateItem(item, facts, budget, at)),
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

function buildReview(
  tokens: QueryTokens["Service"],
  userId: UserId,
  teams: ReadonlyArray<ProposalTeamRecord>,
  set: ProposalSetRecord,
  items: ReadonlyArray<ProposalItemRecord>,
  steps: ReadonlyArray<ProposalStepRecord>,
  now: DateTime.Utc,
  checks?: ReadonlyMap<TeamId, TeamCheck>,
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
      const teamItems = [];
      for (const item of itemsByTeam.get(teamId) ?? []) {
        teamItems.push(
          yield* toItem(
            tokens,
            userId,
            team,
            item,
            check?.facts,
            check?.changes.find((change) => change.id === item.id)?.reserveMove,
            stepsByItem.get(item.id),
          ),
        );
      }
      reviewed.push(
        yield* Schema.decodeEffect(ProposalTeamSchema)({
          team: teamView(team),
          ...(check?.budget === undefined ? {} : { budget: check.budget }),
          ...(check?.failure === undefined ? {} : { failure: check.failure }),
          items: teamItems,
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
): ProposalItemChange {
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
  const reservePositions = facts.league.rosterPositions.filter(
    (position) => position.kind === "reserve",
  );
  const reserveNames = new Set(reservePositions.map((position) => position.position));
  const inReserve = facts.roster.players.filter(
    (player) => player.slot.status === "verified" && reserveNames.has(player.slot.slot),
  );
  const capacity = facts.league.rosterPositions.reduce(
    (total, position) => (position.kind === "reserve" ? total : total + position.count),
    0,
  );
  const occupied = facts.roster.players.length - inReserve.length;
  const dropped = drops.filter((drop) => rostered.has(drop.key)).length;
  const needed = adds.length - (capacity - (occupied - dropped));
  let reserveMove: StoredReserveMove | undefined;
  if (capacity > 0 && needed > 0) {
    reserveMove = needed === 1 ? planReserveMove(item, facts, reservePositions) : undefined;
    if (reserveMove === undefined) {
      reasons.push({
        code: "roster_full",
        detail:
          needed === 1
            ? `This team holds ${String(occupied)} roster players and the league allows ${String(capacity)}. Adding ${String(adds.length)} while dropping ${String(dropped)} would exceed it, and no roster player is eligible for an open reserve slot.`
            : `This team holds ${String(occupied)} roster players and the league allows ${String(capacity)}. Adding ${String(adds.length)} while dropping ${String(dropped)} needs ${String(needed)} roster spots, and one item can open only one by moving a player to a reserve slot.`,
      });
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
    ...(reserveMove === undefined ? {} : { reserveMove }),
    staleness: reasons.length === 0 ? currentCheck(at) : staleCheck(reasons, at),
  };
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
  switch (draft.kind) {
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
      return bid === undefined
        ? { refusal: "bid_invalid", detail: "A waiver claim requires a FAAB bid." }
        : undefined;
  }
}

function proposalItemKey(input: {
  readonly team: string;
  readonly kind: string;
  readonly adds: ReadonlyArray<string>;
  readonly drops: ReadonlyArray<string>;
  readonly bid: number | undefined;
  readonly reason: string;
}): string {
  return JSON.stringify([
    input.team,
    input.kind,
    [...input.adds].sort(),
    [...input.drops].sort(),
    input.bid ?? null,
    input.reason,
  ]);
}

function proposalMoveKey(
  team: string,
  kind: string,
  adds: ReadonlyArray<string>,
  drops: ReadonlyArray<string>,
  bid: number | undefined,
): string {
  return JSON.stringify([team, kind, [...adds].sort(), [...drops].sort(), bid ?? null]);
}

function recordItemKey(item: ProposalItemRecord): string {
  return proposalItemKey({
    team: item.team,
    kind: item.kind,
    adds: item.adds.map((add) => add.key),
    drops: item.drops.map((drop) => drop.key),
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

function teamView(team: ProposalTeamRecord): QueryTeam {
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
  reserveMove: StoredReserveMove | undefined,
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
    const stepKeys = [
      ...executionSteps.map((step) => step.playerKey),
      ...(reserveMove === undefined ? [] : [reserveMove.playerKey]),
    ];
    const stepRefs = yield* tokens.sealPlayerRefs({ userId, leagueKey, playerKeys: stepKeys });
    const rostered = new Map(
      (facts?.roster.players ?? []).map((player) => [player.providerPlayerKey, player] as const),
    );
    let reasonOffset = 0;
    const execution: ProposalItem["execution"] =
      record.outcome === undefined
        ? undefined
        : {
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
    const reserve =
      reserveMove === undefined
        ? undefined
        : reserveMoveView(reserveMove, stepRefs, executionSteps.length);
    return yield* Schema.decodeEffect(ProposalItemSchema)({
      id: record.id,
      team: record.team,
      kind: record.kind,
      adds: record.adds.map((add, index) => {
        const detail = facts?.players.get(add.key);
        const availability = detail === undefined ? add.availability : addAvailability(detail);
        return {
          ref: Array.getUnsafe(addRefs, index),
          ...(add.name === undefined ? {} : { name: add.name }),
          ...(displayValue(detail?.displayPosition, add.position) === undefined
            ? {}
            : { position: displayValue(detail?.displayPosition, add.position) }),
          ...(displayValue(detail?.proTeam, add.proTeam) === undefined
            ? {}
            : { proTeam: displayValue(detail?.proTeam, add.proTeam) }),
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
      ...(reserve === undefined ? {} : { reserveMove: reserve }),
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
  });
}

function reserveMoveView(
  move: StoredReserveMove,
  refs: ReadonlyArray<PlayerRef>,
  index: number,
): ProposalItem["reserveMove"] {
  const ref = Array.getUnsafe(refs, index);
  return {
    player: {
      ref,
      ...(move.playerName === undefined ? {} : { name: move.playerName }),
    },
    fromSlot: move.fromSlot,
    toSlot: move.toSlot,
  };
}

function displayValue(
  primary: string | undefined,
  fallback: string | undefined,
): string | undefined {
  return primary ?? fallback;
}

function staleOutcomeDetail(staleness: StoredProposalStaleness | undefined): string {
  if (staleness === undefined) {
    return "This move could not be checked against current state, so it was not attempted.";
  }
  return staleness.reasons
    .map((reason) => reason.detail)
    .join(" ")
    .slice(0, 800);
}

function executableRefusal(item: ProposalItemRecord): string | undefined {
  if (item.adds.length + item.drops.length === 0) {
    return "This move names no player to add or drop, so there is nothing to send.";
  }
  if (item.adds.length > 1 || item.drops.length > 1) {
    return `The provider's transaction request carries one add and one drop, and this move names ${String(item.adds.length)} to add and ${String(item.drops.length)} to drop. Split it into separate items and propose a fresh set.`;
  }
  if (item.kind === "waiver_claim" && item.bid === undefined) {
    return "A waiver claim needs a FAAB bid before it can be sent.";
  }
  return undefined;
}

function stoppedDetailFor(item: ProposalItemRecord, outcome: ProposalOutcome): string {
  const label = moveLabel(item);
  switch (outcome) {
    case "failed":
      return `Not attempted: ${label} failed, so this team's later moves were not checked against the resulting roster.`;
    case "unknown":
      return `Not attempted: ${label} may or may not have applied, so this team's later moves were not checked against the resulting roster.`;
    case "pending":
      return `Not attempted: ${label} is pending on waivers and could change the roster when it resolves, so this team's later moves were not checked against the resulting roster.`;
    case "skipped":
    case "executed":
      return "Not attempted because an earlier move on this team did not complete.";
  }
}

function moveLabel(item: ProposalItemRecord): string {
  const adds = item.adds.flatMap((add) => (add.name === undefined ? [] : [add.name]));
  const drops = item.drops.flatMap((drop) => (drop.name === undefined ? [] : [drop.name]));
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
): ProposalOutcomeCommand {
  return {
    itemId: item.id,
    outcome: "skipped",
    detail,
    at,
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
  subject: "reserve move" | "transaction",
): string | undefined {
  switch (write.status) {
    case "accepted":
      return undefined;
    case "rejected":
      return clamped(write.detail ?? `The provider rejected the ${subject} without saying why.`);
    case "not_sent":
      return clamped(
        write.detail ??
          (write.reason === "session_incomplete"
            ? "The request was not sent because the provider did not issue a write token."
            : "The request was not sent to the provider."),
      );
    case "unknown":
      return `The provider did not confirm the ${subject}; it may or may not have applied. It was not retried.`;
  }
}

function sessionFailureDetail(
  tag: "provider.session_rejected" | "provider.response_invalid",
  subject: "reserve move" | "transaction",
): string {
  return tag === "provider.session_rejected"
    ? `The provider rejected the stored session, so this ${subject} was not sent. Reconnect the connection before proposing a fresh set.`
    : `The provider request could not be prepared, so this ${subject} was not sent.`;
}

function clamped(value: string): string {
  return value.length <= 500 ? value : `${value.slice(0, 497)}...`;
}

function planReserveMove(
  item: ProposalItemRecord,
  facts: TeamFacts,
  reserves: ProviderLeagueSettings["rosterPositions"],
): StoredReserveMove | undefined {
  const reserveNames = new Set(reserves.map((position) => position.position));
  const occupants = new Map<string, number>();
  for (const player of facts.roster.players) {
    if (player.slot.status === "verified" && reserveNames.has(player.slot.slot)) {
      occupants.set(player.slot.slot, (occupants.get(player.slot.slot) ?? 0) + 1);
    }
  }
  const open = reserves.flatMap((position) => {
    const remaining = position.count - (occupants.get(position.position) ?? 0);
    return remaining > 0 ? [{ position: position.position, remaining }] : [];
  });
  const addKeys = new Set(item.adds.map((add) => add.key));
  const dropKeys = new Set(item.drops.map((drop) => drop.key));
  const candidates = facts.roster.players
    .filter(
      (player) =>
        player.isEditable === true &&
        player.slot.status === "verified" &&
        !reserveNames.has(player.slot.slot) &&
        !addKeys.has(player.providerPlayerKey) &&
        !dropKeys.has(player.providerPlayerKey),
    )
    .flatMap((player) => {
      const target = open.find((entry) => player.eligiblePositions.includes(entry.position));
      return target === undefined
        ? []
        : [
            {
              player,
              target: target.position,
              injured: player.injuryCode !== undefined || player.injuryDetail !== undefined ? 0 : 1,
            },
          ];
    })
    .sort(
      (left, right) =>
        left.injured - right.injured ||
        left.player.name.localeCompare(right.player.name) ||
        left.player.providerPlayerKey.localeCompare(right.player.providerPlayerKey),
    );
  const chosen = candidates[0];
  if (chosen === undefined || chosen.player.slot.status !== "verified") {
    return undefined;
  }
  return {
    playerKey: chosen.player.providerPlayerKey,
    playerName: chosen.player.name,
    fromSlot: chosen.player.slot.slot,
    toSlot: chosen.target,
  };
}

function toPendingTradeOffer(
  tokens: QueryTokens["Service"],
  userId: UserId,
  leagueKey: string,
  trade: ProviderPendingTrade,
): Effect.Effect<PendingTradeOffer, ProposalPersistenceFailed> {
  return Effect.gen(function* () {
    const playerRefs = yield* tokens.sealPlayerRefs({
      userId,
      leagueKey,
      playerKeys: trade.players.map((player) => player.providerPlayerKey),
    });
    const nameByTeam = new Map<string, string | undefined>();
    const remember = (team: ProviderTransactionTeam | undefined): void => {
      if (team !== undefined && !nameByTeam.has(team.providerTeamKey)) {
        nameByTeam.set(team.providerTeamKey, team.name);
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
    const teamKeys = [...nameByTeam.keys()];
    const teamRefs = yield* tokens.sealCounterpartyRefs({ userId, leagueKey, teamKeys });
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
    const proposedAt = yield* Schema.decodeEffect(Schema.DateTimeUtcFromString)(
      trade.proposedAt,
    ).pipe(Effect.mapError((cause) => ProposalPersistenceFailed.make({ cause })));
    const proposingTeam = partyOf(trade.proposer);
    const receivingTeam = partyOf(trade.receiver);
    return {
      proposedAt,
      ...(trade.note === undefined ? {} : { note: trade.note }),
      canRespond: trade.canRespond,
      ...(proposingTeam === undefined ? {} : { proposingTeam }),
      ...(receivingTeam === undefined ? {} : { receivingTeam }),
      players: trade.players.map((player, index) => {
        const from = partyOf(player.movement.from);
        const to = partyOf(player.movement.to);
        return {
          player: Array.getUnsafe(playerRefs, index),
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
    };
  });
}
