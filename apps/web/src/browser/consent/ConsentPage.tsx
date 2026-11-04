import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";

import type { ConsentRequestQuery } from "./consentQueries";
import type { ConsentRemote } from "./consentRemote";
import { useConsent } from "./useConsent";

export function ConsentPage(props: {
  readonly query: string;
  readonly requestQuery: () => ConsentRequestQuery;
  readonly remote: ConsentRemote;
  readonly onConfirmed: (url: string) => void;
}): JSX.Element {
  const consent = useConsent(props);
  return (
    <AppShell>
      <Page title={consent.title()} lede={consent.lede()}>
        <Show
          when={consent.request()}
          fallback={
            <Text>
              Return to your client and start connecting again. This request is missing, invalid, or
              expired.
            </Text>
          }
        >
          {(request) => (
            <Stack gap="lg">
              <Text>Connecting to {request().client.host}</Text>
              <Show when={request().client.name}>
                {(name) => (
                  <Text tone="muted">Calls itself “{name()}”. Names are not verified.</Text>
                )}
              </Show>
              <Text size="caption" tone="faint">
                Client identifier
              </Text>
              <Text size="body" wrap="words">
                {request().client.id}
              </Text>
              <For each={request().scopes}>{(scope) => <Text>{scope.description}</Text>}</For>
              <Inline gap="sm">
                <Form
                  gap="md"
                  onSubmit={() => {
                    void consent.approve();
                  }}
                >
                  <Button
                    type="submit"
                    pending={consent.isApproving()}
                    pendingLabel="Allowing access…"
                    disabled={consent.isPending()}
                  >
                    Allow access
                  </Button>
                </Form>
                <Form
                  gap="md"
                  onSubmit={() => {
                    void consent.deny();
                  }}
                >
                  <Button
                    type="submit"
                    variant="secondary"
                    pending={consent.isDenying()}
                    pendingLabel="Denying access…"
                    disabled={consent.isPending()}
                  >
                    Deny access
                  </Button>
                </Form>
              </Inline>
              <ActionFeedback feedback={consent.feedback()} />
            </Stack>
          )}
        </Show>
      </Page>
    </AppShell>
  );
}
