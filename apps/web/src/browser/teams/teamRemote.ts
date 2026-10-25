import type {
  LineupRunData,
  TeamChangeView,
  TeamEnabledData,
  TeamPauseData,
  TeamRefreshView,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";
import {
  listTeamsServerFn,
  pauseTeamServerFn,
  readLineupRunServerFn,
  refreshTeamsServerFn,
  setTeamEnabledServerFn,
} from "#server-functions/connections/teamServerFunctions.ts";

import { requireRunSuccess, requireTeamSuccess } from "./teamFailure";

export const teamRemote: TeamRemote = {
  list: (options) => listTeamsServerFn({ signal: options.signal }).then(requireTeamSuccess),
  refresh: () => refreshTeamsServerFn().then(requireTeamSuccess),
  setEnabled: (input) => setTeamEnabledServerFn({ data: input }).then(requireTeamSuccess),
  pause: (input) => pauseTeamServerFn({ data: input }).then(requireTeamSuccess),
  readRun: (input) => readLineupRunServerFn({ data: input }).then(requireRunSuccess),
};

export type TeamRemote = {
  readonly list: (options: TeamListRequestOptions) => Promise<ReadonlyArray<TeamSummaryView>>;
  readonly refresh: () => Promise<TeamRefreshView>;
  readonly setEnabled: (input: TeamEnabledData) => Promise<TeamChangeView>;
  readonly pause: (input: TeamPauseData) => Promise<TeamChangeView>;
  readonly readRun: (input: { readonly run: string }) => Promise<LineupRunData>;
};

type TeamListRequestOptions = {
  readonly signal: AbortSignal;
};
