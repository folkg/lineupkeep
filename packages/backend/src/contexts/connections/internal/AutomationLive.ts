import { DateTime, Effect, Layer } from "effect";

import type { UserId } from "#contexts/auth/User.ts";
import { Automation, AutomationFailed } from "#contexts/connections/Automation.ts";
import type { AutomationSummary } from "#contexts/connections/Automation.ts";
import { CredentialKeyCensus } from "#contexts/connections/CredentialKeyCensus.ts";
import type { FantasyTeam } from "#contexts/connections/FantasyTeam.ts";
import { LineupDispatcher } from "#contexts/connections/LineupWork.ts";
import { RetentionSweep } from "#contexts/connections/Retention.ts";
import { TransactionProposals } from "#contexts/connections/TransactionProposals.ts";

import { LineupRunRepository } from "./LineupRunRepository.ts";
import type { NewScheduledLineupRun } from "./LineupRunRepository.ts";
import { TeamRepository } from "./TeamRepository.ts";

export const AutomationLive = Layer.effect(
  Automation,
  Effect.gen(function* () {
    const teams = yield* TeamRepository;
    const runs = yield* LineupRunRepository;
    const dispatcher = yield* LineupDispatcher;
    const proposals = yield* TransactionProposals;
    const retention = yield* RetentionSweep;
    const credentialKeys = yield* CredentialKeyCensus;

    const run = Effect.fn("Automation.run")(function* (limit: number) {
      const now = yield* DateTime.now;
      const pausesExpired = yield* teams.expirePauses(limit, now);
      const eligible = yield* teams.eligible(limit);
      const busy = yield* runs.scheduledTeamIds(eligible.map((entry) => entry.team.id));
      const available = eligible.filter((entry) => !busy.has(entry.team.id));
      const grouped = groupByOwner(available);
      const scheduled = yield* runs.createScheduledRunsForOwners(
        grouped.map((entries, index) => ({
          userId: ownerOf(entries, index),
          at: now,
          runs: entries.map(({ team }): NewScheduledLineupRun => ({
            team: team.id,
            connectionId: team.connectionId,
          })),
        })),
      );
      const scheduledRuns = scheduled.reduce((total, result) => total + result.runs.length, 0);
      const repaired = yield* dispatcher.repair(limit);
      const due = yield* proposals.runDue(limit, now);
      const retained = yield* retention.run(limit, now);
      const credentialKeyReport = yield* credentialKeys.report;
      const summary: AutomationSummary = {
        pausesExpired: pausesExpired.length,
        eligibleTeams: eligible.length,
        scheduledRuns,
        delivered: repaired.delivered,
        pending: repaired.pending,
        dueMoves: due.due,
        dueIncluded: due.included,
        dueRefused: due.refused,
        dueInProgress: due.inProgress,
        retention: retained,
        credentialKeys: credentialKeyReport,
      };
      yield* Effect.annotateCurrentSpan({
        "automation.eligible_teams": summary.eligibleTeams,
        "automation.scheduled_runs": summary.scheduledRuns,
        "automation.pauses_expired": summary.pausesExpired,
        "automation.due_moves": summary.dueMoves,
        "automation.due_included": summary.dueIncluded,
        "automation.due_refused": summary.dueRefused,
        "automation.due_in_progress": summary.dueInProgress,
      });
      return summary;
    });

    return Automation.of({
      run: (limit) => run(limit).pipe(Effect.mapError((cause) => AutomationFailed.make({ cause }))),
    });
  }),
);

function groupByOwner(
  entries: ReadonlyArray<{ readonly team: FantasyTeam; readonly userId: UserId }>,
): ReadonlyArray<ReadonlyArray<{ readonly team: FantasyTeam; readonly userId: UserId }>> {
  const groups = new Map<UserId, Array<{ readonly team: FantasyTeam; readonly userId: UserId }>>();
  for (const entry of entries) {
    const group = groups.get(entry.userId) ?? [];
    group.push(entry);
    groups.set(entry.userId, group);
  }
  return [...groups.values()];
}

function ownerOf(
  entries: ReadonlyArray<{ readonly team: FantasyTeam; readonly userId: UserId }>,
  index: number,
): UserId {
  const first = entries[0];
  if (first === undefined) {
    throw new Error(`Automation owner group ${String(index)} is empty`);
  }
  return first.userId;
}
