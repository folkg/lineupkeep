import { DateTime, Effect, Layer, Option } from "effect";
import type { Redacted } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { TeamId } from "#contexts/connections/FantasyTeam.ts";
import type {
  LineupImplementation,
  LineupPlanProvenance,
  LineupPlanRefusalProvenance,
  LineupRunDifference,
  LineupRunId,
  LineupTargetPeriod,
} from "#contexts/connections/LineupRun.ts";
import {
  customLineupImplementation,
  LineupPersistenceFailed,
  nativeLineupImplementation,
} from "#contexts/connections/LineupRun.ts";
import { LineupWorker } from "#contexts/connections/LineupWork.ts";
import type {
  Provider,
  ProviderLeagueSettings,
  ProviderLineupAssignment,
  ProviderNativeTarget,
  ProviderReadFailure,
  ProviderResponseInvalid,
  ProviderRoster,
  ProviderRosterCoverage,
  ProviderRosterSlot,
  ProviderScoreOutcome,
  ProviderSessionRejected,
  ProviderWriteResult,
} from "#contexts/connections/Provider.ts";
import { ProviderRegistry } from "#contexts/connections/ProviderRegistry.ts";
import { ScheduleGate } from "#contexts/connections/ScheduleGate.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import { planAssignments } from "./LineupPlanning.ts";
import type { ClaimedLineupRun, LineupWriteIntentRecord } from "./LineupRunRepository.ts";
import { LineupRunRepository as LineupRunRepositoryService } from "./LineupRunRepository.ts";
import type {
  LineupObservation,
  LineupPlan,
  LineupRunState,
  LineupWriteIntentRef,
} from "./LineupRunWorkflow.ts";
import { resolveTarget } from "./LineupTarget.ts";
import type { OwnedTeam } from "./QueryRepository.ts";
import { QueryRepository } from "./QueryRepository.ts";

const retryDelayMillis = 30_000;

