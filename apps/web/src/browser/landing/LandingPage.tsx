import type { JSX } from "@solidjs/web";
import { For } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { useSessionActions } from "#browser/app-shell/useSessionActions.ts";
import { ButtonLink } from "#browser/shared-ui/ButtonLink.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Spread } from "#browser/shared-ui/Spread.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";

const sections = [
  {
    id: "landing-lineup-title",
    title: "The lineup writes itself",
    body: "It reads your roster, sets the lineup your league's rules allow for the games ahead, and checks again every hour, so a player who goes cold or is ruled out does not stay in your lineup. When no legal slot fits a player, it leaves him where he is and says so rather than forcing a move.",
  },
  {
    id: "landing-agent-title",
    title: "Your agent can run your teams",
    body: "You can let a connected agent read your teams, set lineups, and propose players to add or drop, trades, and waiver claims. The agent does the reading, the comparisons, and the legwork, and you review and submit every transaction.",
  },
  {
    id: "landing-control-title",
    title: "You stay in control",
    body: "Lineupgrade only sets lineups you could have set yourself, and pausing a team stops its hourly checks until you turn them back on. Disconnecting ends a connection's access at any time.",
  },
] as const;

export function LandingPage(): JSX.Element {
  const session = useSessionActions();

  return (
    <AppShell footer={false}>
      <Spread
        variant="showcase"
        start={
          <Stack gap="xl">
            <Stack gap="lg">
              <Heading level={1} size="display">
                Lineupgrade sets your fantasy lineup.
              </Heading>
              <Text size="body" tone="muted">
                It keeps your lineup current, and your agent can help with the rest.
              </Text>
            </Stack>
            <Stack align="start" gap="sm">
              <ButtonLink to={session.isSignedIn() ? "/teams" : "/auth"} variant="primary">
                {session.isSignedIn() ? "Open your teams" : "Sign in to get started"}
              </ButtonLink>
            </Stack>
          </Stack>
        }
        end={
          <Stack gap="2xl">
            <For each={sections}>
              {(section) => (
                <Stack as="section" gap="md" labelledBy={section.id}>
                  <SectionTitle id={section.id}>{section.title}</SectionTitle>
                  <Text size="body" tone="muted">
                    {section.body}
                  </Text>
                </Stack>
              )}
            </For>
          </Stack>
        }
      />
    </AppShell>
  );
}
