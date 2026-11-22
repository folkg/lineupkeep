import { EffectArray } from "@lineupkeep/collections";
import { EffectOption } from "@lineupkeep/collections";
import { isServer } from "@solidjs/web";
import { useMutation, useQuery } from "@tanstack/solid-query";
import { createEffect, createOptimisticStore, createSignal, onSettled, untrack } from "solid-js";
import type { Accessor } from "solid-js";

import { readCachedTeamHeaders, storeCachedTeamHeaders } from "#browser/query/teamHeaderCache.ts";
import type { CachedTeamHeader } from "#browser/query/teamHeaderCache.ts";
import { useSignInRecovery } from "#browser/session/signInRecovery.ts";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import { actionState } from "#browser/shared-ui/actionState.ts";
import type { ActionState } from "#browser/shared-ui/actionState.ts";
import type {
  TeamCardView,
  TeamControlData,
  TeamSummaryView,
} from "#contracts/connections/teamContract.ts";
import { sportDisplayName } from "#contracts/connections/teamVocabulary.ts";

import { describeTeamFailure } from "./teamFailure";
import { storeRefreshedTeamList, teamMutations } from "./teamMutations";
import { pendingControlAction, pendingValues } from "./teamPending";
import { teamQueries } from "./teamQueries";
import type { TeamListQueryOptions } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";

export function useTeamsPage(props: TeamsPageOptions): TeamsPageController {
  const query = useQuery(() => props.teamsQuery());
  const viewerId = untrack(() => props.viewerId?.());
  const [cachedHeaders, setCachedHeaders] = createSignal<ReadonlyArray<CachedTeamHeader>>([]);
  onSettled(() => {
    setCachedHeaders(viewerId === undefined ? [] : readCachedTeamHeaders(viewerId));
  });
  const signIn = useSignInRecovery();
  const [feedback, setFeedback] = createSignal<ActionFeedbackState>();
  const [refreshFinished, setRefreshFinished] = createSignal(false);
  const [teamList, setTeamList] = createOptimisticStore<TeamData[]>(
    () => (query.isSuccess ? [...query.data] : []),
    [],
    { key: null },
  );
  const facts = useQuery(() => ({
    ...teamQueries.cards(props.remote()),
    enabled: !isServer && !query.isPending && teamList.length > 0,
  }));

  createEffect(
    () => (query.isSuccess ? query.data : undefined),
    (teams) => {
      if (viewerId === undefined || teams === undefined) {
        return;
      }
      storeCachedTeamHeaders(viewerId, EffectArray.map(teams, teamHeader));
    },
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
    teams: () => teamList,
    cardFacts: () => facts.data,
    cardFactsFailure: () => facts.isError,
    cardFactsLoading: () => isServer || facts.isFetching,
    cachedHeaders,
    isLoading: () => query.isPending,
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
  readonly cardFacts: Accessor<ReadonlyArray<TeamCardView> | undefined>;
  readonly cardFactsFailure: Accessor<boolean>;
  readonly cardFactsLoading: Accessor<boolean>;
  readonly cachedHeaders: Accessor<ReadonlyArray<CachedTeamHeader>>;
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
  readonly viewerId?: () => string | undefined;
  readonly remote: () => TeamRemote;
  readonly onRefresh: () => Promise<void>;
};

type TeamData = { -readonly [K in keyof TeamSummaryView]: TeamSummaryView[K] };

function teamHeader(team: TeamSummaryView): CachedTeamHeader {
  return {
    id: team.team.id,
    name: team.team.name,
    sportLabel: sportDisplayName(team.team.sport),
    ...(team.team.leagueName === undefined ? {} : { leagueName: team.team.leagueName }),
  };
}