export const LineupWorkerLive = Layer.effect(
  LineupWorker,
  Effect.gen(function* () {
    const repository = yield* LineupRunRepositoryService;
    const queries = yield* QueryRepository;
    const encryption = yield* ConnectionCredentialEncryption;
    const registry = yield* ProviderRegistry;
    const scheduleGate = yield* ScheduleGate;

    const deliver = Effect.fn("LineupWorker.deliver")(function* (
      runIds: ReadonlyArray<LineupRunId>,
    ) {
      let failure: LineupPersistenceFailed | undefined;
      for (const runId of runIds) {
        const result = yield* Effect.result(processRun(runId));
        if (result._tag === "Failure") {
          failure = result.failure;
          yield* Effect.annotateCurrentSpan({
            "lineup.run": runId,
            "app.outcome": "failure",
            "error.type": result.failure._tag,
          });
          yield* Effect.logWarning("A lineup delivery could not be completed");
        }
      }
      if (failure !== undefined) {
        return yield* failure;
      }
    });

    const processRun = Effect.fn("LineupWorker.run")(function* (runId: LineupRunId) {
      const now = yield* DateTime.now;
      const claimed = yield* repository.claim(runId, now);
      if (Option.isNone(claimed)) {
        return;
      }
      const run = claimed.value;
      yield* Effect.annotateCurrentSpan({
        "lineup.run": runId,
        "lineup.request": run.record.requestId,
        "team.id": run.record.teamId,
        "connection.id": run.record.connectionId,
        "lineup.trigger": run.record.trigger,
        "lineup.attempt": run.attempt,
        "lineup.status": run.record.status,
        "lineup.resumed": run.resumeVerification,
      });
      if (run.resumeVerification) {
        yield* verifyResumed(run);
      } else {
        yield* execute(run);
      }
    });

    const execute = Effect.fnUntraced(function* (run: ClaimedLineupRun) {
      const context = yield* loadContext(run.record.userId, run.record.teamId);
      if (context === undefined) {
        return yield* block(
          run,
          "team_unavailable",
          "The selected team or its connection is not available for this run.",
        );
      }
      const provider = yield* providerOf(run, context);
      if (provider === undefined) {
        return;
      }
      const session = yield* decryptContext(run.record.userId, context);
      const now = yield* DateTime.now;
      if (run.record.trigger === "scheduled") {
        const decision = yield* scheduleGate.evaluate({
          team: context.team,
          provider,
          session,
          now,
        });
        yield* Effect.annotateCurrentSpan({
          "schedule.gate": decision.kind,
          ...(decision.kind === "run"
            ? { "schedule.gate.reason": decision.reason }
            : {
                "schedule.gate.next_game_at":
                  decision.nextGameAt === undefined
                    ? "unstated"
                    : DateTime.formatIso(decision.nextGameAt),
              }),
        });
        if (decision.kind === "skip") {
          return yield* skip(run, decision.summary);
        }
      }
      const league = yield* readLeague(run, provider, context, session);
      if (league === undefined) {
        return;
      }
      const resolution = resolveTarget(
        run.record.target,
        league,
        provider.capabilities.fantasyDay,
        now,
      );
      if (resolution.status === "blocked") {
        return yield* block(run, resolution.reason, resolution.detail);
      }
      const target = resolution.target;
      const roster = yield* readRoster(run, provider, context, session, target);
      if (roster === undefined) {
        return;
      }
      if (roster.players.length === 0) {
        return yield* block(run, "empty_roster", "The provider returned no roster members.");
      }
      const observation = observe(roster, target);
      yield* repository.recordObservation({
        runId: run.record.id,
        lease: run.lease,
        observation,
        at: now,
      });
      const prior = yield* repository.unresolvedWriteIntent(
        run.record.userId,
        run.record.teamId,
        run.record.id,
      );
      if (prior) {
        return yield* block(
          run,
          "unresolved_prior_write",
          "A previous write for this team is unresolved. Reconcile it before setting the lineup again.",
        );
      }
      const prepared =
        run.record.implementation === customLineupImplementation
          ? yield* prepareCustomPlan(run, provider, context, session, league, roster, observation)
          : preparedNative(context, observation);
      if (prepared.kind === "blocked") {
        return;
      }
      const plan = prepared.plan;
      yield* Effect.annotateCurrentSpan({
        "lineup.implementation": implementationOf(plan),
        "lineup.action": plan._tag,
      });
      yield* repository.recordPlan({
        runId: run.record.id,
        lease: run.lease,
        plan,
        at: now,
      });
      const started = yield* repository.beginApply({
        runId: run.record.id,
        lease: run.lease,
        plan,
        before: prepared.before,
        at: now,
      });
      switch (started.status) {
        case "stale":
          yield* Effect.annotateCurrentSpan({
            "app.outcome": "success",
            "lineup.outcome": "no_op",
          });
          return;
        case "blocked":
          return yield* block(run, started.reason, blockDetail(started.reason));
        case "started":
          break;
      }

      const intent = started.intent;
      switch (plan._tag) {
        case "native_action":
          return yield* applyNative(run, provider, context, session, intent);
        case "explicit_assignments":
          return plan.assignments.length === 0
            ? yield* settleNoOp(run, intent)
            : yield* applyExplicit(run, provider, context, session, intent);
      }
    });

    const prepareCustomPlan = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      provider: Provider,
      context: OwnedTeam,
      session: Redacted.Redacted<string>,
      league: ProviderLeagueSettings,
      roster: ProviderRoster,
      observation: LineupObservation,
    ) {
      const planned = yield* planWith(
        run,
        provider,
        context,
        session,
        league,
        roster,
        observation.target,
      );
      if (planned === undefined) {
        return { kind: "blocked" as const };
      }
      if (planned.kind === "refused") {
        if (planned.refusal === "transient") {
          yield* block(run, "assignment_refused", planned.detail, refusedRecordOf(planned));
          return { kind: "blocked" as const };
        }
        return preparedNative(context, observation, refusalProvenance(planned));
      }
      yield* Effect.annotateCurrentSpan("lineup.provenance", planned.provenance);

      const revalidated = yield* readRoster(run, provider, context, session, observation.target);
      if (revalidated === undefined) {
        return { kind: "blocked" as const };
      }
      const freshLeague = yield* readLeague(run, provider, context, session);
      if (freshLeague === undefined) {
        return { kind: "blocked" as const };
      }
      const freshResolution = resolveTarget(
        run.record.target,
        freshLeague,
        provider.capabilities.fantasyDay,
        yield* DateTime.now,
      );
      if (freshResolution.status === "blocked") {
        yield* block(
          run,
          freshResolution.reason,
          `${freshResolution.detail} No lineup change was made.`,
          plannedRecordOf(planned),
        );
        return { kind: "blocked" as const };
      }
      if (!sameTarget(freshResolution.target, observation.target)) {
        yield* block(
          run,
          "stale_period",
          "The provider's scoring period changed before the write, so no lineup change was made.",
          plannedRecordOf(planned),
        );
        return { kind: "blocked" as const };
      }
      if (!sameMembership(observation.players, revalidated)) {
        yield* block(
          run,
          "roster_membership_changed",
          "The roster membership changed before the write, so no lineup change was made. Refresh the team and run again.",
          plannedRecordOf(planned),
        );
        return { kind: "blocked" as const };
      }
      const freshObservation = observe(revalidated, freshResolution.target);
      const replanned = yield* planWith(
        run,
        provider,
        context,
        session,
        freshLeague,
        revalidated,
        freshResolution.target,
      );
      if (replanned === undefined) {
        return { kind: "blocked" as const };
      }
      if (replanned.kind === "refused") {
        if (replanned.refusal === "structural") {
          return preparedNative(context, freshObservation, refusalProvenance(replanned));
        }
        yield* block(
          run,
          "lineup_changed_before_write",
          `The fresh roster cannot be planned: ${replanned.detail}`,
          refusedRecordOf(replanned),
        );
        return { kind: "blocked" as const };
      }
      const placed = planAssignments({
        league: freshLeague,
        roster: revalidated,
        values: replanned.players,
        gamesPlayed: replanned.gamesPlayed,
      });
      if (placed.kind === "refused") {
        yield* block(run, "assignment_refused", placed.detail, plannedRecordOf(replanned));
        return { kind: "blocked" as const };
      }
      return {
        kind: "prepared" as const,
        plan: explicitPlan(
          context,
          freshObservation,
          placed.assignments,
          replanned.provenance,
          !sameLineup(observation.players, revalidated),
        ),
        before: freshObservation.players,
      };
    });

    const planWith = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      provider: Provider,
      context: OwnedTeam,
      session: Redacted.Redacted<string>,
      league: ProviderLeagueSettings,
      roster: ProviderRoster,
      target: LineupTargetPeriod,
    ) {
      const result = yield* Effect.result(
        provider.scoreRoster({
          provider: context.connection.provider,
          session,
          providerTeamKey: context.team.providerTeamKey,
          providerLeagueKey: context.team.providerLeagueKey,
          sport: context.team.sport,
          league,
          roster,
          target,
        }),
      );
      if (result._tag === "Failure") {
        yield* handleReadFailure(run, context, result.failure, "lineup scores");
        return undefined;
      }
      return result.success;
    });

    const applyNative = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      provider: Provider,
      context: OwnedTeam,
      session: Redacted.Redacted<string>,
      intent: LineupWriteIntentRecord,
    ) {
      return yield* applyWrite(
        run,
        provider,
        context,
        intent,
        provider.applyNativeAction({
          provider: context.connection.provider,
          session,
          providerTeamKey: context.team.providerTeamKey,
          target: providerTarget(intent.target),
        }),
        {
          invalid:
            "The native action request was invalid before it was sent. No lineup change was made. Refresh the team and run again.",
          notSent: "The native action was not sent. The run will retry after a short delay.",
          rejected: "The provider definitively rejected the native action.",
        },
      );
    });

    const applyExplicit = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      provider: Provider,
      context: OwnedTeam,
      session: Redacted.Redacted<string>,
      intent: LineupWriteIntentRecord,
    ) {
      const plan = intent.plan;
      if (plan === undefined || plan._tag !== "explicit_assignments") {
        return yield* block(
          run,
          "write_intent_missing",
          "The run expected a durable explicit assignment plan but none was found.",
        );
      }
      return yield* applyWrite(
        run,
        provider,
        context,
        intent,
        provider.applyExplicitAssignments({
          provider: context.connection.provider,
          session,
          providerTeamKey: context.team.providerTeamKey,
          target: providerTarget(intent.target),
          assignments: plan.assignments.map((assignment) => ({
            providerPlayerKey: assignment.playerKey,
            slot: assignment.slot,
          })),
        }),
        {
          invalid:
            "The explicit assignment request was invalid before it was sent. No lineup change was made. Refresh the team and run again.",
          notSent:
            "The explicit assignment request was not sent. The run will retry after a short delay.",
          rejected:
            "The provider rejected the explicit assignments and made no lineup change. Refresh the team and try again.",
        },
      );
    });

    const applyWrite = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      provider: Provider,
      context: OwnedTeam,
      intent: LineupWriteIntentRecord,
      write: Effect.Effect<ProviderWriteResult, ProviderSessionRejected | ProviderResponseInvalid>,
      wording: WriteWording,
    ) {
      const applied = yield* Effect.result(write);
      if (applied._tag === "Failure") {
        switch (applied.failure._tag) {
          case "provider.session_rejected":
            yield* rejectSession(run.record.userId, context);
            return yield* fail(
              run,
              intent,
              "provider_session_rejected",
              "The provider rejected the stored session; reconnect the connection.",
            );
          case "provider.response_invalid":
            return yield* fail(
              run,
              intent,
              "provider_invalid_response",
              wording.invalid,
              "rejected",
            );
        }
      }
      const result = applied.success;
      switch (result.status) {
        case "not_sent":
          return yield* retry(
            run,
            intent,
            result.reason === "session_incomplete"
              ? "provider_session_incomplete"
              : "provider_unavailable",
            wording.notSent,
            false,
          );
        case "rejected":
          return yield* fail(run, intent, "provider_rejected", wording.rejected, "rejected");
        case "accepted":
        case "unknown":
          yield* repository.recordApplyResponse({
            runId: run.record.id,
            lease: run.lease,
            intentId: intent.id,
            response: result.status,
            at: yield* DateTime.now,
          });
          return yield* verify(run, provider, intent, result.status);
      }
    });

    const settleNoOp = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      intent: LineupWriteIntentRecord,
    ) {
      const at = yield* DateTime.now;
      const provenance = planRecordOf(intent.plan);
      const changed = intent.plan?._tag === "explicit_assignments" && intent.plan.sourceChanged;
      yield* repository.recordVerified({
        runId: run.record.id,
        lease: run.lease,
        intentId: intent.id,
        outcome: {
          kind: "no_op",
          verified: true,
          reconciled: false,
          summary: changed
            ? "The roster changed before the write; the lineup already matched the recomputed plan, so no write was needed."
            : "The lineup already matched the explicit plan; no provider write was needed.",
          observedAt: at,
          changes: [],
          differences: [],
          ...provenance,
          lockedPlayers: intent.before.filter((player) => !player.editable).length,
          editablePlayers: intent.before.filter((player) => player.editable).length,
        },
        at,
      });
      yield* repository.markAttemptFinished(run.record.id, run.attempt, at, "completed");
      yield* Effect.annotateCurrentSpan({
        "app.outcome": "success",
        "lineup.outcome": "no_op",
      });
    });

    const verifyResumed = Effect.fnUntraced(function* (run: ClaimedLineupRun) {
      const state = run.record.state;
      if (state._tag !== "Applying" && state._tag !== "Verifying") {
        yield* Effect.annotateCurrentSpan({
          "app.outcome": "success",
          "lineup.outcome": "no_op",
        });
        return;
      }
      const intent = yield* repository.loadWriteIntent(state.writeIntent.id);
      if (intent === undefined) {
        return yield* block(
          run,
          "write_intent_missing",
          "The run expected a durable write intent but none was found.",
        );
      }
      const context = yield* loadContext(run.record.userId, run.record.teamId);
      if (context === undefined) {
        return yield* uncertain(
          run,
          intent.id,
          "readback_unavailable",
          "The provider response could not be verified because the team is no longer available.",
          planRecordOf(intent.plan),
        );
      }
      const provider = yield* providerOf(run, context);
      if (provider === undefined) {
        return;
      }
      return yield* verify(
        run,
        provider,
        intent,
        intent.status === "accepted" ? "accepted" : "unknown",
      );
    });

    const verify = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      provider: Provider,
      intent: LineupWriteIntentRecord,
      providerResponse: "accepted" | "unknown",
    ) {
      const now = yield* DateTime.now;
      const context = yield* loadContext(run.record.userId, run.record.teamId);
      if (context === undefined) {
        return yield* uncertain(
          run,
          intent.id,
          "readback_unavailable",
          "The provider response could not be verified because the team is no longer available.",
          planRecordOf(intent.plan),
        );
      }
      const session = yield* decryptContext(run.record.userId, context);
      const target = intent.target;
      const readback = yield* Effect.result(
        provider.readRoster({
          provider: context.connection.provider,
          session,
          providerTeamKey: context.team.providerTeamKey,
          period: rosterPeriod(target),
        }),
      );
      if (readback._tag === "Failure") {
        if (readback.failure._tag === "provider.session_rejected") {
          yield* rejectSession(run.record.userId, context);
        }
        return yield* uncertain(
          run,
          intent.id,
          "readback_unavailable",
          "The provider response could not be verified by reading the roster back.",
          planRecordOf(intent.plan),
        );
      }
      const roster = readback.success;
      if (!covers(roster, target)) {
        return yield* uncertain(
          run,
          intent.id,
          "readback_coverage_changed",
          "The provider returned a different roster period than the write target, so the outcome is unverified.",
          planRecordOf(intent.plan),
        );
      }
      const comparison = compare(intent.before, roster);
      if (comparison === undefined) {
        return yield* uncertain(
          run,
          intent.id,
          "readback_membership_changed",
          "The roster membership changed during the write, so the outcome is unverified.",
          planRecordOf(intent.plan),
        );
      }
      const plan = intent.plan;
      const provenance = planRecordOf(plan);
      const observedAt = yield* DateTime.now;
      if (plan !== undefined && plan._tag === "explicit_assignments") {
        const differences = assignmentDifferences(intent.before, plan.assignments, roster);
        if (providerResponse === "accepted") {
          if (differences.length > 0) {
            return yield* fail(
              run,
              intent,
              "provider_assignment_mismatch",
              `${String(differences.length)} explicit assignment(s) did not match the plan after the provider accepted the request. No further write was attempted. Refresh the team and review the lineup before running again.`,
              "verified_mismatch",
              {
                verified: true,
                changes: comparison.changes,
                differences,
                ...provenance,
                lockedPlayers: comparison.lockedPlayers,
                editablePlayers: comparison.editablePlayers,
              },
            );
          }
          yield* repository.recordVerified({
            runId: run.record.id,
            lease: run.lease,
            intentId: intent.id,
            outcome: {
              kind: comparison.changes.length > 0 ? "changed" : "no_op",
              verified: true,
              reconciled: false,
              summary:
                (plan.sourceChanged
                  ? "The roster changed before the write, so the plan was recomputed. "
                  : "") +
                (comparison.changes.length > 0
                  ? `Verified ${String(comparison.changes.length)} explicit lineup change(s).`
                  : "Verified that the explicit request left the lineup unchanged."),
              observedAt,
              changes: comparison.changes,
              differences: [],
              ...provenance,
              lockedPlayers: comparison.lockedPlayers,
              editablePlayers: comparison.editablePlayers,
            },
            at: now,
          });
          yield* repository.markAttemptFinished(run.record.id, run.attempt, now, "completed");
          yield* Effect.annotateCurrentSpan(verifiedOutcome(comparison.changes.length));
          return;
        }
        if (differences.length === 0) {
          yield* repository.recordVerified({
            runId: run.record.id,
            lease: run.lease,
            intentId: intent.id,
            outcome: {
              kind: comparison.changes.length > 0 ? "changed" : "no_op",
              verified: true,
              reconciled: true,
              summary:
                (plan.sourceChanged
                  ? "The roster changed before the write, so the plan was recomputed. "
                  : "") + "Reconciled a lost provider response with the planned explicit lineup.",
              observedAt,
              changes: comparison.changes,
              differences: [],
              ...provenance,
              lockedPlayers: comparison.lockedPlayers,
              editablePlayers: comparison.editablePlayers,
            },
            at: now,
          });
          yield* repository.markAttemptFinished(run.record.id, run.attempt, now, "completed");
          yield* Effect.annotateCurrentSpan(verifiedOutcome(comparison.changes.length));
          return;
        }
        if (comparison.changes.length === 0) {
          return yield* retry(
            run,
            intent,
            "provider_outcome_unknown",
            "The provider response was lost and the lineup is unchanged, so the same explicit assignments will be retried.",
            false,
          );
        }
        return yield* uncertain(
          run,
          intent.id,
          "provider_outcome_unknown",
          "The provider response was lost and the lineup changed away from the plan, so no further write was attempted. Review the lineup on the provider before running again.",
          {
            ...provenance,
            differences,
            changes: comparison.changes,
            lockedPlayers: comparison.lockedPlayers,
            editablePlayers: comparison.editablePlayers,
          },
        );
      }
      if (providerResponse === "accepted") {
        yield* repository.recordVerified({
          runId: run.record.id,
          lease: run.lease,
          intentId: intent.id,
          outcome: {
            kind: comparison.changes.length > 0 ? "changed" : "no_op",
            verified: true,
            reconciled: false,
            summary: nativeSummary(plan, comparison.changes.length),
            observedAt,
            changes: comparison.changes,
            ...provenance,
            lockedPlayers: comparison.lockedPlayers,
            editablePlayers: comparison.editablePlayers,
          },
          at: now,
        });
        yield* repository.markAttemptFinished(run.record.id, run.attempt, now, "completed");
        yield* Effect.annotateCurrentSpan(verifiedOutcome(comparison.changes.length));
        return;
      }
      if (comparison.changes.length === 0) {
        return yield* uncertain(
          run,
          intent.id,
          "provider_outcome_unknown",
          "The provider response was lost and the readback matches the pre-write roster, so the write outcome cannot be confirmed.",
          provenance,
        );
      }
      yield* repository.recordVerified({
        runId: run.record.id,
        lease: run.lease,
        intentId: intent.id,
        outcome: {
          kind: "changed",
          verified: true,
          reconciled: true,
          summary: "Reconciled a lost provider response with a verified native lineup change.",
          observedAt,
          changes: comparison.changes,
          ...provenance,
          lockedPlayers: comparison.lockedPlayers,
          editablePlayers: comparison.editablePlayers,
        },
        at: now,
      });
      yield* repository.markAttemptFinished(run.record.id, run.attempt, now, "completed");
      yield* Effect.annotateCurrentSpan(verifiedOutcome(comparison.changes.length));
    });

    const loadContext = Effect.fnUntraced(function* (userId: UserId, teamId: TeamId) {
      return yield* queries.loadOwnedTeam(userId, teamId).pipe(
        Effect.catchTags({
          "query.team_not_found": () => Effect.void,
          "query.connection_not_ready": () => Effect.void,
          "query.persistence_failed": (error) =>
            Effect.fail(LineupPersistenceFailed.make({ cause: error.cause })),
        }),
      );
    });

    const providerOf = Effect.fnUntraced(function* (run: ClaimedLineupRun, owned: OwnedTeam) {
      const provider = yield* Effect.result(registry.requireProvider(owned.connection.provider));
      if (provider._tag === "Failure") {
        yield* block(
          run,
          "provider_unavailable",
          "This team's provider is not configured for this deployment.",
        );
        return undefined;
      }
      return provider.success;
    });

    const decryptContext = Effect.fnUntraced(function* (userId: UserId, owned: OwnedTeam) {
      return yield* encryption
        .open({
          userId,
          connectionId: owned.connection.id,
          provider: owned.connection.provider,
          envelope: owned.connection.envelope,
        })
        .pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
    });

    const readLeague = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      provider: Provider,
      owned: OwnedTeam,
      session: Redacted.Redacted<string>,
    ) {
      const result = yield* Effect.result(
        provider.readLeague({
          provider: owned.connection.provider,
          session,
          providerLeagueKey: owned.team.providerLeagueKey,
          sport: owned.team.sport,
        }),
      );
      if (result._tag === "Success") {
        return result.success;
      }
      yield* handleReadFailure(run, owned, result.failure, "league");
      return undefined;
    });

    const readRoster = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      provider: Provider,
      owned: OwnedTeam,
      session: Redacted.Redacted<string>,
      target: LineupTargetPeriod,
    ) {
      const result = yield* Effect.result(
        provider.readRoster({
          provider: owned.connection.provider,
          session,
          providerTeamKey: owned.team.providerTeamKey,
          period: rosterPeriod(target),
        }),
      );
      if (result._tag === "Success") {
        if (!covers(result.success, target)) {
          yield* block(
            run,
            "period_unavailable",
            "The provider returned a roster for a different period than requested.",
          );
          return undefined;
        }
        return result.success;
      }
      yield* handleReadFailure(run, owned, result.failure, "roster");
      return undefined;
    });

    const handleReadFailure = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      owned: OwnedTeam,
      error: ProviderReadFailure,
      resource: string,
    ) {
      switch (error._tag) {
        case "provider.operation_unsupported":
          yield* fail(run, undefined, "provider_unsupported", error.reason);
          return;
        case "provider.period_mismatch":
          yield* block(
            run,
            "period_unavailable",
            `The provider returned ${describeCoverage(error.covered)} for the ${resource} instead of the requested ${describeCoverage(error.requested)}.`,
          );
          return;
        case "provider.period_unsupported":
          yield* fail(run, undefined, "provider_unsupported", `${error.reason} ${error.remedy}`);
          return;
        case "provider.session_rejected":
          yield* rejectSession(run.record.userId, owned);
          yield* fail(
            run,
            undefined,
            "provider_session_rejected",
            "The provider rejected the stored session; reconnect the connection.",
          );
          return;
        case "provider.request_failed":
          yield* retry(
            run,
            undefined,
            "provider_unavailable",
            `The provider could not be reached while reading the ${resource}.`,
            false,
          );
          return;
        case "provider.response_invalid":
          yield* fail(
            run,
            undefined,
            "provider_shape_changed",
            `The provider returned ${resource} that did not match the shape the adapter decodes (${error.operation}${error.field === undefined ? "" : ` at ${error.field}`}). Retrying cannot fix this; the adapter needs updating. No lineup change was made.`,
          );
          yield* Effect.annotateCurrentSpan({
            "lineup.shape_change": true,
            "lineup.shape_change.operation": error.operation,
            "lineup.shape_change.field": error.field ?? "unreported",
          });
          return;
      }
    });

    const rejectSession = Effect.fnUntraced(function* (userId: UserId, owned: OwnedTeam) {
      yield* queries.recordSessionRejected(userId, owned);
    });

    const skip = Effect.fnUntraced(function* (run: ClaimedLineupRun, summary: string) {
      const at = yield* DateTime.now;
      yield* repository.recordSkipped({
        runId: run.record.id,
        lease: run.lease,
        outcome: {
          kind: "skipped",
          verified: false,
          reconciled: false,
          summary,
          observedAt: at,
          changes: [],
          lockedPlayers: 0,
          editablePlayers: 0,
        },
        at,
      });
      yield* Effect.annotateCurrentSpan({
        "app.outcome": "success",
        "lineup.outcome": "skipped",
      });
    });

    const block = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      reason: string,
      detail: string,
      record: AttemptRecord = {},
    ) {
      const at = yield* DateTime.now;
      yield* repository.recordBlocked({
        runId: run.record.id,
        lease: run.lease,
        outcome: {
          kind: "blocked",
          verified: false,
          reconciled: false,
          summary: detail,
          observedAt: at,
          changes: [],
          ...record,
          lockedPlayers: 0,
          editablePlayers: 0,
        },
        at,
      });
      yield* Effect.annotateCurrentSpan({
        "app.outcome": "blocked",
        "lineup.outcome": "blocked",
        "lineup.blocked_reason": reason,
      });
    });

    const fail = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      intent: LineupWriteIntentRecord | undefined,
      reason: string,
      detail: string,
      intentStatus: "rejected" | "verified_mismatch" = "rejected",
      record: FailureRecord = {},
    ) {
      const at = yield* DateTime.now;
      const target = intent ?? writeIntentOf(run.record.state);
      const provenance = planRecordOf(intent?.plan);
      const implementation = record.implementation ?? provenance.implementation;
      const recordedProvenance = record.provenance ?? provenance.provenance;
      yield* repository.recordFailed({
        runId: run.record.id,
        lease: run.lease,
        outcome: {
          kind: "failed",
          verified: record.verified ?? false,
          reconciled: false,
          summary: detail,
          observedAt: at,
          changes: record.changes ?? [],
          ...(record.differences === undefined ? {} : { differences: record.differences }),
          ...(implementation === undefined ? {} : { implementation }),
          ...(recordedProvenance === undefined ? {} : { provenance: recordedProvenance }),
          lockedPlayers: record.lockedPlayers ?? 0,
          editablePlayers: record.editablePlayers ?? 0,
        },
        at,
        ...(target === undefined ? {} : { intent: { id: target.id, status: intentStatus } }),
      });
      yield* Effect.annotateCurrentSpan({
        "app.outcome": "failure",
        "lineup.outcome": "failed",
        "lineup.failure_reason": reason,
      });
    });

    const retry = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      intent: LineupWriteIntentRecord | undefined,
      reason: string,
      detail: string,
      resumeVerification: boolean,
    ) {
      const at = yield* DateTime.now;
      const retryAt = DateTime.addDuration(at, retryDelayMillis);
      yield* repository.recordRetry({
        runId: run.record.id,
        lease: run.lease,
        at,
        reason,
        detail,
        retryAt,
        ...(intent === undefined
          ? {}
          : {
              intent: {
                id: intent.id,
                status: "not_sent" as const,
                resumeVerification,
              },
            }),
      });
      yield* repository.markAttemptFinished(run.record.id, run.attempt, at, "retry-wait");
      yield* Effect.annotateCurrentSpan({
        "app.outcome": "retry",
        "lineup.outcome": "retry",
        "lineup.retry_reason": reason,
      });
    });

    const uncertain = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      intentId: string,
      reason: string,
      detail: string,
      record: FailureRecord = {},
    ) {
      const at = yield* DateTime.now;
      yield* repository.recordUncertain({
        runId: run.record.id,
        lease: run.lease,
        intentId,
        outcome: {
          kind: "uncertain",
          verified: false,
          reconciled: false,
          summary: detail,
          observedAt: at,
          changes: record.changes ?? [],
          ...(record.differences === undefined ? {} : { differences: record.differences }),
          ...(record.implementation === undefined ? {} : { implementation: record.implementation }),
          ...(record.provenance === undefined ? {} : { provenance: record.provenance }),
          lockedPlayers: record.lockedPlayers ?? 0,
          editablePlayers: record.editablePlayers ?? 0,
        },
        at,
      });
      yield* repository.markAttemptFinished(run.record.id, run.attempt, at, "uncertain");
      yield* Effect.annotateCurrentSpan({
        "app.outcome": "failure",
        "lineup.outcome": "uncertain",
        "lineup.uncertain_reason": reason,
      });
    });

    return LineupWorker.of({ deliver });
  }),
);

