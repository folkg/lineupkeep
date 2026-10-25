import { DateTime, Effect, Layer, Option } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import type { TeamId } from "#contexts/connections/FantasyTeam.ts";
import type { LineupRunOutcome } from "#contexts/connections/LineupRun.ts";
import { LineupPersistenceFailed } from "#contexts/connections/LineupRun.ts";
import { LineupWorker } from "#contexts/connections/LineupWork.ts";
import type {
  ProviderLeagueSettings,
  ProviderNativeTarget,
  ProviderReadFailure,
  ProviderRoster,
} from "#contexts/connections/Provider.ts";
import { ProviderGateway } from "#contexts/connections/Provider.ts";

import { ConnectionCredentialEncryption } from "./ConnectionCredentialEncryption.ts";
import type { ClaimedLineupRun, LineupWriteIntentRecord } from "./LineupRunRepository.ts";
import { LineupRunRepository as LineupRunRepositoryService } from "./LineupRunRepository.ts";
import type {
  LineupObservation,
  LineupRunState,
  LineupWriteIntentRef,
} from "./LineupRunWorkflow.ts";
import type { OwnedTeam } from "./QueryRepository.ts";
import { QueryRepository } from "./QueryRepository.ts";

const retryDelayMillis = 30_000;

export const LineupWorkerLive = Layer.effect(
  LineupWorker,
  Effect.gen(function* () {
    const repository = yield* LineupRunRepositoryService;
    const queries = yield* QueryRepository;
    const encryption = yield* ConnectionCredentialEncryption;
    const provider = yield* ProviderGateway;

    const deliver = Effect.fn("LineupWorker.deliver")(function* (
      runIds: ReadonlyArray<import("#contexts/connections/LineupRun.ts").LineupRunId>,
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

    const processRun = Effect.fnUntraced(function* (
      runId: import("#contexts/connections/LineupRun.ts").LineupRunId,
    ) {
      const now = yield* DateTime.now;
      const claimed = yield* repository.claim(runId, now);
      if (Option.isNone(claimed)) {
        return;
      }
      const run = claimed.value;
      yield* Effect.annotateCurrentSpan({
        "lineup.run": runId,
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
      if (context.team.availability !== "available") {
        return yield* block(
          run,
          "team_unavailable",
          "The provider no longer reports this team as available.",
        );
      }
      const session = yield* decryptContext(run.record.userId, context);
      const now = yield* DateTime.now;
      const league = yield* readLeague(run, context, session);
      if (league === undefined) {
        return;
      }
      const target = resolveTarget(run.record.target, league);
      if (target === undefined) {
        return yield* block(
          run,
          "stale_period",
          "The requested period is not the provider's current period for this league.",
        );
      }
      const roster = yield* readRoster(run, context, session, target);
      if (roster === undefined) {
        return;
      }
      if (roster.players.length === 0) {
        return yield* block(run, "empty_roster", "The provider returned no roster members.");
      }
      const observation = observe(roster, league, target);
      yield* repository.recordObservation({
        runId: run.record.id,
        lease: run.lease,
        observation,
        at: now,
      });
      const plan = {
        action: "start_active_players" as const,
        target: observation.target,
        connectionGeneration: context.connection.generation,
        lockedPlayers: observation.lockedPlayers,
        editablePlayers: observation.editablePlayers,
      };
      yield* repository.recordPlan({
        runId: run.record.id,
        lease: run.lease,
        plan,
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
      const started = yield* repository.beginApply({
        runId: run.record.id,
        lease: run.lease,
        plan,
        before: observation.players,
        at: now,
      });
      switch (started.status) {
        case "stale":
          return;
        case "blocked":
          return yield* block(run, started.reason, blockDetail(started.reason));
        case "started":
          break;
      }

      const intent = started.intent;
      const applied = yield* Effect.result(
        provider.applyNativeStartActive({
          provider: context.connection.provider,
          session,
          providerTeamKey: context.team.providerTeamKey,
          target: providerTarget(observation.target),
        }),
      );
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
            return yield* retry(
              run,
              intent,
              "provider_invalid_response",
              "The provider rejected the native action request before it was sent.",
              false,
            );
        }
      }
      const result = applied.success;
      switch (result.status) {
        case "not_sent":
          return yield* retry(
            run,
            intent,
            result.reason === "crumb_unavailable"
              ? "provider_crumb_unavailable"
              : "provider_unavailable",
            "The native action was not sent. The run will retry after a short delay.",
            false,
          );
        case "rejected":
          return yield* fail(
            run,
            intent,
            "provider_rejected",
            "The provider definitively rejected the native action.",
            "rejected",
          );
        case "accepted":
        case "unknown":
          yield* repository.recordApplyResponse({
            runId: run.record.id,
            lease: run.lease,
            intentId: intent.id,
            response: result.status,
            at: yield* DateTime.now,
          });
          return yield* verify(run, intent, result.status);
      }
    });

    const verifyResumed = Effect.fnUntraced(function* (run: ClaimedLineupRun) {
      const state = run.record.state;
      if (state._tag !== "Applying" && state._tag !== "Verifying") {
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
      return yield* verify(run, intent, "unknown");
    });

    const verify = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
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
        );
      }
      const session = yield* decryptContext(run.record.userId, context);
      const target = intent.target;
      const readback = yield* Effect.result(
        provider.readRoster({
          provider: context.connection.provider,
          session,
          providerTeamKey: context.team.providerTeamKey,
          period: target.coverage === "week" ? { week: target.week } : undefined,
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
        );
      }
      const roster = readback.success;
      if (!covers(roster, target)) {
        return yield* uncertain(
          run,
          intent.id,
          "readback_coverage_changed",
          "The provider returned a different roster period than the write target, so the outcome is unverified.",
        );
      }
      const comparison = compare(intent.before, roster);
      if (comparison === undefined) {
        return yield* uncertain(
          run,
          intent.id,
          "readback_membership_changed",
          "The roster membership changed during the write, so the outcome is unverified.",
        );
      }
      const observedAt = yield* DateTime.now;
      if (providerResponse === "accepted") {
        yield* repository.recordVerified({
          runId: run.record.id,
          lease: run.lease,
          intentId: intent.id,
          outcome: outcome({
            kind: comparison.changes.length > 0 ? "changed" : "no_op",
            verified: true,
            reconciled: false,
            summary:
              comparison.changes.length > 0
                ? `Verified ${String(comparison.changes.length)} native lineup change(s).`
                : "Verified that the native action left the lineup unchanged.",
            observedAt,
            changes: comparison.changes,
            lockedPlayers: comparison.lockedPlayers,
            editablePlayers: comparison.editablePlayers,
          }),
          at: now,
        });
        yield* repository.markAttemptFinished(run.record.id, run.attempt, now, "completed");
        return;
      }
      if (comparison.changes.length === 0) {
        return yield* uncertain(
          run,
          intent.id,
          "provider_outcome_unknown",
          "The provider response was lost and the readback matches the pre-write roster, so the write outcome cannot be confirmed.",
        );
      }
      yield* repository.recordVerified({
        runId: run.record.id,
        lease: run.lease,
        intentId: intent.id,
        outcome: outcome({
          kind: "changed",
          verified: true,
          reconciled: true,
          summary: "Reconciled a lost provider response with a verified native lineup change.",
          observedAt,
          changes: comparison.changes,
          lockedPlayers: comparison.lockedPlayers,
          editablePlayers: comparison.editablePlayers,
        }),
        at: now,
      });
      yield* repository.markAttemptFinished(run.record.id, run.attempt, now, "completed");
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

    const decryptContext = Effect.fnUntraced(function* (userId: UserId, owned: OwnedTeam) {
      return yield* encryption
        .decrypt({
          userId,
          connectionId: owned.connection.id,
          provider: owned.connection.provider,
          envelope: owned.connection.envelope,
        })
        .pipe(Effect.mapError((cause) => LineupPersistenceFailed.make({ cause })));
    });

    const readLeague = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      owned: OwnedTeam,
      session: import("effect").Redacted.Redacted<string>,
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
      owned: OwnedTeam,
      session: import("effect").Redacted.Redacted<string>,
      target: import("#contexts/connections/LineupRun.ts").LineupTargetPeriod,
    ) {
      const result = yield* Effect.result(
        provider.readRoster({
          provider: owned.connection.provider,
          session,
          providerTeamKey: owned.team.providerTeamKey,
          period: target.coverage === "week" ? { week: target.week } : undefined,
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
            `The provider returned an unexpected period for ${resource}.`,
          );
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
          yield* retry(
            run,
            undefined,
            "provider_invalid_response",
            `The provider returned data that could not be verified for the ${resource}.`,
            false,
          );
          return;
      }
    });

    const rejectSession = Effect.fnUntraced(function* (userId: UserId, owned: OwnedTeam) {
      yield* queries.recordSessionRejected(userId, owned);
    });

    const block = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      reason: string,
      detail: string,
    ) {
      const at = yield* DateTime.now;
      yield* repository.recordBlocked({
        runId: run.record.id,
        lease: run.lease,
        outcome: outcome({
          kind: "blocked",
          verified: false,
          reconciled: false,
          summary: detail,
          observedAt: at,
          changes: [],
          lockedPlayers: 0,
          editablePlayers: 0,
        }),
        at,
      });
      yield* Effect.annotateCurrentSpan({ "lineup.blocked_reason": reason });
    });

    const fail = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      intent: LineupWriteIntentRecord | undefined,
      reason: string,
      detail: string,
      intentStatus: "rejected" = "rejected",
    ) {
      const at = yield* DateTime.now;
      const target = intent ?? writeIntentOf(run.record.state);
      yield* repository.recordFailed({
        runId: run.record.id,
        lease: run.lease,
        outcome: outcome({
          kind: "failed",
          verified: false,
          reconciled: false,
          summary: detail,
          observedAt: at,
          changes: [],
          lockedPlayers: 0,
          editablePlayers: 0,
        }),
        at,
        ...(target === undefined ? {} : { intent: { id: target.id, status: intentStatus } }),
      });
      yield* Effect.annotateCurrentSpan({ "lineup.failure_reason": reason });
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
      yield* Effect.annotateCurrentSpan({ "lineup.retry_reason": reason });
    });

    const uncertain = Effect.fnUntraced(function* (
      run: ClaimedLineupRun,
      intentId: string,
      reason: string,
      detail: string,
    ) {
      const at = yield* DateTime.now;
      yield* repository.recordUncertain({
        runId: run.record.id,
        lease: run.lease,
        intentId,
        outcome: outcome({
          kind: "uncertain",
          verified: false,
          reconciled: false,
          summary: detail,
          observedAt: at,
          changes: [],
          lockedPlayers: 0,
          editablePlayers: 0,
        }),
        at,
      });
      yield* repository.markAttemptFinished(run.record.id, run.attempt, at, "uncertain");
      yield* Effect.annotateCurrentSpan({ "lineup.uncertain_reason": reason });
    });

    return LineupWorker.of({ deliver });
  }),
);

