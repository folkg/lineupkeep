import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { useSessionActions } from "#browser/app-shell/useSessionActions.ts";
import { Box } from "#browser/shared-ui/Box.tsx";
import { ButtonLink } from "#browser/shared-ui/ButtonLink.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Spread } from "#browser/shared-ui/Spread.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { defaultProviderName } from "#contracts/connections/providerLabels.ts";

export function LandingPage(): JSX.Element {
  const session = useSessionActions();

  return (
    <AppShell>
      <Spread
        variant="showcase"
        start={
          <Stack gap="2xl">
            <Stack gap="lg">
              <Heading level={1} size="display">
                Your lineup. Looked after.
              </Heading>
              <Text size="lede" tone="muted">
                Lineupkeep connects to your {defaultProviderName()} fantasy leagues once, then
                checks each enabled team's current scoring period every hour and keeps its active
                lineup set while the team and connection are available.
              </Text>
            </Stack>
            <Stack align="start" gap="sm">
              <ButtonLink to={session.isSignedIn() ? "/teams" : "/auth"} variant="accent">
                {session.isSignedIn()
                  ? "Open your teams"
                  : `Sign in to connect ${defaultProviderName()}`}
              </ButtonLink>
              <Show when={!session.isSignedIn()}>
                <Text size="caption" tone="muted">
                  The first sign-in creates your account. Connect {defaultProviderName()} next.
                </Text>
              </Show>
            </Stack>
          </Stack>
        }
        end={
          <Box rule="top" space="lg">
            <Stack gap="lg">
              <Heading level={2} size="section">
                What Lineupkeep does
              </Heading>
              <Stack gap="md">
                <Stack gap="xs">
                  <Text weight="semibold">Connects once</Text>
                  <Text size="caption" tone="muted">
                    Sign in to {defaultProviderName()} in a temporary browser. Lineupkeep keeps the
                    encrypted session, not your password.
                  </Text>
                </Stack>
                <Stack gap="xs">
                  <Text weight="semibold">Checks every hour</Text>
                  <Text size="caption" tone="muted">
                    While a team is enabled, connected, and available, its league's current scoring
                    period is checked every hour and the active players {defaultProviderName()}{" "}
                    allows are started.
                  </Text>
                </Stack>
                <Stack gap="xs">
                  <Text weight="semibold">Available to agents</Text>
                  <Text size="caption" tone="muted">
                    An MCP client authorized for your account can read the same teams and use the
                    same lineup and automation controls.
                  </Text>
                </Stack>
              </Stack>
            </Stack>
          </Box>
        }
      />
    </AppShell>
  );
}
