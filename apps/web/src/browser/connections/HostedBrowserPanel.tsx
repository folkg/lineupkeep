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
    <Stack as="section" gap="sm" labelledBy="connect-yahoo-title">
      <Heading id="connect-yahoo-title" level={2} size="section">
        Connect Yahoo
      </Heading>
      <Text size="body" tone="muted">
        Sign in once in the secure browser below. Your password is relayed only to Yahoo inside the
        private browser and is never stored or logged by Lineupkeep. We keep only the session tokens
        Yahoo returns, encrypted.
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
              No install, no code to copy.
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
              Keystrokes go to the private browser and are not stored or logged.
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