function verifiedOutcome(changeCount: number): {
  readonly "app.outcome": "success";
  readonly "lineup.outcome": "changed" | "no_op";
} {
  return {
    "app.outcome": "success",
    "lineup.outcome": changeCount > 0 ? "changed" : "no_op",
  };
}

function rosterPeriod(target: LineupTargetPeriod): ProviderRosterCoverage | undefined {
  switch (target.coverage) {
    case "current":
      return undefined;
    case "week":
      return { type: "week", week: target.week };
    case "date":
      return { type: "date", date: target.date };
  }
}

type PreparedPlan =
  | {
      readonly kind: "prepared";
      readonly plan: LineupPlan;
      readonly before: LineupObservation["players"];
    }
  | { readonly kind: "blocked" };

type AttemptRecord = {
  readonly implementation?: LineupImplementation;
  readonly provenance?: LineupPlanProvenance | LineupPlanRefusalProvenance;
  readonly differences?: ReadonlyArray<LineupRunDifference>;
};

type FailureRecord = AttemptRecord & {
  readonly verified?: boolean;
  readonly changes?: ReadonlyArray<{
    readonly name: string;
    readonly from: string;
    readonly to: string;
  }>;
  readonly lockedPlayers?: number;
  readonly editablePlayers?: number;
};

