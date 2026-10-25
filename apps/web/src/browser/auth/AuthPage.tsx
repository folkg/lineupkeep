import { productName } from "@lineupkeep/brand/product";
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
            cue="Development preview"
            title={
              <Heading level={1} size="statement">
                A clear place to begin.
              </Heading>
            }
          >
            <Text size="lede" tone="muted">
              This is the {productName} development shell. Fantasy features are not built yet.
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
