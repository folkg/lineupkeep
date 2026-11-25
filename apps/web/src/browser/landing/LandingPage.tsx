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
    body: "It reads your roster, sets the lineup your league allows for the games ahead, and checks again every hour, so a player who is ruled out or out of form does not stay in your lineup. If no legal slot fits, it leaves the player in place and tells you why.",
  },
  {
    id: "landing-agent-title",
    title: "Your agent can run your teams",
    body: "A connected agent can read your teams, set lineups, and propose adds, drops, trades, and waiver claims. It does the reading and comparisons; you review and submit every transaction.",
  },
  {
    id: "landing-control-title",
    title: "You stay in control",
    body: "Lineupgrade only sets lineups you could have set yourself. Pausing a team stops its hourly checks, and disconnecting ends that connection's access at any time.",
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
              <Text as="span" type="label" tone="muted">
                Your lineup. Looked after.
              </Text>
              <Heading level={1} type="display">
                Lineupgrade sets your fantasy lineup.
              </Heading>
              <Text type="body" tone="muted">
                It keeps your lineup current; your agent can help with the rest.
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
                  <Text type="body" tone="muted">
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
