import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { ExternalTextLink } from "#browser/shared-ui/ExternalTextLink.tsx";
import { ArrowUpRightIcon } from "#browser/shared-ui/icons.tsx";
import { providerDisplayName } from "#contracts/connections/providerLabels.ts";
import type { TeamView } from "#contracts/connections/teamContract.ts";

export function TeamProviderLink(props: TeamProviderLinkProps): JSX.Element {
  const provider = (): string => providerDisplayName(props.team.provider);
  const label = (): string => `Open ${props.team.name} in ${provider()}`;
  const visible = (): string => (props.showProvider ? "Open" : `Open in ${provider()}`);

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
          {visible()}
        </ExternalTextLink>
      )}
    </Show>
  );
}

type TeamProviderLinkProps = {
  readonly team: TeamView;
  readonly showProvider: boolean;
};