function resolveTarget(
  requested: import("#contexts/connections/LineupRun.ts").LineupTargetPeriod,
  league: ProviderLeagueSettings,
): import("#contexts/connections/LineupRun.ts").LineupTargetPeriod | undefined {
  if (requested.coverage === "date") {
    return league.startDate !== undefined &&
      league.endDate !== undefined &&
      requested.date >= league.startDate &&
      requested.date <= league.endDate
      ? requested
      : undefined;
  }
  return requested.week >= league.startWeek &&
    requested.week <= league.endWeek &&
    requested.week === league.currentWeek
    ? requested
    : undefined;
}

function observe(
  roster: ProviderRoster,
  league: ProviderLeagueSettings,
  target: import("#contexts/connections/LineupRun.ts").LineupTargetPeriod,
): LineupObservation {
  const players = roster.players.map((player) => ({
    key: player.providerPlayerKey,
    name: player.name,
    slot: player.slot,
    editable: player.isEditable === true,
  }));
  return {
    target,
    leagueCurrentWeek: league.currentWeek,
    leagueStartWeek: league.startWeek,
    leagueEndWeek: league.endWeek,
    starterSlots: league.rosterPositions
      .filter((position) => position.isStarting)
      .map((position) => position.position),
    players,
    lockedPlayers: players.filter((player) => !player.editable).length,
    editablePlayers: players.filter((player) => player.editable).length,
  };
}

