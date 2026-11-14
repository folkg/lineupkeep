import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Badge } from "#browser/shared-ui/Badge.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { Dock, DockSpacer } from "#browser/shared-ui/Dock.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { formatCalendarDate } from "#browser/shared-ui/formatTime.ts";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextField } from "#browser/shared-ui/TextField.tsx";
import { leagueDisplayName, sportDisplayName } from "#contracts/connections/teamVocabulary.ts";
import type { TransactionProposalItemView } from "#contracts/connections/transactionContract.ts";

import { effectiveDateLine, nextRunDate, runTimeLine } from "./timeline";
import type { TimelineEarlierEntry, TimelineGroup } from "./timeline";
import {
  endedMoveCount,
  kindLabel,
  lifecycleLabel,
  moveCount,
  moveSummary,
} from "./transactionCopy";
import { TransactionReviewAuthenticationFailure } from "./transactionFailure";
import type { TransactionRemote } from "./transactionRemote";
import { useTransactionsPage } from "./useTransactionsPage";
import type { TransactionsPageController } from "./useTransactionsPage";

export function TransactionsPage(props: TransactionsPageProps): JSX.Element {
  const page = useTransactionsPage({ remote: () => props.remote });

  return (
    <AppShell>
      <Page
        lede="Every open move across your teams. Submit today's moves now, save the rest for a date, or discard them."
        title="Transactions"
      >
        <Show
          fallback={<LoadingState label="Loading moves">Loading your open moves…</LoadingState>}
          when={!page.isLoading()}
        >
          <Show
            fallback={
              <ActionFeedback
                feedback={{
                  type: "attention",
                  message:
                    page.failure() instanceof TransactionReviewAuthenticationFailure
                      ? "Your session ended before your moves could be read. Sign in again to continue."
                      : "We could not load your open moves. Try again.",
                  recovery:
                    page.failure() instanceof TransactionReviewAuthenticationFailure
                      ? page.signIn
                      : { label: "Try again", onAction: page.retry },
                }}
              />
            }
            when={page.failure() === null}
          >
            <DockSpacer active={showsPhoneDock(page)}>
              <Stack gap="xl">
                <ActionFeedback feedback={page.feedback()} />
                <TodaySection page={page} />
                <FutureSection page={page} />
                <EarlierSection page={page} />
              </Stack>
            </DockSpacer>
            <Show when={showsPhoneDock(page)}>
              <PhoneDock page={page} />
            </Show>
          </Show>
        </Show>
      </Page>
    </AppShell>
  );
}

function TodaySection(props: SectionProps): JSX.Element {
  const groups = (): ReadonlyArray<TimelineGroup> => props.page.today();
  const submittable = (): ReadonlyArray<TimelineGroup> => submittableGroups(groups());
  const several = (): boolean => groups().length > 1;
  return (
    <Stack as="section" gap="md" labelledBy="today-title">
      <SectionTitle
        id="today-title"
        focusable
        action={
          <Show when={several() && submittable().length > 0}>
            <Stack gap="none" hide="phone">
              <Button
                state={props.page.submitting() ? "working" : "idle"}
                aria-label="Submit all of today's moves"
                onClick={() => props.page.submitGroups(submittable())}
              >
                {props.page.submitting() ? "Submitting" : "Submit today"}
              </Button>
            </Stack>
          </Show>
        }
      >
        Today
      </SectionTitle>
      <Text size="caption" tone="muted">
        Submitting runs these moves now. Nothing here waits for a later date.
      </Text>
      <Show
        fallback={
          <EmptyState title="Nothing today">
            Moves that run now will appear here. Submit one now or save it for a later date.
          </EmptyState>
        }
        when={groups().length > 0}
      >
        <Stack gap="lg">
          <For each={groups()}>
            {(group) => (
              <TodayGroup
                group={group}
                page={props.page}
                showSubmit={!several() && !needsAttention(group)}
              />
            )}
          </For>
        </Stack>
      </Show>
    </Stack>
  );
}

