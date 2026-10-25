import type { JSX } from "@solidjs/web";
import { productName } from "@sourdough/brand/product";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { PromptSheet } from "#browser/brand-ui/PromptSheet.tsx";
import { Box } from "#browser/shared-ui/Box.tsx";
import { ButtonLink } from "#browser/shared-ui/ButtonLink.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { ArrowUpRightIcon } from "#browser/shared-ui/icons.tsx";
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
                Catch the thought. Keep your place.
              </Heading>
              <Text size="lede" tone="muted">
                {productName} is a focused notes workspace built on a production-ready application
                starter. Sign in, write, revise, and keep moving.
              </Text>
            </Stack>
            <Inline collapse gap="sm">
              <ButtonLink to="/auth">
                Start writing
                <ArrowUpRightIcon size="md" />
              </ButtonLink>
              <ButtonLink to="/notes" variant="secondary">
                Open workspace
              </ButtonLink>
            </Inline>
            <Box rule="top" space="md">
              <Text size="caption" tone="faint">
                Auth, query-backed data, optimistic updates, and responsive UI are already in place.
              </Text>
            </Box>
          </Stack>
        }
        end={
          <PromptSheet
            footnote="Ready when you return"
            label="Example note"
            meta={["Example note", "Today"]}
            rail={["NOTES", "READY"]}
            stepsLabel="Note workflow"
            steps={["Capture", "Revise", "Return"]}
            tag="Example"
            title="Ship the smaller thing."
          >
            Find the useful edge, make it clear, and leave enough room for the next thought to
            arrive.
          </PromptSheet>
        }
      />
    </AppShell>
  );
}