function compare(
  before: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly slot: string;
    readonly editable: boolean;
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
    if (old.slot !== player.slot) {
      changes.push({ name: player.name, from: old.slot, to: player.slot });
    }
  }
  return {
    changes,
    lockedPlayers: roster.players.filter((player) => player.isEditable !== true).length,
    editablePlayers: roster.players.filter((player) => player.isEditable === true).length,
  };
}

function covers(
  roster: ProviderRoster,
  target: import("#contexts/connections/LineupRun.ts").LineupTargetPeriod,
): boolean {
  return target.coverage === "week"
    ? roster.coverage.type === "week" && roster.coverage.week === target.week
    : roster.coverage.type === "date" && roster.coverage.date === target.date;
}

function providerTarget(
  target: import("#contexts/connections/LineupRun.ts").LineupTargetPeriod,
): ProviderNativeTarget {
  return target.coverage === "week"
    ? { type: "week", week: target.week }
    : { type: "date", date: target.date };
}

function writeIntentOf(state: LineupRunState): LineupWriteIntentRef | undefined {
  return state._tag === "Applying" || state._tag === "Verifying" || state._tag === "Uncertain"
    ? state.writeIntent
    : undefined;
}

function outcome(input: {
  readonly kind: LineupRunOutcome["kind"];
  readonly verified: boolean;
  readonly reconciled: boolean;
  readonly summary: string;
  readonly observedAt: DateTime.Utc;
  readonly changes: ReadonlyArray<{
    readonly name: string;
    readonly from: string;
    readonly to: string;
  }>;
  readonly lockedPlayers: number;
  readonly editablePlayers: number;
}): LineupRunOutcome {
  return input;
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
