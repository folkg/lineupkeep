import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { useSessionActions } from "#browser/app-shell/useSessionActions.ts";
import { ButtonLink } from "#browser/shared-ui/ButtonLink.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Spread } from "#browser/shared-ui/Spread.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";

const capabilities = [
  {
    title: "Scoring periods",
    detail:
      "Your league decides whether a scoring period is a week or a day. Lineupkeep sets the lineup for whichever period is current.",
  },
  {
    title: "Your league's lineup rules",
    detail: "Lineupkeep works inside your league's rules. It cannot add, drop, or trade a player.",
  },
  {
    title: "Agents use the same teams",
    detail:
      "An MCP client you authorize can read your teams and turn the same lineup checks on and off.",
  },
] as const;

export function LandingPage(): JSX.Element {
  const session = useSessionActions();

  return (
    <AppShell>
      <Spread
        variant="showcase"
        start={
          <Stack gap="xl">
            <Stack gap="lg">
              <Heading level={1} size="display">
                Lineupkeep sets your fantasy lineup.
              </Heading>
              <Text size="body" tone="muted">
                Once your account is connected, it checks each enabled team every hour and starts
                the players your league allows.
              </Text>
            </Stack>
            <Stack align="start" gap="sm">
              <ButtonLink to={session.isSignedIn() ? "/teams" : "/auth"} variant="primary">
                {session.isSignedIn() ? "Open your teams" : "Sign in to get started"}
              </ButtonLink>
              <Show when={!session.isSignedIn()}>
                <Text size="caption" tone="faint">
                  The first sign-in creates your account. Connect your fantasy account next.
                </Text>
              </Show>
            </Stack>
          </Stack>
        }
        end={
          <Stack as="section" gap="md" labelledBy="landing-capabilities-title">
            <SectionTitle id="landing-capabilities-title">What Lineupkeep does</SectionTitle>
            <RuleList>
              <For each={capabilities}>
                {(capability) => (
                  <RuleListItem>
                    <Text weight="semibold">{capability.title}</Text>
                    <Text size="body" tone="muted">
                      {capability.detail}
                    </Text>
                  </RuleListItem>
                )}
              </For>
            </RuleList>
          </Stack>
        }
      />
    </AppShell>
  );
}
