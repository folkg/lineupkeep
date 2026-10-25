import { productName } from "@lineupkeep/brand/product";
import type { JSX } from "@solidjs/web";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { Box } from "#browser/shared-ui/Box.tsx";
import { ButtonLink } from "#browser/shared-ui/ButtonLink.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Spread } from "#browser/shared-ui/Spread.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";

export function LandingPage(): JSX.Element {
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
                {productName} is taking shape: a considered approach to keeping your fantasy teams
                ready, with clear controls and decisions you can inspect.
              </Text>
            </Stack>
            <Inline gap="sm">
              <ButtonLink to="/auth" variant="accent">
                Open development shell
              </ButtonLink>
            </Inline>
          </Stack>
        }
        end={
          <Box rule="top" space="lg">
            <Stack gap="lg">
              <Heading level={2} size="section">
                An independent beginning.
              </Heading>
              <Text tone="muted">
                This is the brand and application foundation, not a live fantasy service. Provider
                linking, lineup automation, and the optimizer have not been built.
              </Text>
              <Text size="caption" tone="faint">
                The starter workspace remains available for development checks. No provider
                connection or lineup action is available here.
              </Text>
            </Stack>
          </Box>
        }
      />
    </AppShell>
  );
}