function PhoneDock(props: SectionProps): JSX.Element {
  return (
    <Stack gap="none" hide="wide">
      <Dock id="today-dock">
        <Inline gap="sm" justify="between">
          <Text size="body" weight="semibold">
            {moveCount(props.page.todayCount())} today
          </Text>
          <Button
            state={props.page.submitting() ? "working" : "idle"}
            aria-label="Submit today"
            onClick={() => props.page.submitGroups(submittableGroups(props.page.today()))}
          >
            {props.page.submitting() ? "Submitting" : "Submit today"}
          </Button>
        </Inline>
      </Dock>
    </Stack>
  );
}

function TodayGroup(props: TodayGroupProps): JSX.Element {
  const titleId = (): string => `today-${props.group.key}`;
  const blocked = (): boolean => needsAttention(props.group);
  return (
    <Stack as="section" gap="sm" labelledBy={titleId()}>
      <GroupHeading group={props.group} id={titleId()} />
      <MoveRows items={props.group.items} />
      <Show when={blocked()}>
        <Text size="caption" tone="danger">
          This move needs another look before it can run. Discard it, or ask the agent for a current
          move.
        </Text>
      </Show>
      <Inline gap="sm" align="baseline" collapse>
        <Show when={props.showSubmit}>
          <Button
            state={props.page.submitting() ? "working" : "idle"}
            disabled={props.page.discarding() !== undefined}
            aria-label={`Submit now: ${groupLabel(props.group)}`}
            onClick={() => props.page.submitGroups([props.group])}
          >
            {props.page.submitting() ? "Submitting" : "Submit now"}
          </Button>
        </Show>
        <Button
          variant="quiet"
          tone="danger"
          disabled={props.page.submitting()}
          state={props.page.discarding() === props.group.key ? "working" : "idle"}
          aria-label={`Discard: ${groupLabel(props.group)}`}
          onClick={() => props.page.discardGroup(props.group)}
        >
          {props.page.discarding() === props.group.key ? "Discarding" : "Discard"}
        </Button>
        <Text size="caption" tone="muted">
          Discarding removes these moves without changing your team.
        </Text>
      </Inline>
    </Stack>
  );
}

function FutureSection(props: SectionProps): JSX.Element {
  return (
    <Stack as="section" gap="md" labelledBy="upcoming-title">
      <SectionTitle id="upcoming-title" focusable>
        Upcoming
      </SectionTitle>
      <Text size="caption" tone="muted">
        Saved, not submitted. Saving changes does not run a move.
      </Text>
      <Show
        fallback={
          <EmptyState title="Nothing scheduled">
            Moves you save for a date will appear here, one section per date.
          </EmptyState>
        }
        when={props.page.future().length > 0}
      >
        <Stack gap="xl">
          <For each={props.page.future()}>
            {(day) => (
              <Stack as="section" gap="md" labelledBy={`day-${day.date}`}>
                <SectionTitle id={`day-${day.date}`} level={3}>
                  {formatCalendarDate(day.date)}
                </SectionTitle>
                <For each={day.groups}>
                  {(group) => <FutureGroup group={group} page={props.page} />}
                </For>
              </Stack>
            )}
          </For>
          <Show when={props.page.hasMoreOpen()}>
            <Inline gap="sm">
              <Button
                variant="secondary"
                state={props.page.fetchingMoreOpen() ? "working" : "idle"}
                onClick={props.page.showMoreOpen}
              >
                {props.page.fetchingMoreOpen() ? "Loading more moves" : "Show more moves"}
              </Button>
            </Inline>
          </Show>
        </Stack>
      </Show>
    </Stack>
  );
}

