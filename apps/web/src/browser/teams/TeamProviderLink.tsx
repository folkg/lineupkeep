import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { ExternalTextLink } from "#browser/shared-ui/ExternalTextLink.tsx";
import { ArrowUpRightIcon } from "#browser/shared-ui/icons.tsx";
import { providerDisplayName } from "#contracts/connections/providerLabels.ts";
import type { TeamView } from "#contracts/connections/teamContract.ts";

export function TeamProviderLink(props: { readonly team: TeamView }): JSX.Element {
  const label = (): string =>
    `Open ${props.team.name} in ${providerDisplayName(props.team.provider)}`;

  return (
    <Show when={props.team.providerUrl}>
      {(url) => (
        <ExternalTextLink
          href={url()}
          label={label()}
          tone="quiet"
          trailingIcon={<ArrowUpRightIcon size="sm" />}
          type="meta"
        >
          Open
        </ExternalTextLink>
      )}
    </Show>
  );
}
