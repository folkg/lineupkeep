import type { JSX } from "@solidjs/web";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { IntroPanel } from "#browser/brand-ui/IntroPanel.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Spread } from "#browser/shared-ui/Spread.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";

import { SignInForm } from "./SignInForm";
import type { SignInMethodsQueryOptions } from "./signInQueries";
import type { SignInRemote } from "./signInRemote";

export function AuthPage(props: AuthPageProps): JSX.Element {
  return (
    <AppShell>
      <Spread
        variant="form"
        start={
          <IntroPanel
            cue="For football and hockey fantasy leagues."
            title={
              <Heading level={1} size="statement">
                Sign in to Lineupgrade.
              </Heading>
            }
          >
            <Text size="lede" tone="muted">
              We will email you a six-digit code. There is no password to remember.
            </Text>
          </IntroPanel>
        }
        end={
          <SignInForm
            remote={props.remote}
            methodsQuery={props.methodsQuery}
            returnTo={props.returnTo}
            googleErrorReturnTo={props.googleErrorReturnTo}
            googleError={props.googleError}
            onAuthenticated={props.onAuthenticated}
          />
        }
      />
    </AppShell>
  );
}

type AuthPageProps = {
  readonly remote: SignInRemote;
  readonly methodsQuery: Accessor<SignInMethodsQueryOptions>;
  readonly returnTo: string;
  readonly googleErrorReturnTo: string;
  readonly googleError: string | undefined;
  readonly onAuthenticated: () => Promise<void>;
};
