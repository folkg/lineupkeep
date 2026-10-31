import type {
  LineupRunData,
  TeamChangeView,
  TeamControlData,
  TeamNoteData,
  TeamNoteSaveResult,
  TeamRefreshView,
  TeamRosterView,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";
import {
  checkTeamServerFn,
  controlTeamServerFn,
  listTeamsServerFn,
  readLineupRunServerFn,
  readTeamRosterServerFn,
  refreshTeamsServerFn,
  saveTeamNoteServerFn,
} from "#server-functions/connections/teamServerFunctions.ts";

import {
  requireNoteSuccess,
  requireRosterSuccess,
  requireRunSuccess,
  requireTeamSuccess,
} from "./teamFailure";

export const teamRemote: TeamRemote = {
  list: (options) => listTeamsServerFn({ signal: options.signal }).then(requireTeamSuccess),
  refresh: () => refreshTeamsServerFn().then(requireTeamSuccess),
  check: (input) => checkTeamServerFn({ data: input }).then(requireTeamSuccess),
  control: (input) => controlTeamServerFn({ data: input }).then(requireTeamSuccess),
  readRun: (input) => readLineupRunServerFn({ data: input }).then(requireRunSuccess),
  saveNote: (input) => saveTeamNoteServerFn({ data: input }).then(requireNoteSuccess),
  readRoster: (input) => readTeamRosterServerFn({ data: input }).then(requireRosterSuccess),
};

export type TeamRemote = {
  readonly list: (options: TeamListRequestOptions) => Promise<ReadonlyArray<TeamSummaryView>>;
  readonly refresh: () => Promise<TeamRefreshView>;
  readonly check: (input: { readonly team: string }) => Promise<TeamRefreshView>;
  readonly control: (input: TeamControlData) => Promise<TeamChangeView>;
  readonly readRun: (input: { readonly run: string }) => Promise<LineupRunData>;
  readonly saveNote: (input: TeamNoteData) => Promise<TeamNoteSaveResult>;
  readonly readRoster: (input: { readonly team: string }) => Promise<TeamRosterView>;
};

type TeamListRequestOptions = {
  readonly signal: AbortSignal;
};
