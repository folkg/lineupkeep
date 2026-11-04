import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { IconLink } from "#browser/shared-ui/IconLink.tsx";
import { ArrowUpRightIcon } from "#browser/shared-ui/icons.tsx";
import { providerDisplayName } from "#contracts/connections/providerLabels.ts";
import type { TeamView } from "#contracts/connections/teamContract.ts";

export function TeamProviderLink(props: { readonly team: TeamView }): JSX.Element {
  const label = (): string =>
    `Open ${props.team.name} in ${providerDisplayName(props.team.provider)}`;

  return (
    <Show when={props.team.providerUrl}>
      {(url) => (
        <IconLink href={url()} label={label()}>
          <ArrowUpRightIcon size="md" />
        </IconLink>
      )}
    </Show>
  );
}