type WriteWording = {
  readonly invalid: string;
  readonly notSent: string;
  readonly rejected: string;
};

function describeCoverage(coverage: ProviderRosterCoverage | null): string {
  if (coverage === null) {
    return "no period";
  }
  return coverage.type === "week" ? `week ${String(coverage.week)}` : `date ${coverage.date}`;
}

function observe(roster: ProviderRoster, target: LineupTargetPeriod): LineupObservation {
  const players = roster.players.map((player) => ({
    key: player.providerPlayerKey,
    name: player.name,
    slot: player.slot,
    editable: player.isEditable === true,
    scheduled: player.scheduled,
    startingLineup: player.startingLineup,
  }));
  return {
    target,
    players,
    lockedPlayers: players.filter((player) => !player.editable).length,
    editablePlayers: players.filter((player) => player.editable).length,
  };
}

function compare(
  before: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly slot: ProviderRosterSlot;
    readonly editable: boolean;
    readonly scheduled: boolean;
  }>,
  roster: ProviderRoster,
):
  | {
      readonly changes: ReadonlyArray<{
        readonly name: string;
        readonly from: string;
        readonly to: string;
      }>;
      readonly lockedPlayers: number;
      readonly editablePlayers: number;
    }
  | undefined {
  const previous = new Map(before.map((player) => [player.key, player]));
  if (roster.players.length !== before.length) {
    return undefined;
  }
  const changes: Array<{ readonly name: string; readonly from: string; readonly to: string }> = [];
  for (const player of roster.players) {
    const old = previous.get(player.providerPlayerKey);
    if (old === undefined) {
      return undefined;
    }
    if (!sameSlot(old.slot, player.slot)) {
      changes.push({
        name: player.name,
        from: slotLabel(old.slot),
        to: slotLabel(player.slot),
      });
    }
  }
  return {
    changes,
    lockedPlayers: roster.players.filter((player) => player.isEditable !== true).length,
    editablePlayers: roster.players.filter((player) => player.isEditable === true).length,
  };
}

