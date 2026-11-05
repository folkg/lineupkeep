import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";

import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import type { ActionFeedbackState } from "#browser/shared-ui/ActionFeedback.tsx";
import { Badge } from "#browser/shared-ui/Badge.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { ConfirmDialog } from "#browser/shared-ui/ConfirmDialog.tsx";
import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import { IconButton } from "#browser/shared-ui/IconButton.tsx";
import { LoaderCircleIcon, XIcon } from "#browser/shared-ui/icons.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import type { SignInSessionView } from "#contracts/auth/authContract.ts";

export function SignInSessionList(props: SignInSessionListProps): JSX.Element {
  const otherSessions = (): ReadonlyArray<SignInSessionView> =>
    props.sessions().filter((session) => !session.current);

  return (
    <Stack as="section" gap="md" labelledBy="sign-in-sessions-title">
      <SectionTitle id="sign-in-sessions-title">Sign-in sessions</SectionTitle>
      <Show
        fallback={<LoadingState label="Loading sessions">Loading your sessions…</LoadingState>}
        when={!props.isLoading()}
      >
        <Show
          fallback={
            <ActionFeedback
              feedback={{
                type: "attention",
                message: "We could not load your sessions.",
                recovery: {
                  label: "Refresh",
                  pendingLabel: "Refreshing…",
                  onAction: props.onRefresh,
                },
              }}
            />
          }
          when={props.loadFailure() === null}
        >
          <Show
            fallback={
              <EmptyState title="No sessions listed.">
                Sign in again to see where this account is signed in.
              </EmptyState>
            }
            when={props.sessions().length > 0}
          >
            <RuleList>
              <For each={props.sessions()}>
                {(session) => (
                  <SessionRow
                    ending={props.endingId() === session.id}
                    session={session}
                    onEnd={() => props.onEnd(session)}
                  />
                )}
              </For>
            </RuleList>
          </Show>
          <Show when={otherSessions().length > 0}>
            <Inline gap="sm">
              <ConfirmDialog
                confirmLabel="End other sessions"
                description="Every other device is signed out on its next action and must sign in again."
                onConfirm={props.onEndOthers}
                title="End every other session?"
                trigger={(trigger) => (
                  <Button
                    {...trigger}
                    pending={props.endingOthers()}
                    pendingLabel="Ending other sessions…"
                    tone="danger"
                    variant="secondary"
                  >
                    End all other sessions
                  </Button>
                )}
              />
            </Inline>
          </Show>
        </Show>
      </Show>
      <Text size="caption" tone="faint">
        Sessions renew as they are used. Each time shown can lag by up to five minutes.
      </Text>
      <ActionFeedback feedback={props.feedback()} />
    </Stack>
  );
}

function SessionRow(props: SessionRowProps): JSX.Element {
  return (
    <RuleListItem>
      <Inline gap="sm" justify="between">
        <Inline gap="sm">
          <Text as="span" weight="semibold">
            {props.session.device}
          </Text>
          <Show when={props.session.current}>
            <Badge>This device</Badge>
          </Show>
        </Inline>
        <Show when={!props.session.current}>
          <IconButton
            busy={props.ending}
            busyLabel="Ending…"
            label={`End the ${props.session.device} session`}
            onClick={props.onEnd}
          >
            <Show fallback={<XIcon size="md" />} when={props.ending}>
              <LoaderCircleIcon size="md" spin />
            </Show>
          </IconButton>
        </Show>
      </Inline>
      <Text size="caption" tone="faint">
        Started{" "}
        <Time datetime={props.session.startedAt}>{formatReaderTime(props.session.startedAt)}</Time>{" "}
        · Last used{" "}
        <Time datetime={props.session.lastUsedAt}>
          {formatReaderTime(props.session.lastUsedAt)}
        </Time>
      </Text>
    </RuleListItem>
  );
}

type SignInSessionListProps = {
  readonly sessions: Accessor<ReadonlyArray<SignInSessionView>>;
  readonly isLoading: Accessor<boolean>;
  readonly loadFailure: Accessor<Error | null>;
  readonly feedback: Accessor<ActionFeedbackState | undefined>;
  readonly endingId: Accessor<string | undefined>;
  readonly endingOthers: Accessor<boolean>;
  readonly onEnd: (session: SignInSessionView) => void;
  readonly onEndOthers: () => void;
  readonly onRefresh: () => Promise<void>;
};

type SessionRowProps = {
  readonly session: SignInSessionView;
  readonly ending: boolean;
  readonly onEnd: () => void;
};
