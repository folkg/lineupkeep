import type { JSX } from "@solidjs/web";

import { Disclosure } from "#browser/shared-ui/Disclosure.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { defaultProviderName } from "#contracts/connections/providerLabels.ts";

export function GoogleSignInNote(): JSX.Element {
  const provider = defaultProviderName();

  return (
    <Disclosure summary="Signing in with Google?">
      <Stack gap="xs">
        <Text type="body-strong">{provider} refuses Gmail addresses in this browser.</Text>
        <Text type="meta" tone="muted">
          Choose "Forgot username", then "Use recovery phone number" (or the account's recovery
          email) and follow the code. If {provider} only resets the password, sign in with the phone
          number and that password.
        </Text>
      </Stack>
    </Disclosure>
  );
}