function covers(roster: ProviderRoster, target: LineupTargetPeriod): boolean {
  switch (target.coverage) {
    case "current":
      return false;
    case "week":
      return roster.coverage.type === "week" && roster.coverage.week === target.week;
    case "date":
      return roster.coverage.type === "date" && roster.coverage.date === target.date;
  }
}

function providerTarget(target: LineupTargetPeriod): ProviderNativeTarget {
  switch (target.coverage) {
    case "current":
      throw new Error("A provider write requires a resolved lineup period");
    case "week":
      return { type: "week", week: target.week };
    case "date":
      return { type: "date", date: target.date };
  }
}

function writeIntentOf(state: LineupRunState): LineupWriteIntentRef | undefined {
  return state._tag === "Applying" || state._tag === "Verifying" || state._tag === "Uncertain"
    ? state.writeIntent
    : undefined;
}

function preparedNative(
  context: OwnedTeam,
  observation: LineupObservation,
  provenance?: LineupPlanRefusalProvenance,
): PreparedPlan {
  return {
    kind: "prepared",
    plan: {
      _tag: "native_action",
      target: observation.target,
      connectionGeneration: context.connection.generation,
      lockedPlayers: observation.lockedPlayers,
      editablePlayers: observation.editablePlayers,
      ...(provenance === undefined ? {} : { provenance }),
    },
    before: observation.players,
  };
}

