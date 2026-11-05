import type { JSX } from "@solidjs/web";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";

export function AccountErasedPage(): JSX.Element {
  return (
    <AppShell footer={false}>
      <Page
        lede="Lineupgrade no longer holds your account, connections, teams, runs, proposals, feedback, sign-in sessions, or agent grants. You are signed out."
        title="Your account is erased"
      >
        <Stack gap="md">
          <Text>
            The export you downloaded is now the only copy of that data. Keep it somewhere you can
            find it.
          </Text>
          <Text>You can create a new account with this address whenever you want.</Text>
          <TextLink to="/auth">Sign in with this address</TextLink>
        </Stack>
      </Page>
    </AppShell>
  );
}