function FutureGroup(props: FutureGroupProps): JSX.Element {
  const titleId = (): string => `future-${props.group.key}`;
  const editing = (): boolean => props.page.editing() === props.group.key;
  const minimum = (): string | undefined =>
    props.group.today === undefined ? undefined : nextRunDate(props.group.today);
  return (
    <Stack as="section" gap="sm" labelledBy={titleId()}>
      <GroupHeading group={props.group} id={titleId()} />
      <Show when={runTimeLine(props.group)}>
        {(line) => (
          <Text size="caption" tone="muted">
            {line()}
          </Text>
        )}
      </Show>
      <RuleList>
        <For each={props.group.items}>
          {(item) => (
            <RuleListItem layout="stack" dense>
              <Stack gap="2xs">
                <Inline gap="sm" align="baseline">
                  <Badge tone="accent">{kindLabel(item.kind)}</Badge>
                  <Text size="item" weight="semibold">
                    {moveSummary(item)}
                  </Text>
                </Inline>
                <Show when={effectiveDateLine(item, props.group.effectiveRule)}>
                  {(line) => (
                    <Text size="caption" tone="muted">
                      {line()}
                    </Text>
                  )}
                </Show>
                <StaleReasons item={item} />
              </Stack>
            </RuleListItem>
          )}
        </For>
      </RuleList>
      <Inline gap="sm" align="baseline" collapse>
        <Button
          variant="link"
          disabled={props.page.saving() || props.page.discarding() !== undefined}
          aria-label={`Edit: ${groupLabel(props.group)}`}
          onClick={() => props.page.startEdit(props.group)}
        >
          Edit
        </Button>
        <Button
          variant="quiet"
          tone="danger"
          disabled={props.page.saving() || props.page.submitting()}
          state={props.page.discarding() === props.group.key ? "working" : "idle"}
          aria-label={`Discard: ${groupLabel(props.group)}`}
          onClick={() => props.page.discardGroup(props.group)}
        >
          {props.page.discarding() === props.group.key ? "Discarding" : "Discard"}
        </Button>
        <Text size="caption" tone="muted">
          These controls stay until the run day starts.
        </Text>
      </Inline>
      <Show when={editing()}>
        <Form gap="sm" onSubmit={props.page.saveEdit}>
          <Stack gap="sm">
            <TextField
              label="Run date"
              type="date"
              min={minimum()}
              value={props.page.editingDate()}
              onInput={(event) => props.page.setEditingDate(event.currentTarget.value)}
            />
            <Text size="caption" tone="muted">
              {props.group.items.length === 1
                ? "Saving withdraws this saved move and proposes a replacement for the date you choose. It does not run it."
                : "Saving withdraws these saved moves and proposes replacements for the date you choose. It does not run them."}
            </Text>
            <Show when={props.page.editingError()}>
              {(error) => (
                <Text size="caption" tone="danger">
                  {error()}
                </Text>
              )}
            </Show>
            <Inline gap="sm" align="baseline">
              <Button
                type="submit"
                state={props.page.saving() ? "working" : "idle"}
                disabled={props.page.discarding() !== undefined}
              >
                {props.page.saving() ? "Saving" : "Save changes"}
              </Button>
              <Button variant="link" onClick={props.page.cancelEdit}>
                Cancel
              </Button>
            </Inline>
          </Stack>
        </Form>
      </Show>
    </Stack>
  );
}

function EarlierSection(props: SectionProps): JSX.Element {
  return (
    <Stack as="section" gap="md" labelledBy="earlier-title">
      <SectionTitle
        id="earlier-title"
        action={
          <Button
            aria-expanded={props.page.earlierEnabled() ? "true" : "false"}
            aria-label={props.page.earlierEnabled() ? "Hide earlier moves" : "Show earlier moves"}
            variant="link"
            onClick={props.page.toggleEarlier}
          >
            {props.page.earlierEnabled() ? "Hide" : "Show"}
          </Button>
        }
      >
        Earlier
      </SectionTitle>
      <Text size="caption" tone="muted">
        {endedMoveCount(props.page.endedCount())}
      </Text>
      <Show when={props.page.earlierEnabled()}>
        <Show
          fallback={
            <Show
              fallback={
                <LoadingState label="Loading earlier moves">Loading earlier moves…</LoadingState>
              }
              when={!props.page.earlierLoading()}
            >
              <ActionFeedback
                feedback={{
                  type: "attention",
                  message: "We could not load the ended moves. Try again.",
                  recovery: { label: "Try again", onAction: props.page.retryEarlier },
                }}
              />
            </Show>
          }
          when={!props.page.earlierFailure()}
        >
          <Show
            fallback={
              <EmptyState title="No ended moves">
                Moves that run, fail, or are discarded appear here.
              </EmptyState>
            }
            when={props.page.earlier().length > 0}
          >
            <RuleList>
              <For each={props.page.earlier()}>{(entry) => <EarlierRow entry={entry} />}</For>
            </RuleList>
            <Show when={props.page.hasMoreEarlier()}>
              <Inline gap="sm">
                <Button
                  variant="secondary"
                  state={props.page.fetchingMoreEarlier() ? "working" : "idle"}
                  onClick={props.page.showMoreEarlier}
                >
                  {props.page.fetchingMoreEarlier()
                    ? "Loading ended moves"
                    : "Show more ended moves"}
                </Button>
              </Inline>
            </Show>
          </Show>
        </Show>
      </Show>
    </Stack>
  );
}

