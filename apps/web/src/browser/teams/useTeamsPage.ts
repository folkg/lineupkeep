import { EffectArray } from "@lineupkeep/collections";
import { EffectOption } from "@lineupkeep/collections";
import { useMutation, useQuery } from "@tanstack/solid-query";
import { createOptimisticStore, createSignal, untrack } from "solid-js";
import type { Accessor } from "solid-js";

import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import { actionState } from "#browser/shared-ui/actionState.ts";
import type { ActionState } from "#browser/shared-ui/actionState.ts";
import type {
  TeamCardView,
  TeamControlData,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";

import { describeTeamFailure } from "./teamFailure";
import { storeRefreshedTeamList, teamMutations } from "./teamMutations";
import { pendingControlAction, pendingValues } from "./teamPending";
import { teamQueries } from "./teamQueries";
import type { TeamListQueryOptions } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";

export function useTeamsPage(props: TeamsPageOptions): TeamsPageController {
  const query = useQuery(() => ({ ...props.teamsQuery(), placeholderData: [] }));
  const selectedTeamId = untrack(() => props.teamId?.());
  const signIn = useSignInRecovery();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [refreshFinished, setRefreshFinished] = createSignal(false);
  const [teamList, setTeamList] = createOptimisticStore<TeamData[]>(
    () => (query.isSuccess ? [...query.data] : []),
    [],
    { key: null },
  );
  const [factsFailed, setFactsFailed] = createSignal(false);
  const [factsSettled, setFactsSettled] = createSignal(false);
  const facts = useQuery(() => {
    const remote = props.remote();
    return {
      ...teamQueries.cards({
        cards: async (options) => {
          try {
            const cards = await remote.cards(options);
            setFactsFailed(false);
            setFactsSettled(true);
            return cards;
          } catch {
            setFactsFailed(true);
            setFactsSettled(true);
            return [];
          }
        },
      }),
      enabled: props.includeCards !== false,
      placeholderData: [],
    };
  });

  const teams = (): ReadonlyArray<TeamSummaryView> => {
    const listed = teamList;
    return listed.length === 0
      ? EffectArray.map(facts.data, (candidate) => candidate.summary)
      : listed;
  };
  const card = (): TeamCardView | undefined =>
    selectedTeamId === undefined
      ? undefined
      : EffectOption.getOrUndefined(
          EffectArray.findFirst(
            facts.data,
            (candidate) => candidate.summary.team.id === selectedTeamId,
          ),
        );
  const team = (): TeamSummaryView | undefined =>
    selectedTeamId === undefined
      ? undefined
      : EffectOption.getOrUndefined(
          EffectArray.findFirst(teams(), (candidate) => candidate.team.id === selectedTeamId),
        );

  const refreshing = (): boolean =>
    EffectArray.some(teamList, (team) => team.pending?.action === "refresh");

  const reportRefreshFailure = (error: unknown): void => {
    const failure = describeTeamFailure(error);
    setFeedback({
      type: "attention",
      message: failure.message,
      ...(failure.kind === "authentication" ? { recovery: signIn } : {}),
    });
  };

  const refreshTeams = useMutation(() => ({
    ...teamMutations.refresh(props.remote()),
    onMutate: () => {
      setTeamList((current) => {
        for (const team of current) {
          team.pending ??= pendingValues(team, "refresh");
        }
      });
    },
    onSuccess: (view, variables, onMutateResult, context) => {
      storeRefreshedTeamList(view, variables, onMutateResult, context);
      setRefreshFinished(true);
    },
    onError: reportRefreshFailure,
  }));

  return {
    teams,
    card,
    team,
    cardFacts: () => facts.data,
    cardFactsFailure: () => factsFailed() || facts.isError,
    cardFactsLoading: () => !factsSettled() && !factsFailed(),
    isLoading: () => query.isFetching && query.data.length === 0,
    loadFailure: () => query.error,
    dataUpdatedAt: () => query.dataUpdatedAt,
    feedback,
    refreshState: (): ActionState => actionState(refreshing(), refreshFinished()),
    refresh: () => props.onRefresh(),
    refreshTeams: () => {
      if (EffectArray.some(teamList, (team) => team.pending !== undefined)) {
        return;
      }
      setRefreshFinished(false);
      setFeedback(undefined);
      void refreshTeams.mutate(undefined);
    },
    beginControl: (input) => {
      setTeamList((current) => {
        const target = EffectOption.getOrUndefined(
          EffectArray.findFirst(current, (team) => team.team.id === input.team),
        );
        if (target === undefined || target.pending !== undefined) {
          return;
        }
        target.pending = pendingValues(target, pendingControlAction(input.action));
      });
    },
  };
}

export type TeamsPageController = {
  readonly teams: Accessor<ReadonlyArray<TeamSummaryView>>;
  readonly card: Accessor<TeamCardView | undefined>;
  readonly team: Accessor<TeamSummaryView | undefined>;
  readonly cardFacts: Accessor<ReadonlyArray<TeamCardView> | undefined>;
  readonly cardFactsFailure: Accessor<boolean>;
  readonly cardFactsLoading: Accessor<boolean>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly dataUpdatedAt: Accessor<number>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly refreshState: Accessor<ActionState>;
  readonly refresh: () => Promise<void>;
  readonly refreshTeams: () => void;
  readonly beginControl: (input: TeamControlData) => void;
};

type TeamsPageOptions = {
  readonly teamsQuery: () => TeamListQueryOptions;
  readonly includeCards?: boolean;
  readonly teamId?: () => string | undefined;
  readonly remote: () => TeamRemote;
  readonly onRefresh: () => Promise<void>;
};

type TeamData = { -readonly [K in keyof TeamSummaryView]: TeamSummaryView[K] };
