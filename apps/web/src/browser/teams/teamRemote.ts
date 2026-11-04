import type {
  LineupRunData,
  TeamChangeView,
  TeamControlData,
  TeamNoteData,
  TeamNoteSaveResult,
  TeamRefreshView,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";
import {
  controlTeamServerFn,
  listTeamsServerFn,
  readLineupRunServerFn,
  refreshTeamsServerFn,
  saveTeamNoteServerFn,
} from "#server-functions/connections/teamServerFunctions.ts";

import { requireNoteSuccess, requireRunSuccess, requireTeamSuccess } from "./teamFailure";

export const teamRemote: TeamRemote = {
  list: (options) => listTeamsServerFn({ signal: options.signal }).then(requireTeamSuccess),
  refresh: () => refreshTeamsServerFn().then(requireTeamSuccess),
  control: (input) => controlTeamServerFn({ data: input }).then(requireTeamSuccess),
  readRun: (input) => readLineupRunServerFn({ data: input }).then(requireRunSuccess),
  saveNote: (input) => saveTeamNoteServerFn({ data: input }).then(requireNoteSuccess),
};

export type TeamRemote = {
  readonly list: (options: TeamListRequestOptions) => Promise<ReadonlyArray<TeamSummaryView>>;
  readonly refresh: () => Promise<TeamRefreshView>;
  readonly control: (input: TeamControlData) => Promise<TeamChangeView>;
  readonly readRun: (input: { readonly run: string }) => Promise<LineupRunData>;
  readonly saveNote: (input: TeamNoteData) => Promise<TeamNoteSaveResult>;
};

type TeamListRequestOptions = {
  readonly signal: AbortSignal;
};
