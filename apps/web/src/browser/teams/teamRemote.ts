import type {
  LineupRunData,
  TeamChangeView,
  TeamControlData,
  TeamNoteData,
  TeamNoteSaveResult,
  TeamRefreshView,
  TeamRosterAttentionData,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";
import {
  controlTeamServerFn,
  listTeamsServerFn,
  readLineupRunServerFn,
  readTeamRosterAttentionServerFn,
  refreshTeamsServerFn,
  saveTeamNoteServerFn,
} from "#server-functions/connections/teamServerFunctions.ts";

import {
  requireAttentionSuccess,
  requireNoteSuccess,
  requireRunSuccess,
  requireTeamSuccess,
} from "./teamFailure";

export const teamRemote: TeamRemote = {
  list: (options) => listTeamsServerFn({ signal: options.signal }).then(requireTeamSuccess),
  refresh: () => refreshTeamsServerFn().then(requireTeamSuccess),
  control: (input) => controlTeamServerFn({ data: input }).then(requireTeamSuccess),
  readRun: (input) => readLineupRunServerFn({ data: input }).then(requireRunSuccess),
  readAttention: (input) =>
    readTeamRosterAttentionServerFn({ data: input }).then(requireAttentionSuccess),
  saveNote: (input) => saveTeamNoteServerFn({ data: input }).then(requireNoteSuccess),
};

export type TeamRemote = {
  readonly list: (options: TeamListRequestOptions) => Promise<ReadonlyArray<TeamSummaryView>>;
  readonly refresh: () => Promise<TeamRefreshView>;
  readonly control: (input: TeamControlData) => Promise<TeamChangeView>;
  readonly readRun: (input: { readonly run: string }) => Promise<LineupRunData>;
  readonly readAttention: (input: { readonly team: string }) => Promise<TeamRosterAttentionData>;
  readonly saveNote: (input: TeamNoteData) => Promise<TeamNoteSaveResult>;
};

type TeamListRequestOptions = {
  readonly signal: AbortSignal;
};
