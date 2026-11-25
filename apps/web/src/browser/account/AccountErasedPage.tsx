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
        lede="Lineupgrade erased your account and everything tied to it, and signed you out."
        title="Your account is erased"
      >
        <Stack gap="md">
          <Text>
            The download you took is now the only copy, so keep it somewhere you can find it. You
            can create a new account with this address whenever you want.
          </Text>
          <TextLink to="/auth">Sign in with this address</TextLink>
        </Stack>
      </Page>
    </AppShell>
  );
}
