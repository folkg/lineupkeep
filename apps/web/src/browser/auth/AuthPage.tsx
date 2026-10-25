import type { JSX } from "@solidjs/web";
import { productName } from "@sourdough/brand/product";
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
            cue="Ready when you are"
            title={
              <Heading level={1} size="statement">
                A place for what comes next.
              </Heading>
            }
          >
            <Text size="lede" tone="muted">
              {productName} keeps capture quick and the workspace quiet. The structure underneath is
              ready for whatever this starter becomes next.
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
