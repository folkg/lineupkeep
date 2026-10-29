import type { JSX } from "@solidjs/web";

import { Disclosure } from "#browser/shared-ui/Disclosure.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { defaultProviderName } from "#contracts/connections/providerLabels.ts";

export function SignInWithGoogleHint(): JSX.Element {
  return (
    <Disclosure summary="Sign in with Google? Read this first.">
      <Text size="caption" tone="muted">
        {defaultProviderName()} does not accept a Gmail address here. Add a phone number to your{" "}
        {defaultProviderName()} account and use that number to sign in instead. Lineupkeep never
        stores your password.
      </Text>
    </Disclosure>
  );
}

export function SessionSignInWithGoogleHint(): JSX.Element {
  return (
    <Stack gap="xs">
      <Text size="caption" tone="muted">
        Signing in with Google? {defaultProviderName()} won't accept Gmail here.
      </Text>
      <Disclosure bordered={false} summary="Add a phone number to sign in">
        <Text size="caption" tone="muted">
          Add a phone number to your {defaultProviderName()} account, then sign in with that number
          instead.
        </Text>
      </Disclosure>
    </Stack>
  );
}
