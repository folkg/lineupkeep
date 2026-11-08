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
import { Definition, DefinitionList } from "#browser/shared-ui/DefinitionList.tsx";
import { DownloadLink } from "#browser/shared-ui/DownloadLink.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { formatDateTime, formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Notice } from "#browser/shared-ui/Notice.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { SelectField } from "#browser/shared-ui/SelectField.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextField } from "#browser/shared-ui/TextField.tsx";
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
    <Page
      lede="Choose how Lineupgrade looks, manage connections and sign-in sessions, and export your data, sign out, or erase your account."
      title="Account"
    >
      <Stack gap="xl">
        <Stack as="section" gap="md" labelledBy="appearance-title">
          <SectionTitle id="appearance-title">Appearance</SectionTitle>
          <Stack gap="sm" measure="control">
            <SelectField
              description="System follows this device's light or dark setting."
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
          onEnd={sessions.endSession}
          onEndOthers={sessions.endOtherSessions}
          onRefresh={sessions.refresh}
        />
        <Stack as="section" gap="md" labelledBy="export-title">
          <SectionTitle id="export-title">Your data</SectionTitle>
          <Text>
            The file includes your account, connections, teams, lineup runs, transaction proposals,
            feedback, and sign-in records. Sign-in sessions, passwords, and agent tokens are left
            out, because a copy should not let anyone sign in as you.
          </Text>
          <DownloadLink href={accountExportPath}>Export my data</DownloadLink>
          <Show when={account.exportStatus()?.latest}>
            {(latest) => <ExportDetails latest={latest()} />}
          </Show>
          <Show when={account.exportStatus()}>
            {(status) => (
              <Text size="caption" tone="faint">
                An export counts for {freshnessWindow(status().freshForMinutes)} after you take it.
              </Text>
            )}
          </Show>
        </Stack>
        <Stack as="section" gap="md" labelledBy="sign-out-title">
          <SectionTitle id="sign-out-title">Sign out</SectionTitle>
          <Text>
            Signing out ends this browser session. Your account, connections, and data stay.
          </Text>
          <Inline gap="sm">
            <Button
              state={session.isSigningOut() ? "working" : "idle"}
              variant="secondary"
              onClick={() => void session.signOut()}
            >
              Sign out this device
            </Button>
          </Inline>
        </Stack>
        <Stack as="section" gap="md" labelledBy="erase-title">
          <SectionTitle id="erase-title">Erase your account</SectionTitle>
          <Text>
            This deletes everything listed above, plus every sign-in session and the grants agents
            hold. It happens as soon as you confirm, and it cannot be undone.
          </Text>
          <Show
            fallback={
              <Text size="caption" tone="faint">
                Checking your export…
              </Text>
            }
            when={!account.statusLoading()}
          >
            <Show
              fallback={
                <ActionFeedback
                  feedback={{
                    type: "attention",
                    message: account.statusFailure()?.message ?? "We could not check your export.",
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
                fallback={<EraseWithoutExport latest={account.exportStatus()?.latest} />}
                when={account.exportStatus()?.usable === true}
              >
                <Text>
                  Your export is ready. Keep that file: after the erasure it is the only copy.
                </Text>
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

function ExportDetails(props: { readonly latest: LatestExport }): JSX.Element {
  return (
    <Stack gap="2xs">
      <DefinitionList>
        <Definition term="Taken" value={formatDateTime(props.latest.takenAt)} />
        <Definition term="Contains" value={contentsLabel(props.latest)} />
      </DefinitionList>
      <Show when={props.latest.areas.length > 0}>
        <Text size="caption" tone="faint">
          {areasLabel(props.latest.areas)}
        </Text>
      </Show>
    </Stack>
  );
}

function EraseWithoutExport(props: { readonly latest: LatestExport | undefined }): JSX.Element {
  return (
    <Show
      fallback={
        <Notice tone="neutral" title="Take an export before erasing">
          <Text size="caption" tone="muted">
            Erasing needs an export you already hold. Download one first; after the delete there is
            nothing left to give you.
          </Text>
          <DownloadLink href={accountExportPath}>Download an export</DownloadLink>
        </Notice>
      }
      when={props.latest}
    >
      {(latest) => (
        <Notice tone="neutral" title="That export no longer counts">
          <Text size="caption" tone="muted">
            The export you took {formatReaderTime(latest().takenAt)} is past its window. Download a
            new one before erasing; after the delete there is nothing left to give you.
          </Text>
          <DownloadLink href={accountExportPath}>Download an export</DownloadLink>
        </Notice>
      )}
    </Show>
  );
}

function freshnessWindow(minutes: number): string {
  if (minutes === 60) {
    return "an hour";
  }
  return `${minutes} minutes`;
}

function contentsLabel(latest: LatestExport): string {
  const records = latest.records === 1 ? "1 record" : `${latest.records} records`;
  const areas = latest.areas.length === 1 ? "1 area" : `${latest.areas.length} areas`;
  return `${records} in ${areas}`;
}

function areasLabel(areas: LatestExport["areas"]): string {
  const labels = [...areas].sort((left, right) => right.records - left.records);
  const shown = labels.slice(0, 4).map((area) => area.label);
  const hidden = labels.length - shown.length;
  return hidden === 0 ? shown.join(", ") : `${shown.join(", ")}, and ${hidden} more`;
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
