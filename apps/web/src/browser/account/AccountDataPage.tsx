import type { JSX } from "@solidjs/web";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Box } from "#browser/shared-ui/Box.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { DownloadLink } from "#browser/shared-ui/DownloadLink.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextField } from "#browser/shared-ui/TextField.tsx";
import { accountExportPath } from "#contracts/account/accountContract.ts";

import type { AccountDataRemote } from "./accountRemote";
import { useAccountData } from "./useAccountData";

export function AccountDataPage(props: AccountDataPageProps): JSX.Element {
  const page = useAccountData({
    remote: () => props.remote,
    onErased: () => props.onErased(),
  });

  return (
    <AppShell>
      <Page
        lede="Download a copy of what Lineupkeep holds, or delete your account and everything tied to it."
        title="Your data"
      >
        <Stack gap="xl">
          <Stack as="section" gap="md" labelledBy="export-title">
            <Heading id="export-title" level={2} size="section">
              Export
            </Heading>
            <Text>
              The file includes your account, connections, teams, lineup runs, transaction
              proposals, feedback, and sign-in records. Provider sessions, passwords, and agent
              tokens are left out, because a copy should not let anyone sign in as you.
            </Text>
            <DownloadLink href={accountExportPath}>Export my data</DownloadLink>
          </Stack>
          <Box rule="top" space="xl">
            <Stack as="section" gap="md" labelledBy="erase-title">
              <Heading id="erase-title" level={2} size="section">
                Erase your account
              </Heading>
              <Text>
                This deletes everything listed above, plus every sign-in session and the grants
                agents hold. It happens as soon as you confirm, and it cannot be undone.
              </Text>
              <Form gap="md" onSubmit={page.erase}>
                <TextField
                  autocomplete="off"
                  error={page.confirmationError()}
                  label="Type erase my account to confirm"
                  spellcheck={false}
                  value={page.confirmation()}
                  onInput={(event) => page.setConfirmation(event.currentTarget.value)}
                />
                <Button
                  pending={page.erasing()}
                  pendingLabel="Erasing your account…"
                  tone="danger"
                  type="submit"
                  variant="primary"
                >
                  Erase my account
                </Button>
              </Form>
              <ActionFeedback feedback={page.feedback()} />
            </Stack>
          </Box>
        </Stack>
      </Page>
    </AppShell>
  );
}

type AccountDataPageProps = {
  readonly remote: AccountDataRemote;
  readonly onErased: () => Promise<void>;
};
