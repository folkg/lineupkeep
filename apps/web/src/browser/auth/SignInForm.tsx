import type { JSX } from "@solidjs/web";
import { Errored, Loading, Match, Show, Switch, onSettled } from "solid-js";
import type { Accessor } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { ArrowUpRightIcon, GoogleGIcon } from "#browser/shared-ui/icons.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextField } from "#browser/shared-ui/TextField.tsx";

import type { SignInMethodsQueryOptions } from "./signInQueries";
import type { SignInRemote } from "./signInRemote";
import { useSignInForm } from "./useSignInForm";

export function SignInForm(props: SignInFormProps): JSX.Element {
  const form = useSignInForm(props);
  let emailInput: HTMLInputElement | undefined;
  let codeInput: HTMLInputElement | undefined;

  const focusCodeOnceSent = (request: Promise<void>) =>
    void request.then(() =>
      onSettled(() => {
        if (form.step() === "code") {
          codeInput?.focus();
        }
      }),
    );
  const useDifferentEmail = (): void => {
    form.useDifferentEmail();
    onSettled(() => emailInput?.focus());
  };

  return (
    <Switch>
      <Match when={form.step() === "email"}>
        <Stack gap="xl">
          <Stack gap="md">
            <Heading level={2} size="title">
              Sign in or start fresh.
            </Heading>
            <Text tone="muted">No password needed. The first sign-in creates your account.</Text>
          </Stack>
          <Stack gap="lg">
            <Errored fallback={() => undefined}>
              <Loading fallback={undefined}>
                <Show when={form.offersGoogle()}>
                  <Stack gap="lg">
                    <Button
                      variant="google"
                      disabled={form.isBusy()}
                      pending={form.isStartingGoogle()}
                      pendingLabel="Opening Google…"
                      onClick={form.continueWithGoogle}
                    >
                      <GoogleGIcon />
                      Continue with Google
                    </Button>
                    <Text size="caption" tone="faint">
                      Or get a code by email.
                    </Text>
                  </Stack>
                </Show>
              </Loading>
            </Errored>
            <Stack gap="none">
              <Form gap="lg" novalidate onSubmit={() => focusCodeOnceSent(form.sendCode())}>
                <TextField
                  ref={(element: HTMLInputElement) => {
                    emailInput = element;
                  }}
                  autocomplete="email"
                  disabled={form.isBusy()}
                  error={form.emailError()}
                  label="Email"
                  type="email"
                  value={form.email()}
                  onInput={(event) => form.changeEmail(event.currentTarget.value)}
                />
                <Button pending={form.isSendingCode()} pendingLabel="Sending code…" type="submit">
                  Email me a code
                  <ArrowUpRightIcon size="md" />
                </Button>
              </Form>
              <ActionFeedback feedback={form.emailFeedback()} />
            </Stack>
          </Stack>
        </Stack>
      </Match>
      <Match when={form.step() === "code"}>
        <Stack gap="xl">
          <Stack gap="md">
            <Heading level={2} size="title">
              Check your email.
            </Heading>
            <Text tone="muted">
              We sent a 6-digit code to {form.sentTo()}. It expires in 10 minutes.
            </Text>
          </Stack>
          <Stack gap="none">
            <Form gap="lg" novalidate onSubmit={form.signIn}>
              <TextField
                ref={(element: HTMLInputElement) => {
                  codeInput = element;
                }}
                autocomplete="one-time-code"
                disabled={form.isBusy()}
                error={form.codeError()}
                inputmode="numeric"
                label="Code"
                value={form.code()}
                weight="strong"
                onInput={(event) => {
                  event.currentTarget.value = form.changeCode(event.currentTarget.value);
                }}
              />
              <Button pending={form.isVerifying()} pendingLabel="Signing in…" type="submit">
                Sign in
                <ArrowUpRightIcon size="md" />
              </Button>
            </Form>
            <Stack align="start" gap="none">
              <ActionFeedback feedback={form.codeFeedback()} recoveryDisabled={form.isBusy()} />
              <Button
                variant="link"
                disabled={form.isBusy() || !form.canResend()}
                pending={form.isResendingCode()}
                pendingLabel="Sending a new code…"
                onClick={() => focusCodeOnceSent(form.resendCode())}
              >
                {form.resendLabel()}
              </Button>
              <Button variant="link" disabled={form.isBusy()} onClick={useDifferentEmail}>
                Use a different email
              </Button>
            </Stack>
          </Stack>
        </Stack>
      </Match>
    </Switch>
  );
}

type SignInFormProps = {
  readonly remote: SignInRemote;
  readonly methodsQuery: Accessor<SignInMethodsQueryOptions>;

  readonly returnTo: string;

  readonly googleErrorReturnTo: string;

  readonly googleError: string | undefined;
  readonly onAuthenticated: () => Promise<void>;
};