function explicitPlan(
  context: OwnedTeam,
  observation: LineupObservation,
  assignments: ReadonlyArray<ProviderLineupAssignment>,
  provenance: string,
  sourceChanged: boolean,
): LineupPlan {
  return {
    _tag: "explicit_assignments",
    target: observation.target,
    connectionGeneration: context.connection.generation,
    lockedPlayers: observation.lockedPlayers,
    editablePlayers: observation.editablePlayers,
    provenance: { kind: "planned", label: provenance },
    assignments: assignments.map((assignment) => ({
      playerKey: assignment.providerPlayerKey,
      slot: assignment.slot,
    })),
    sourceChanged,
  };
}

function refusalProvenance(
  outcome: Extract<ProviderScoreOutcome, { readonly kind: "refused" }>,
): LineupPlanRefusalProvenance {
  return { kind: "refused", label: outcome.provenance, detail: outcome.detail };
}

function plannedRecordOf(
  outcome: Extract<ProviderScoreOutcome, { readonly kind: "scored" }>,
): AttemptRecord {
  return {
    implementation: customLineupImplementation,
    provenance: { kind: "planned", label: outcome.provenance },
  };
}

function refusedRecordOf(
  outcome: Extract<ProviderScoreOutcome, { readonly kind: "refused" }>,
): AttemptRecord {
  return {
    implementation: customLineupImplementation,
    provenance: refusalProvenance(outcome),
  };
}

