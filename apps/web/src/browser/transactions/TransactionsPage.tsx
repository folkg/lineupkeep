import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Badge } from "#browser/shared-ui/Badge.tsx";
import { Band } from "#browser/shared-ui/Band.tsx";
import { Box } from "#browser/shared-ui/Box.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { Definition, DefinitionList } from "#browser/shared-ui/DefinitionList.tsx";
import { Dock, DockSpacer } from "#browser/shared-ui/Dock.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { formatCalendarDate, formatDateTime } from "#browser/shared-ui/formatTime.ts";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { ResponsiveContent } from "#browser/shared-ui/ResponsiveContent.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextField } from "#browser/shared-ui/TextField.tsx";
import { leagueDisplayName, sportDisplayName } from "#contracts/connections/teamVocabulary.ts";
import type {
  TransactionMoveTeamDayView,
  TransactionMoveView,
} from "#contracts/connections/transactionContract.ts";

import { TeamPlaces } from "./TeamPlaces";
import {
  endedMoveCount,
  kindLabel,
  moveCount,
  moveSummary,
  openMoveCount,
  teamCount,
} from "./transactionCopy";
import { TransactionAuthenticationFailure } from "./transactionFailure";
import type { TransactionRemote } from "./transactionRemote";
import { useTransactionsPage } from "./useTransactionsPage";
import type { TransactionsPageController } from "./useTransactionsPage";

export function TransactionsPage(props: TransactionsPageProps): JSX.Element {
  const page = useTransactionsPage({ remote: () => props.remote });

  return (
    <AppShell>
      <Page
        lede="Today is for acting. The rest is for planning. Every open move on your teams, split into what runs today and what waits for a later day."
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
                    page.failure() instanceof TransactionAuthenticationFailure
                      ? "Your session ended before your moves could be read. Sign in again to continue."
                      : "We could not load your open moves. Try again.",
                  recovery:
                    page.failure() instanceof TransactionAuthenticationFailure
                      ? page.signIn
                      : { label: "Try again", onAction: page.retry },
                }}
              />
            }
            when={page.failure() === null}
          >
            <DockSpacer active={page.todayMoves().length > 0}>
              <Stack gap="xl">
                <ActionFeedback feedback={page.feedback()} />
                <SummaryLine page={page} />
                <TodayZone page={page} />
                <PlanningSheet page={page} />
                <EarlierSection page={page} />
              </Stack>
            </DockSpacer>
            <Show when={page.todayMoves().length > 0}>
              <PhoneDock page={page} />
            </Show>
          </Show>
        </Show>
      </Page>
    </AppShell>
  );
}

function SummaryLine(props: SectionProps): JSX.Element {
  return (
    <Inline gap="sm" align="baseline">
      <Text numeric size="item" weight="semibold">
        {openMoveCount(props.page.counts().open)}
      </Text>
      <Text numeric size="caption" tone="muted">
        {`· ${String(props.page.counts().today)} today · ${String(props.page.counts().saved)} saved · ${teamCount(props.page.teamCount())}`}
      </Text>
    </Inline>
  );
}

