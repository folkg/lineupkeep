import type { LineupRunView } from "#contracts/connections/teamContract.ts";

export type RunActivityEntry =
  | { readonly type: "run"; readonly run: LineupRunView }
  | { readonly type: "quiet"; readonly runs: ReadonlyArray<LineupRunView> };

export function groupRuns(runs: ReadonlyArray<LineupRunView>): ReadonlyArray<RunActivityEntry> {
  const entries: Array<RunActivityEntry> = [];
  let quiet: Array<LineupRunView> = [];

  const flushQuiet = (): void => {
    if (quiet.length === 1) {
      const [run] = quiet;
      if (run !== undefined) {
        entries.push({ type: "run", run });
      }
    } else if (quiet.length > 1) {
      entries.push({ type: "quiet", runs: quiet });
    }
    quiet = [];
  };

  for (const run of runs) {
    if (madeNoChange(run)) {
      quiet.push(run);
      continue;
    }
    flushQuiet();
    entries.push({ type: "run", run });
  }
  flushQuiet();
  return entries;
}

function madeNoChange(run: LineupRunView): boolean {
  if (run.outcome === undefined || run.outcome.changes.length > 0) {
    return false;
  }
  switch (run.outcome.kind) {
    case "no_op":
    case "skipped":
    case "superseded":
      return true;
    case "changed":
    case "blocked":
    case "failed":
    case "uncertain":
      return false;
  }
}