function planRecordOf(plan: LineupPlan | undefined): AttemptRecord {
  if (plan === undefined) {
    return {};
  }
  return plan._tag === "explicit_assignments"
    ? { implementation: customLineupImplementation, provenance: plan.provenance }
    : {
        implementation: nativeLineupImplementation,
        ...(plan.provenance === undefined ? {} : { provenance: plan.provenance }),
      };
}

function implementationOf(plan: LineupPlan): LineupImplementation {
  return plan._tag === "explicit_assignments"
    ? customLineupImplementation
    : nativeLineupImplementation;
}

function sameTarget(left: LineupTargetPeriod, right: LineupTargetPeriod): boolean {
  if (left.coverage === "week" && right.coverage === "week") {
    return left.week === right.week;
  }
  if (left.coverage === "date" && right.coverage === "date") {
    return left.date === right.date;
  }
  return left.coverage === right.coverage;
}

function sameMembership(observed: LineupObservation["players"], roster: ProviderRoster): boolean {
  const keys = new Set(observed.map((player) => player.key));
  return (
    roster.players.length === observed.length &&
    roster.players.every((player) => keys.has(player.providerPlayerKey))
  );
}

function sameLineup(observed: LineupObservation["players"], roster: ProviderRoster): boolean {
  if (!sameMembership(observed, roster)) {
    return false;
  }
  const slots = new Map(observed.map((player) => [player.key, player]));
  return roster.players.every((player) => {
    const previous = slots.get(player.providerPlayerKey);
    return (
      previous !== undefined &&
      sameSlot(previous.slot, player.slot) &&
      previous.editable === (player.isEditable === true)
    );
  });
}

