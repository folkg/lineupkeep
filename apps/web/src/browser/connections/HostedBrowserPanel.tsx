import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { BrowserFrame } from "#browser/shared-ui/BrowserFrame.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";

import { statusMessage } from "./useHostedLinking";
import type { HostedLinkingController } from "./useHostedLinking";

export function HostedBrowserPanel(props: HostedBrowserPanelProps): JSX.Element {
  return (
    <Stack as="section" gap="sm" labelledBy="yahoo-signin-title">
      <Heading id="yahoo-signin-title" level={2} size="section">
        Yahoo sign-in
      </Heading>
      <Text size="body" tone="muted">
        Sign in through a temporary browser. Your password is entered on Yahoo's page; Lineupkeep
        keeps only the encrypted session.
      </Text>
      <Show
        fallback={
          <Inline gap="sm">
            <Button
              pending={props.controller.starting()}
              pendingLabel="Starting…"
              onClick={props.controller.start}
            >
              Connect Yahoo
            </Button>
            <Text size="caption" tone="muted">
              No helper to install.
            </Text>
          </Inline>
        }
        when={props.controller.session()}
      >
        {(session) => (
          <Stack gap="sm">
            <BrowserFrame
              frameUrl={props.controller.frameUrl()}
              ready={props.controller.ready()}
              statusLabel={statusMessage(props.controller.status())}
              onCancel={props.controller.cancel}
              onKey={props.controller.sendKey}
              onPointer={props.controller.click}
              onScroll={props.controller.scroll}
              onText={props.controller.sendText}
            />
            <Text size="caption" tone="muted">
              {props.controller.ready()
                ? "Connected. Opening your teams…"
                : statusMessage(props.controller.status())}
            </Text>
            <Text size="caption" tone="muted">
              Keystrokes are typed into Yahoo's page through the temporary browser and are never
              stored or logged.
            </Text>
            <Text size="caption" tone="muted">
              This sign-in expires at{" "}
              {new Date(session().session.expiresAt).toISOString().slice(11, 16)} UTC. Closing or
              cancelling destroys the temporary browser profile.
            </Text>
          </Stack>
        )}
      </Show>
      <ActionFeedback feedback={props.controller.failure()} />
    </Stack>
  );
}

type HostedBrowserPanelProps = {
  readonly controller: HostedLinkingController;
};
