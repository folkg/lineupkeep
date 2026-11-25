import type { JSX } from "@solidjs/web";
import { Show } from "solid-js";
import type { Accessor, Element } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import type { ThemePreference } from "#browser/app-shell/theme.ts";
import { useSessionActions } from "#browser/app-shell/useSessionActions.ts";
import { useTheme } from "#browser/app-shell/useTheme.ts";
import { SignInSessionList } from "#browser/session/SignInSessionList.tsx";
import type { SignInSessionListQueryOptions } from "#browser/session/signInSessionsQueries.ts";
import type { SignInSessionsRemote } from "#browser/session/signInSessionsRemote.ts";
import { useSignInSessions } from "#browser/session/useSignInSessions.ts";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { DownloadLink } from "#browser/shared-ui/DownloadLink.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { SelectField } from "#browser/shared-ui/SelectField.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextField } from "#browser/shared-ui/TextField.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import { accountExportPath } from "#contracts/account/accountContract.ts";
import type { AccountExportStatusView } from "#contracts/account/accountContract.ts";

import type { AccountDataRemote } from "./accountRemote";
import { useAccountData } from "./useAccountData";

type LatestExport = NonNullable<AccountExportStatusView["latest"]>;

export function AccountPage(props: AccountPageProps): JSX.Element {
  return (
    <AppShell>
      <AccountContent {...props} />
    </AppShell>
  );
}

function AccountContent(props: AccountPageProps): JSX.Element {
  const theme = useTheme();
  const session = useSessionActions();
  const account = useAccountData({
    remote: () => props.remote,
    onErased: () => props.onErased(),
  });
  const sessions = useSignInSessions({
    query: () => props.sessionsQuery(),
    remote: () => props.sessionsRemote,
    onRefresh: () => props.onRefreshSessions(),
  });

  return (
    <Page lede="Manage your connections, sign-in sessions, and data." title="Account">
      <Stack gap="xl">
        <Stack as="section" gap="md" labelledBy="appearance-title">
          <SectionTitle id="appearance-title">Appearance</SectionTitle>
          <Stack gap="sm" measure="control">
            <SelectField
              description="System follows your device's light or dark setting."
              label="Theme"
              options={themeOptions}
              value={theme.preference()}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (isThemePreference(value)) {
                  theme.setPreference(value);
                }
              }}
            />
          </Stack>
        </Stack>
        {props.connections}
        <SignInSessionList
          departingId={sessions.departingId}
          endingId={sessions.endingId}
          endingOthers={sessions.endingOthers}
          feedback={sessions.feedback}
          isLoading={sessions.isLoading}
          loadFailure={sessions.loadFailure}
          sessions={sessions.sessions}
          signingOut={session.isSigningOut()}
          onEnd={sessions.endSession}
          onEndOthers={sessions.endOtherSessions}
          onRefresh={sessions.refresh}
          onSignOut={() => void session.signOut()}
        />
        <Stack as="section" gap="md" labelledBy="data-title">
          <SectionTitle id="data-title">Your data</SectionTitle>
          <Text>
            Download a copy of your account, connections, teams, lineup runs, transaction proposals,
            feedback, and sign-in records. Passwords, sign-in sessions, and agent tokens stay out,
            so the file cannot be used to sign in.
          </Text>
          <DownloadLink href={accountExportPath}>Download your data</DownloadLink>
          <Show when={account.exportStatus()}>
            {(status) => (
              <Show when={status().latest}>
                {(latest) => (
                  <ExportSummary freshForMinutes={status().freshForMinutes} latest={latest()} />
                )}
              </Show>
            )}
          </Show>
          <Text>
            Erasing deletes everything in that download, every sign-in session, and every agent
            grant. It happens immediately and cannot be undone.
          </Text>
          <Show
            fallback={
              <Text type="meta" tone="muted">
                Checking your download…
              </Text>
            }
            when={!account.statusLoading()}
          >
            <Show
              fallback={
                <ActionFeedback
                  feedback={{
                    type: "attention",
                    message:
                      account.statusFailure()?.message ?? "We could not check your download.",
                    recovery: {
                      label: "Check again",
                      onAction: account.refreshExportStatus,
                    },
                  }}
                />
              }
              when={account.statusFailure() === undefined}
            >
              <Show
                fallback={
                  <EraseWithoutExport
                    freshForMinutes={account.exportStatus()?.freshForMinutes ?? 60}
                    latest={account.exportStatus()?.latest}
                  />
                }
                when={account.exportStatus()?.usable === true}
              >
                <Text>Your download is ready. After erasing, it is the only copy.</Text>
                <Form gap="md" onSubmit={account.erase}>
                  <TextField
                    autocomplete="off"
                    error={account.confirmationError()}
                    label="Type erase my account to confirm"
                    spellcheck={false}
                    value={account.confirmation()}
                    onInput={(event) => account.setConfirmation(event.currentTarget.value)}
                  />
                  <Inline gap="sm">
                    <Button
                      state={account.erasing() ? "working" : "idle"}
                      tone="danger"
                      type="submit"
                      variant="primary"
                    >
                      Erase my account
                    </Button>
                  </Inline>
                </Form>
              </Show>
            </Show>
          </Show>
          <ActionFeedback feedback={account.feedback()} />
        </Stack>
      </Stack>
    </Page>
  );
}

function ExportSummary(props: {
  readonly latest: LatestExport;
  readonly freshForMinutes: number;
}): JSX.Element {
  return (
    <Text type="meta" tone="muted">
      Last download{" "}
      <Time datetime={props.latest.takenAt}>{formatReaderTime(props.latest.takenAt)}</Time> ·{" "}
      {recordCountLabel(props.latest.records)} · counts for {freshnessPhrase(props.freshForMinutes)}
      .
    </Text>
  );
}

function EraseWithoutExport(props: {
  readonly latest: LatestExport | undefined;
  readonly freshForMinutes: number;
}): JSX.Element {
  return (
    <Show
      fallback={
        <Text type="meta" tone="muted">
          Download a copy above before erasing; it must be from the last{" "}
          {freshnessWindow(props.freshForMinutes)}.
        </Text>
      }
      when={props.latest}
    >
      {(latest) => (
        <Text type="meta" tone="muted">
          Your last download was{" "}
          <Time datetime={latest().takenAt}>{formatReaderTime(latest().takenAt)}</Time>, and it is
          too old to use. Download a fresh copy above before erasing.
        </Text>
      )}
    </Show>
  );
}

function freshnessWindow(minutes: number): string {
  return minutes === 60 ? "hour" : `${minutes} minutes`;
}

function freshnessPhrase(minutes: number): string {
  return minutes === 60 ? "an hour" : `${minutes} minutes`;
}

function recordCountLabel(records: number): string {
  return records === 1 ? "1 record" : `${records} records`;
}

function isThemePreference(value: string): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

const themeOptions: ReadonlyArray<{ readonly value: ThemePreference; readonly label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

type AccountPageProps = {
  readonly remote: AccountDataRemote;
  readonly onErased: () => Promise<void>;
  readonly connections: Element;
  readonly sessionsQuery: Accessor<SignInSessionListQueryOptions>;
  readonly sessionsRemote: SignInSessionsRemote;
  readonly onRefreshSessions: () => Promise<void>;
};
