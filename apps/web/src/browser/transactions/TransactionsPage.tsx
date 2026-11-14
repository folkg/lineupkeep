import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Badge } from "#browser/shared-ui/Badge.tsx";
import { Box } from "#browser/shared-ui/Box.tsx";
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
import type { TimelineDay, TimelineEarlierEntry, TimelineMove, TimelineTeamDay } from "./timeline";
import {
  endedMoveCount,
  kindLabel,
  lifecycleLabel,
  moveCount,
  moveSummary,
  openMoveCount,
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
        lede="Every open move across your teams. Choose each move that runs today, then submit once. Saved moves stay editable until their day."
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
                <OpenMoveSummary page={page} />
                <TodaySection page={page} />
                <Show when={!page.onlyToday()}>
                  <ScheduledSection page={page} />
                  <EarlierSection page={page} />
                </Show>
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

function OpenMoveSummary(props: SectionProps): JSX.Element {
  return (
    <Stack gap="sm">
      <Box rule="top" ruleTone="ink" space="md">
        <Stack gap="xs">
          <Text numeric size="item" weight="semibold">
            {openMoveCount(props.page.openCount())}
          </Text>
          <Text numeric size="caption" tone="muted">
            {`${String(props.page.todayCount())} today · ${String(props.page.scheduledCount())} scheduled`}
          </Text>
        </Stack>
      </Box>
      <Inline gap="sm" align="baseline">
        <Button
          variant={props.page.onlyToday() ? "secondary" : "quiet"}
          aria-pressed={props.page.onlyToday() ? "true" : "false"}
          onClick={props.page.toggleOnlyToday}
        >
          Only today
        </Button>
        <Show when={props.page.onlyToday()}>
          <Text size="caption" tone="muted">
            Showing today only. Press again to see every open move.
          </Text>
        </Show>
      </Inline>
    </Stack>
  );
}

function TodaySection(props: SectionProps): JSX.Element {
  const hasToday = (): boolean => props.page.todayCount() > 0;
  return (
    <Stack as="section" gap="md" labelledBy="today-title">
      <SectionTitle
        id="today-title"
        focusable
        action={
          <Show when={hasToday()}>
            <Stack gap="none" hide="phone">
              <Button
                state={props.page.submitting() ? "working" : "idle"}
                disabled={!props.page.canSubmitToday()}
                aria-describedby="today-choice-hint"
                aria-label="Submit today's chosen moves"
                onClick={props.page.submitToday}
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
        Choose Do it now or Discard for every move. Submitting applies every choice: it runs the
        moves you chose and discards the others.
      </Text>
      <Show
        fallback={
          <EmptyState title="Nothing today">
            Moves that run now will appear here. Saved moves wait for their day.
          </EmptyState>
        }
        when={hasToday()}
      >
        <ChoiceHint page={props.page} />
        <Stack gap="xl">
          <For each={props.page.today().teams}>
            {(card) => <TodayTeamCard card={card} page={props.page} />}
          </For>
        </Stack>
      </Show>
    </Stack>
  );
}

function ChoiceHint(props: SectionProps): JSX.Element {
  const remaining = (): number => props.page.undecidedTodayCount();
  return (
    <Show
      fallback={
        <Text size="caption" tone="muted">
          Every move today has a choice.
        </Text>
      }
      when={remaining() > 0}
    >
      <Text id="today-choice-hint" size="caption" tone="danger">
        {`${moveCount(remaining())} still ${remaining() === 1 ? "needs" : "need"} a choice. Choose Do it now or Discard for each move before you submit.`}
      </Text>
    </Show>
  );
}

function TodayTeamCard(props: TeamCardProps): JSX.Element {
  const titleId = (): string => `today-team-${props.card.key}`;
  return (
    <Box rule="top" ruleTone="ink" space="lg">
      <Stack as="section" gap="md" labelledBy={titleId()}>
        <TeamHeading card={props.card} id={titleId()} level={3} />
        <MoveList>
          <For each={props.card.moves}>
            {(move) => (
              <TodayMoveRow move={move} page={props.page} teamName={props.card.team.name} />
            )}
          </For>
        </MoveList>
      </Stack>
    </Box>
  );
}

function TodayMoveRow(props: TodayMoveRowProps): JSX.Element {
  const choice = (): TodayChoice | undefined => props.page.choiceFor(props.move.item.id);
  const stale = (): boolean => props.move.item.staleness.status !== "current";
  const status = (): string => {
    switch (choice()) {
      case "do_it_now":
        return "Runs when you submit.";
      case "discard":
        return "Discarded when you submit.";
      case undefined:
        return "Not chosen yet.";
    }
  };
  return (
    <RuleListItem layout="stack">
      <Inline gap="lg" align="start" justify="between" growFirst collapse>
        <MoveContent move={props.move} />
        <Stack gap="sm">
          <Text size="caption" tone={choice() === undefined ? "danger" : "muted"}>
            {status()}
          </Text>
          <Inline gap="sm" align="baseline" justify="end">
            <Button
              variant={choice() === "do_it_now" ? "secondary" : "quiet"}
              aria-pressed={choice() === "do_it_now" ? "true" : "false"}
              disabled={stale() || props.page.submitting()}
              aria-label={`Do it now: ${moveLabel(props.move, props.teamName)}`}
              onClick={() => props.page.chooseToday(props.move.item.id, "do_it_now")}
            >
              Do it now
            </Button>
            <Button
              variant={choice() === "discard" ? "secondary" : "quiet"}
              tone="danger"
              aria-pressed={choice() === "discard" ? "true" : "false"}
              disabled={props.page.submitting()}
              aria-label={`Discard: ${moveLabel(props.move, props.teamName)}`}
              onClick={() => props.page.chooseToday(props.move.item.id, "discard")}
            >
              Discard
            </Button>
          </Inline>
        </Stack>
      </Inline>
      <Show when={stale()}>
        <Text size="caption" tone="danger">
          This move needs another look before it can run. You can discard it here.
        </Text>
      </Show>
    </RuleListItem>
  );
}

function ScheduledSection(props: SectionProps): JSX.Element {
  return (
    <Stack as="section" gap="md" labelledBy="scheduled-title">
      <SectionTitle id="scheduled-title" focusable>
        Scheduled
      </SectionTitle>
      <Text size="caption" tone="muted">
        Saved moves wait for their day. You can change or discard any saved move until then.
      </Text>
      <Show
        fallback={
          <EmptyState title="Nothing scheduled">
            Moves you save for a later day will appear here, one day at a time.
          </EmptyState>
        }
        when={props.page.future().length > 0}
      >
        <Stack gap="2xl">
          <For each={props.page.future()}>
            {(day) => <ScheduledDay day={day} page={props.page} />}
          </For>
        </Stack>
      </Show>
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
  );
}

function ScheduledDay(props: ScheduledDayProps): JSX.Element {
  const titleId = (): string => `day-${props.day.key}`;
  return (
    <Stack as="section" gap="lg" labelledBy={titleId()}>
      <SectionTitle id={titleId()} level={3}>
        {props.day.date === undefined ? "Date not set" : formatCalendarDate(props.day.date)}
      </SectionTitle>
      <Stack gap="xl">
        <For each={props.day.teams}>
          {(card) => <FutureTeamCard card={card} page={props.page} />}
        </For>
      </Stack>
    </Stack>
  );
}

function FutureTeamCard(props: TeamCardProps): JSX.Element {
  const titleId = (): string => `future-team-${props.card.key}`;
  return (
    <Box rule="top" ruleTone="ink" space="lg">
      <Stack as="section" gap="md" labelledBy={titleId()}>
        <TeamHeading card={props.card} id={titleId()} level={4} />
        <MoveList>
          <For each={props.card.moves}>
            {(move) => <FutureMoveRow card={props.card} move={move} page={props.page} />}
          </For>
        </MoveList>
      </Stack>
    </Box>
  );
}

function FutureMoveRow(props: FutureMoveRowProps): JSX.Element {
  const minimum = (): string | undefined =>
    props.card.today === undefined ? undefined : nextRunDate(props.card.today);
  const savedFor = (): string =>
    props.card.runDate === undefined
      ? "Saved for a later day."
      : `Saved for ${formatCalendarDate(props.card.runDate)}.`;
  return (
    <RuleListItem layout="stack">
      <Inline gap="lg" align="start" justify="between" growFirst collapse>
        <MoveContent move={props.move} />
        <Stack gap="sm">
          <Text size="caption" tone="muted">
            {savedFor()} Editable until then.
          </Text>
          <Inline gap="sm" align="baseline" justify="end">
            <Button
              variant="link"
              disabled={props.page.saving() || props.page.submitting()}
              aria-label={`Change date: ${moveLabel(props.move, props.card.team.name)}`}
              onClick={() => props.page.startEdit(props.move, props.card.runDate)}
            >
              Change date
            </Button>
            <Button
              variant="quiet"
              tone="danger"
              disabled={props.page.saving() || props.page.submitting()}
              state={props.page.discarding() === props.move.item.id ? "working" : "idle"}
              aria-label={`Discard: ${moveLabel(props.move, props.card.team.name)}`}
              onClick={() => props.page.discardMove(props.move)}
            >
              {props.page.discarding() === props.move.item.id ? "Discarding" : "Discard"}
            </Button>
          </Inline>
        </Stack>
      </Inline>
      <Show when={props.page.editing() === props.move.item.id}>
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
              Saving withdraws this saved move and proposes a replacement for the date you choose.
              It does not run it.
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
    </RuleListItem>
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

function MoveContent(props: MoveContentProps): JSX.Element {
  return (
    <Stack gap="2xs">
      <Inline gap="sm" align="baseline">
        <Badge tone="accent">{kindLabel(props.move.item.kind)}</Badge>
        <Text size="item" weight="semibold">
          {moveSummary(props.move.item)}
        </Text>
      </Inline>
      <Show when={effectiveDateLine(props.move.item, props.move.effectiveRule)}>
        {(line) => (
          <Text size="caption" tone="muted">
            {line()}
          </Text>
        )}
      </Show>
      <StaleReasons item={props.move.item} />
    </Stack>
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

function MoveList(props: { readonly children: JSX.Element }): JSX.Element {
  return (
    <Box rule="top" space="none">
      <RuleList>{props.children}</RuleList>
    </Box>
  );
}

function TeamHeading(props: TeamHeadingProps): JSX.Element {
  return (
    <Stack gap="2xs">
      <Inline gap="sm" align="baseline" justify="between">
        <Heading id={props.id} level={props.level} size="item">
          {props.card.team.name}
        </Heading>
        <Text numeric size="caption" tone="faint">
          {moveCount(props.card.moves.length)}
        </Text>
      </Inline>
      <Text size="caption" tone="muted">
        {leagueDisplayName(props.card.team.league)} · {sportDisplayName(props.card.team.sport)}
      </Text>
      <Show when={runTimeLine(props.card)}>
        {(line) => (
          <Text size="caption" tone="muted">
            {line()}
          </Text>
        )}
      </Show>
    </Stack>
  );
}

function PhoneDock(props: SectionProps): JSX.Element {
  return (
    <Stack gap="none" hide="wide">
      <Dock id="today-dock">
        <Inline gap="sm" justify="between">
          <Stack gap="2xs">
            <Text numeric size="body" weight="semibold">
              {`${moveCount(props.page.todayCount())} today`}
            </Text>
            <Show
              fallback={
                <Text size="caption" tone="muted">
                  Every move has a choice.
                </Text>
              }
              when={props.page.undecidedTodayCount() > 0}
            >
              <Text size="caption" tone="danger">
                {`${moveCount(props.page.undecidedTodayCount())} still ${props.page.undecidedTodayCount() === 1 ? "needs" : "need"} a choice.`}
              </Text>
            </Show>
          </Stack>
          <Button
            state={props.page.submitting() ? "working" : "idle"}
            disabled={!props.page.canSubmitToday()}
            aria-label="Submit today's moves"
            onClick={props.page.submitToday}
          >
            {props.page.submitting() ? "Submitting" : "Submit today"}
          </Button>
        </Inline>
      </Dock>
    </Stack>
  );
}

function showsPhoneDock(page: TransactionsPageController): boolean {
  return page.todayCount() > 0;
}

function teamLine(entry: TimelineEarlierEntry): string {
  return `${entry.team.name} · ${leagueDisplayName(entry.team.league)} · ${sportDisplayName(entry.team.sport)}`;
}

function moveLabel(move: TimelineMove, teamName: string): string {
  return `${moveSummary(move.item)} for ${teamName}`;
}

type TransactionsPageProps = {
  readonly remote: TransactionRemote;
};

type SectionProps = {
  readonly page: TransactionsPageController;
};

type TodayChoice = "do_it_now" | "discard";

type TeamCardProps = {
  readonly card: TimelineTeamDay;
  readonly page: TransactionsPageController;
};

type MoveRowProps = {
  readonly move: TimelineMove;
  readonly page: TransactionsPageController;
};

type TodayMoveRowProps = MoveRowProps & {
  readonly teamName: string;
};

type FutureMoveRowProps = MoveRowProps & {
  readonly card: TimelineTeamDay;
};

type ScheduledDayProps = {
  readonly day: TimelineDay;
  readonly page: TransactionsPageController;
};

type MoveContentProps = {
  readonly move: TimelineMove;
};

type EarlierRowProps = {
  readonly entry: TimelineEarlierEntry;
};

type TeamHeadingProps = {
  readonly card: TimelineTeamDay;
  readonly id: string;
  readonly level: 3 | 4;
};
