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
                Lineupkeep sets your fantasy lineup.
              </Heading>
              <Text size="lede" tone="muted">
                As long as your {defaultProviderName()} connection works, it checks each enabled
                team every hour and starts the players your league allows.
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
                  <Text weight="semibold">Scoring periods</Text>
                  <Text size="caption" tone="muted">
                    Your league decides whether a scoring period is a week or a day. Lineupkeep sets
                    the lineup for whichever period is current.
                  </Text>
                </Stack>
                <Stack gap="xs">
                  <Text weight="semibold">{defaultProviderName()}'s lineup rules</Text>
                  <Text size="caption" tone="muted">
                    Lineupkeep works inside your league's rules. It cannot add, drop, or trade a
                    player.
                  </Text>
                </Stack>
                <Stack gap="xs">
                  <Text weight="semibold">Agents use the same teams</Text>
                  <Text size="caption" tone="muted">
                    An MCP client you authorize can read your teams and turn the same lineup checks
                    on and off.
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
