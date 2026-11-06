import { useQuery } from "@tanstack/solid-query";
import type { Accessor } from "solid-js";

import type { TeamReserveSlotAttentionView } from "#contracts/connections/teamContract.ts";

import { teamQueries } from "./teamQueries";
import type { TeamRemote } from "./teamRemote";

export function useTeamAttention(props: TeamAttentionOptions): TeamAttentionController {
  const attention = useQuery(() => teamQueries.attention(props.remote(), props.team()));
  return {
    attention: () => attention.data.attention,
  };
}

export type TeamAttentionController = {
  readonly attention: Accessor<ReadonlyArray<TeamReserveSlotAttentionView>>;
};

type TeamAttentionOptions = {
  readonly team: () => string;
  readonly remote: () => TeamRemote;
};