function TodayZone(props: SectionProps): JSX.Element {
  const total = (): number => props.page.todayMoves().length;
  const chosen = (): number => total() - props.page.undecidedTodayCount();
  return (
    <Band labelledBy="today-title">
      <Stack gap="md">
        <SectionTitle
          id="today-title"
          focusable
          action={
            <Show when={total() > 0}>
              <ResponsiveContent
                phone={<></>}
                wide={
                  <Button
                    state={props.page.submitting() ? "working" : "idle"}
                    disabled={!props.page.canSubmitToday()}
                    aria-describedby="today-choice-hint"
                    aria-label="Submit today's chosen moves"
                    onClick={props.page.submitToday}
                  >
                    {props.page.submitting() ? "Submitting" : "Submit today"}
                  </Button>
                }
              />
            </Show>
          }
        >
          Today
        </SectionTitle>
        <Stack gap="2xs">
          <Text numeric size="item" weight="semibold">
            {total() > 0 ? `${moveCount(total())} for today` : "Nothing for today"}
          </Text>
          <Text size="body" tone="muted">
            {todayCopy(total(), chosen())}
          </Text>
        </Stack>
        <Show
          fallback={
            <EmptyState title="No moves due">
              When a move is due today, it appears here for a choice.
            </EmptyState>
          }
          when={total() > 0}
        >
          <ChoiceHint page={props.page} />
          <Stack gap="lg">
            <For each={props.page.todayMoves()}>
              {(move) => <TodayCard move={move} page={props.page} />}
            </For>
          </Stack>
        </Show>
      </Stack>
    </Band>
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

function TodayCard(props: TodayCardProps): JSX.Element {
  const choice = (): TodayChoice | undefined => props.page.choiceFor(props.move);
  const invalid = (): boolean => props.move.validation.status !== "current";
  const status = (): string => {
    switch (choice()) {
      case "now":
        return "Runs when you submit.";
      case "discard":
        return "Discarded when you submit.";
      case undefined:
        return "Not chosen yet.";
    }
  };
  return (
    <Box rule="top" ruleTone="ink" space="lg">
      <Stack gap="md">
        <Stack gap="2xs">
          <Text size="caption" weight="semibold">
            {props.move.team.name}
          </Text>
          <Text size="caption" tone="muted">
            {leagueDisplayName(props.move.team.league)} · {sportDisplayName(props.move.team.sport)}
          </Text>
          <TeamPlaces facts={props.page.teamFacts().get(props.move.team.id)} />
        </Stack>
        <Stack gap="2xs">
          <Inline gap="sm" align="baseline">
            <Badge tone="accent">{kindLabel(props.move.kind)}</Badge>
            <Text size="item" weight="semibold">
              {moveSummary(props.move)}
            </Text>
          </Inline>
          <Show when={props.move.reason.length > 0}>
            <Text size="caption" tone="muted">
              {props.move.reason}
            </Text>
          </Show>
          <MoveCheck move={props.move} />
        </Stack>
        <Stack gap="sm">
          <Text size="caption" tone={choice() === undefined ? "danger" : "muted"}>
            {status()}
          </Text>
          <Inline gap="sm" align="baseline" justify="end">
            <Button
              variant={choice() === "now" ? "secondary" : "quiet"}
              aria-pressed={choice() === "now" ? "true" : "false"}
              disabled={invalid() || props.page.submitting()}
              aria-label={`Do it now: ${moveLabel(props.move)}`}
              onClick={() => props.page.chooseToday(props.move, "now")}
            >
              Do it now
            </Button>
            <Button
              variant={choice() === "discard" ? "secondary" : "quiet"}
              tone="danger"
              aria-pressed={choice() === "discard" ? "true" : "false"}
              disabled={props.page.submitting()}
              aria-label={`Discard: ${moveLabel(props.move)}`}
              onClick={() => props.page.chooseToday(props.move, "discard")}
            >
              Discard
            </Button>
          </Inline>
        </Stack>
      </Stack>
    </Box>
  );
}

function PlanningSheet(props: SectionProps): JSX.Element {
  const teams = (): ReadonlyArray<TransactionMoveTeamDayView> => props.page.savedTeams();
  return (
    <Stack as="section" gap="md" labelledBy="saved-title">
      <SectionTitle id="saved-title" focusable>
        Saved for later
      </SectionTitle>
      <Inline gap="sm" align="baseline">
        <Text numeric size="item" weight="semibold">
          {moveCount(props.page.counts().saved)}
        </Text>
        <Text numeric size="caption" tone="muted">
          {`· ${teamCount(teams().length)}`}
        </Text>
      </Inline>
      <Text size="body" tone="muted">
        Each waits for its day. You can change or discard any saved move until then.
      </Text>
      <Show
        fallback={
          <EmptyState title="Nothing saved">
            Every team is clear. When you propose a change, it appears here with the day it runs.
          </EmptyState>
        }
        when={teams().length > 0}
      >
        <Stack gap="xl">
          <For each={teams()}>{(card) => <SavedTeamCard card={card} page={props.page} />}</For>
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

function SavedTeamCard(props: SavedTeamCardProps): JSX.Element {
  const titleId = (): string => `saved-team-${props.card.team.id}`;
  return (
    <Box rule="top" ruleTone="ink" space="lg">
      <Stack as="section" gap="md" labelledBy={titleId()}>
        <Stack gap="2xs">
          <Inline gap="sm" align="baseline" justify="between">
            <Heading id={titleId()} level={3} size="item">
              {props.card.team.name}
            </Heading>
            <Text numeric size="caption" tone="faint">
              {moveCount(props.card.moves.length)}
            </Text>
          </Inline>
          <Text size="caption" tone="muted">
            {leagueDisplayName(props.card.team.league)} · {sportDisplayName(props.card.team.sport)}
          </Text>
          <TeamPlaces facts={props.page.teamFacts().get(props.card.team.id)} />
        </Stack>
        <Box rule="top" space="none">
          <RuleList>
            <For each={props.card.moves}>
              {(move) => <SavedMoveRow move={move} page={props.page} />}
            </For>
          </RuleList>
        </Box>
      </Stack>
    </Box>
  );
}

function SavedMoveRow(props: SavedMoveRowProps): JSX.Element {
  const invalid = (): boolean => props.move.validation.status !== "current";
  const editing = (): boolean => props.page.editing() === props.move.move;
  return (
    <RuleListItem layout="stack">
      <Inline gap="lg" align="start" justify="between" growFirst collapse>
        <Stack gap="2xs">
          <Inline gap="sm" align="baseline">
            <Badge tone="accent">{kindLabel(props.move.kind)}</Badge>
            <Text size="item" weight="semibold">
              {moveSummary(props.move)}
            </Text>
          </Inline>
          <Show when={props.move.reason.length > 0}>
            <Text size="caption" tone="muted">
              {props.move.reason}
            </Text>
          </Show>
          <DateFacts move={props.move} />
          <MoveCheck move={props.move} />
        </Stack>
        <Stack gap="sm">
          <Inline gap="sm" align="baseline" justify="end">
            <Show when={!invalid()}>
              <Button
                variant="link"
                disabled={props.page.saving() || props.page.discarding() !== undefined}
                aria-label={`Change date: ${moveLabel(props.move)}`}
                onClick={() => props.page.startEdit(props.move)}
              >
                {props.move.runDay === undefined ? "Set date" : "Change date"}
              </Button>
            </Show>
            <Button
              variant="quiet"
              tone="danger"
              disabled={props.page.saving() || props.page.discarding() !== undefined}
              state={props.page.discarding() === props.move.move ? "working" : "idle"}
              aria-label={`Discard: ${moveLabel(props.move)}`}
              onClick={() => props.page.discardMove(props.move)}
            >
              {props.page.discarding() === props.move.move ? "Discarding" : "Discard"}
            </Button>
          </Inline>
        </Stack>
      </Inline>
      <Show when={editing()}>
        <Form gap="sm" onSubmit={() => props.page.saveEdit(props.move)}>
          <Stack gap="sm">
            <TextField
              label="Run date"
              type="date"
              value={props.page.editingDate()}
              onInput={(event) => props.page.setEditingDate(event.currentTarget.value)}
            />
            <Text size="caption" tone="muted">
              Saving changes the day this move runs. It does not run it.
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
                disabled={invalid() || props.page.discarding() !== undefined}
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

function DateFacts(props: { readonly move: TransactionMoveView }): JSX.Element {
  return (
    <DefinitionList>
      <Definition
        term="Runs"
        value={
          props.move.runDay === undefined ? "No date set" : formatCalendarDate(props.move.runDay)
        }
      />
      <Definition
        term="Takes effect"
        value={
          props.move.effectiveDate === undefined
            ? "When the league applies it"
            : formatCalendarDate(props.move.effectiveDate)
        }
      />
    </DefinitionList>
  );
}

function MoveCheck(props: { readonly move: TransactionMoveView }): JSX.Element {
  const invalid = (): boolean => props.move.validation.status !== "current";
  const reasons = (): string =>
    props.move.validation.reasons.map((reason) => reason.detail).join(" ");
  const checked = (): string | undefined => {
    if (props.move.check.status === "last_checked") {
      return props.move.check.note;
    }
    return props.move.validation.checkedAt === undefined
      ? undefined
      : `Checked ${formatDateTime(props.move.validation.checkedAt)}.`;
  };
  return (
    <Show when={invalid() || checked() !== undefined}>
      <Stack gap="2xs">
        <Show when={invalid()}>
          <Text size="caption" tone="danger">
            {reasons()}
          </Text>
        </Show>
        <Show when={checked()}>
          {(line) => (
            <Text size="caption" tone="faint">
              {line()}
            </Text>
          )}
        </Show>
      </Stack>
    </Show>
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
        {endedMoveCount(props.page.earlierCount())}
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
              <For each={props.page.earlier()}>{(move) => <EarlierRow move={move} />}</For>
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

function EarlierRow(props: { readonly move: TransactionMoveView }): JSX.Element {
  return (
    <RuleListItem layout="stack" dense>
      <Stack gap="2xs">
        <Inline gap="sm" align="baseline">
          <Badge tone={props.move.result === "failed" ? "neutral" : "accent"}>
            {resultLabel(props.move)}
          </Badge>
          <Text size="item" weight="semibold">
            {moveSummary(props.move)}
          </Text>
        </Inline>
        <Text size="caption" tone="muted">
          {props.move.team.name} · {leagueDisplayName(props.move.team.league)} ·{" "}
          {sportDisplayName(props.move.team.sport)}
        </Text>
      </Stack>
    </RuleListItem>
  );
}

function PhoneDock(props: SectionProps): JSX.Element {
  return (
    <Stack hide="wide" gap="2xs">
      <Dock id="today-dock">
        <Inline gap="sm" justify="between">
          <Stack gap="2xs">
            <Text numeric size="body" weight="semibold">
              {`${moveCount(props.page.todayMoves().length)} today`}
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

function todayCopy(total: number, chosen: number): string {
  if (total === 0) {
    return "No move is waiting to run today.";
  }
  if (chosen === total) {
    return `All ${String(total)} ${total === 1 ? "is" : "are"} chosen. Submitting runs ${total === 1 ? "it" : "them"} now.`;
  }
  return `${String(chosen)} of ${String(total)} chosen. Submitting runs only the moves you chose.`;
}

function resultLabel(move: TransactionMoveView): string {
  if (move.result === "executed") {
    return "Ran";
  }
  if (move.result === "failed") {
    return "Failed";
  }
  if (move.result === "skipped") {
    return "Skipped";
  }
  if (move.result === "unknown") {
    return "Not confirmed";
  }
  if (move.result === "pending") {
    return "Waiting on the league";
  }
  if (move.result === "withdrawn") {
    return "Withdrawn";
  }
  if (move.result === "expired") {
    return "Expired";
  }
  if (move.decision === "discarded") {
    return "Discarded";
  }
  return "Open";
}

function moveLabel(move: TransactionMoveView): string {
  return `${moveSummary(move)} for ${move.team.name}`;
}

type TransactionsPageProps = {
  readonly remote: TransactionRemote;
};

type SectionProps = {
  readonly page: TransactionsPageController;
};

type TodayChoice = "now" | "discard";

type TodayCardProps = {
  readonly move: TransactionMoveView;
  readonly page: TransactionsPageController;
};

type SavedTeamCardProps = {
  readonly card: TransactionMoveTeamDayView;
  readonly page: TransactionsPageController;
};

type SavedMoveRowProps = {
  readonly move: TransactionMoveView;
  readonly page: TransactionsPageController;
};
