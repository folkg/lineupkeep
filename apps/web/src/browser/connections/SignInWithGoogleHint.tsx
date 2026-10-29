import type { JSX } from "@solidjs/web";

import { Disclosure } from "#browser/shared-ui/Disclosure.tsx";
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
