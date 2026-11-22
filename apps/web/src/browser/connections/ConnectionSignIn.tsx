import type { JSX } from "@solidjs/web";
import { onSettled } from "solid-js";

import { Button } from "#browser/shared-ui/Button.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";

import type { ConnectionRemote } from "./connectionRemote";
import { GoogleSignInNote } from "./GoogleSignInNote";
import { HostedBrowserPanel } from "./HostedBrowserPanel";
import { useHostedLinking } from "./useHostedLinking";
import type { HostedLinkingController } from "./useHostedLinking";

export function ConnectionSignIn(props: ConnectionSignInProps): JSX.Element {
  const hosted = useHostedLinking({
    remote: () => props.remote,
    onRefresh: () => props.onRefresh(),
  });
  let started = false;

  const start = (): Promise<void> =>
    hosted.start({
      provider: props.provider,
      ...(props.connectionId === undefined ? {} : { connectionId: props.connectionId }),
    });

  onSettled(() => {
    if (started || typeof window === "undefined") {
      return;
    }
    started = true;
    void start();
  });

  const controller: HostedLinkingController = { ...hosted, start };

  return (
    <Stack gap="md">
      <GoogleSignInNote />
      <HostedBrowserPanel connected={false} controller={controller} />
      <Inline gap="sm">
        <Button variant="secondary" onClick={props.onBack}>
          Back to account
        </Button>
      </Inline>
    </Stack>
  );
}

type ConnectionSignInProps = {
  readonly connectionId?: string;
  readonly onBack: () => void;
  readonly onRefresh: () => Promise<void>;
  readonly provider: string;
  readonly remote: ConnectionRemote;
};
