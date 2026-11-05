import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { BrowserFrame } from "#browser/shared-ui/BrowserFrame.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import { viewportSize } from "#contracts/connections/hostedBrowserProtocol.ts";
import { defaultProviderName } from "#contracts/connections/providerLabels.ts";

import { statusMessage } from "./useHostedLinking";
import type { HostedLinkingController } from "./useHostedLinking";

export function HostedBrowserPanel(props: HostedBrowserPanelProps): JSX.Element {
  const provider = defaultProviderName();

  return (
    <Stack gap="sm">
      <Show when={props.controller.session()}>
        {(session) => (
          <Stack gap="sm">
            <BrowserFrame
              frameUrl={props.controller.frameUrl()}
              notice={
                props.controller.status() === "identifier-refused" ? (
                  <Stack gap="xs">
                    <Text size="caption" weight="semibold">
                      {provider} refuses Gmail addresses in this browser.
                    </Text>
                    <Text size="caption" tone="muted">
                      If the account has a phone number, sign in with that number instead. If it
                      does not, add one in {provider}'s account settings. {provider} decides which
                      sign-in options it offers.
                    </Text>
                  </Stack>
                ) : undefined
              }
              ready={props.controller.ready()}
              statusLabel={statusMessage(props.controller.status())}
              viewport={viewportSize(props.controller.viewportProfile())}
              onCancel={props.controller.cancel}
              onKey={props.controller.sendKey}
              onPointer={props.controller.click}
              onScroll={props.controller.scroll}
              onText={props.controller.sendText}
            />
            <Show
              when={
                props.controller.status() !== "identifier-refused" &&
                props.controller.frameUrl() !== undefined
              }
            >
              <Text live="polite" role="status" size="caption" tone="muted">
                {props.controller.ready()
                  ? "Connected. Opening your teams…"
                  : statusMessage(props.controller.status())}
              </Text>
            </Show>
            <Show when={props.controller.frameUrl() !== undefined}>
              <Text size="caption" tone="muted">
                Tap the page and type. Keystrokes go to {provider}'s page through the private
                browser. Lineupgrade does not store or log them.
              </Text>
            </Show>
            <Text size="caption" tone="muted">
              This sign-in expires{" "}
              <Time datetime={session().session.expiresAt}>
                {formatReaderTime(session().session.expiresAt)}
              </Time>
              . Cancelling closes the private browser and discards its profile.
            </Text>
          </Stack>
        )}
      </Show>
      <Show
        when={
          props.controller.session() === undefined &&
          props.connected &&
          props.renderConnectAction !== false
        }
      >
        <Inline gap="sm">
          <Button variant="secondary" onClick={() => void props.controller.start()}>
            Connect another account
          </Button>
        </Inline>
      </Show>
      <Show when={props.controller.session() === undefined && !props.connected}>
        <Text size="body" tone="muted">
          Sign in as you normally would, in a browser that belongs to this sign-in only.
        </Text>
        <Inline gap="sm">
          <Button
            pending={props.controller.starting()}
            pendingLabel="Starting…"
            onClick={() => void props.controller.start()}
          >
            {props.controller.failure() === undefined ? `Connect ${provider}` : "Try again"}
          </Button>
        </Inline>
      </Show>
      <ActionFeedback feedback={props.controller.failure()} />
    </Stack>
  );
}

type HostedBrowserPanelProps = {
  readonly connected: boolean;
  readonly controller: HostedLinkingController;
  readonly renderConnectAction?: boolean;
};