function assignmentDifferences(
  before: LineupObservation["players"],
  assignments: ReadonlyArray<{ readonly playerKey: string; readonly slot: string }>,
  roster: ProviderRoster,
): ReadonlyArray<LineupRunDifference> {
  const expected = new Map<string, ProviderRosterSlot>(
    before.map((player) => [player.key, player.slot]),
  );
  for (const assignment of assignments) {
    expected.set(assignment.playerKey, { status: "verified", slot: assignment.slot });
  }
  return roster.players.flatMap((player) => {
    const expectedSlot = expected.get(player.providerPlayerKey);
    return expectedSlot === undefined || sameSlot(expectedSlot, player.slot)
      ? []
      : [
          {
            name: player.name,
            expected: slotLabel(expectedSlot),
            actual: slotLabel(player.slot),
          },
        ];
  });
}

function sameSlot(left: ProviderRosterSlot, right: ProviderRosterSlot): boolean {
  if (left.status === "verified" && right.status === "verified") {
    return left.slot === right.slot;
  }
  if (left.status === "unverified" && right.status === "unverified") {
    return left.rawValue === right.rawValue;
  }
  return false;
}

function slotLabel(slot: ProviderRosterSlot): string {
  return slot.status === "verified" ? slot.slot : `unverified (${JSON.stringify(slot.rawValue)})`;
}

function nativeSummary(plan: LineupPlan | undefined, changeCount: number): string {
  const verified =
    changeCount > 0
      ? `Verified ${String(changeCount)} native lineup change(s).`
      : "Verified that the native action left the lineup unchanged.";
  const refusal = plan?._tag === "native_action" ? plan.provenance : undefined;
  return refusal === undefined ? verified : `${refusal.detail} ${verified}`;
}

function blockDetail(
  reason: "unresolved_prior_write" | "connection_changed" | "controls_changed",
): string {
  switch (reason) {
    case "unresolved_prior_write":
      return "A previous write for this team is unresolved. Reconcile it before setting the lineup again.";
    case "connection_changed":
      return "The provider connection changed before the write started.";
    case "controls_changed":
      return "The team is no longer enabled or is paused for the current provider day.";
  }
}