function EarlierRow(props: EarlierRowProps): JSX.Element {
  const detail = (): string | undefined =>
    props.entry.item.execution?.detail ?? props.entry.item.outcomeDetail;
  return (
    <RuleListItem layout="stack" dense>
      <Stack gap="2xs">
        <Inline gap="sm" align="baseline">
          <Badge tone={props.entry.item.lifecycle === "failed" ? "neutral" : "accent"}>
            {lifecycleLabel(props.entry.item.lifecycle)}
          </Badge>
          <Text size="item" weight="semibold">
            {moveSummary(props.entry.item)}
          </Text>
        </Inline>
        <Text size="caption" tone="muted">
          {teamLine(props.entry)}
        </Text>
        <Show when={detail()}>
          {(line) => (
            <Text size="caption" tone="muted">
              {line()}
            </Text>
          )}
        </Show>
      </Stack>
    </RuleListItem>
  );
}

function MoveRows(props: {
  readonly items: ReadonlyArray<TransactionProposalItemView>;
}): JSX.Element {
  return (
    <RuleList>
      <For each={props.items}>
        {(item) => (
          <RuleListItem layout="stack" dense>
            <Stack gap="2xs">
              <Inline gap="sm" align="baseline">
                <Badge tone="accent">{kindLabel(item.kind)}</Badge>
                <Text size="item" weight="semibold">
                  {moveSummary(item)}
                </Text>
              </Inline>
              <StaleReasons item={item} />
            </Stack>
          </RuleListItem>
        )}
      </For>
    </RuleList>
  );
}

function StaleReasons(props: { readonly item: TransactionProposalItemView }): JSX.Element {
  return (
    <Show when={props.item.staleness.status !== "current"}>
      <Text size="caption" tone="danger">
        {props.item.staleness.reasons.map((reason) => reason.detail).join(" ")}
      </Text>
    </Show>
  );
}

function GroupHeading(props: GroupHeadingProps): JSX.Element {
  return (
    <Stack gap="2xs">
      <Heading id={props.id} level={3} size="item">
        {props.group.team.name}
      </Heading>
      <Text size="caption" tone="muted">
        {leagueDisplayName(props.group.team.league)} · {sportDisplayName(props.group.team.sport)}
      </Text>
    </Stack>
  );
}

function showsPhoneDock(page: TransactionsPageController): boolean {
  const today = page.today();
  return today.length > 1 && submittableGroups(today).length > 0;
}

function submittableGroups(groups: ReadonlyArray<TimelineGroup>): ReadonlyArray<TimelineGroup> {
  return groups.filter((group) => !needsAttention(group));
}

function needsAttention(group: TimelineGroup): boolean {
  return group.items.some((item) => item.staleness.status !== "current");
}

function groupLabel(group: TimelineGroup): string {
  const moves = group.items.map(moveSummary).join(", ");
  return `${moves} for ${group.team.name}`;
}

function teamLine(entry: TimelineEarlierEntry): string {
  return `${entry.team.name} · ${leagueDisplayName(entry.team.league)} · ${sportDisplayName(entry.team.sport)}`;
}

type TransactionsPageProps = {
  readonly remote: TransactionRemote;
};

type SectionProps = {
  readonly page: TransactionsPageController;
};

type TodayGroupProps = {
  readonly group: TimelineGroup;
  readonly page: TransactionsPageController;
  readonly showSubmit: boolean;
};

type FutureGroupProps = {
  readonly group: TimelineGroup;
  readonly page: TransactionsPageController;
};

type EarlierRowProps = {
  readonly entry: TimelineEarlierEntry;
};

type GroupHeadingProps = {
  readonly group: TimelineGroup;
  readonly id: string;
};
