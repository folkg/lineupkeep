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
import { Form } from "#browser/shared-ui/Form.tsx";
import { formatCalendarDate, formatDateTime } from "#browser/shared-ui/formatTime.ts";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextField } from "#browser/shared-ui/TextField.tsx";
import { leagueDisplayName, sportDisplayName } from "#contracts/connections/teamVocabulary.ts";
import type {
  TransactionMoveTeamDayView,
  TransactionMoveView,
  TransactionPlanGroupView,
} from "#contracts/connections/transactionContract.ts";

import { TeamPlaces } from "./TeamPlaces";
import {
  endedMoveCount,
  groupStatusLabel,
  groupTitle,
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
        lede="Today is for acting. The rest is for planning. Every open move on your teams, split into what is due today and what waits for a later day."
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
            <Stack gap="xl">
              <ActionFeedback feedback={page.feedback()} />
              <SummaryLine page={page} />
              <TodayZone page={page} />
              <GroupsZone page={page} />
              <PlanningSheet page={page} />
              <EarlierSection page={page} />
            </Stack>
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
  const pending = (): number => props.page.pendingTodayCount();
  return (
    <Band labelledBy="today-title">
      <Stack gap="md">
        <SectionTitle id="today-title" focusable>
          Today
        </SectionTitle>
        <Stack gap="2xs">
          <Text numeric size="item" weight="semibold">
            {total() > 0 ? `${moveCount(total())} for today` : "Nothing for today"}
          </Text>
          <Text size="body" tone="muted">
            {todayCopy(total(), pending())}
          </Text>
        </Stack>
        <Show
          fallback={
            <EmptyState title="No moves due">
              When a move is due today, it appears here for your confirmation.
            </EmptyState>
          }
          when={total() > 0}
        >
          <Show when={pending() > 0}>
            <Text id="today-choice-hint" size="caption" tone="danger">
              {`${moveCount(pending())} still ${pending() === 1 ? "needs" : "need"} your confirmation. A move runs only after you confirm it.`}
            </Text>
          </Show>
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

function TodayCard(props: TodayCardProps): JSX.Element {
  const invalid = (): boolean => props.move.validation.status !== "current";
  const working = (): boolean => props.page.confirming() === props.move.move;
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
            <Badge tone={isPending(props.move) ? "neutral" : "accent"}>
              {decisionLabel(props.move)}
            </Badge>
            <Text size="item" weight="semibold">
              {moveSummary(props.move)}
            </Text>
          </Inline>
          <Show when={props.move.reason.length > 0}>
            <Text size="caption" tone="muted">
              {props.move.reason}
            </Text>
          </Show>
          <MoveState move={props.move} />
          <Show when={props.move.result !== undefined}>
            <Text
              size="caption"
              tone={
                props.move.result === "failed" || props.move.result === "unknown"
                  ? "danger"
                  : "muted"
              }
            >
              {resultLabel(props.move)}
            </Text>
          </Show>
          <MoveCheck move={props.move} />
        </Stack>
        <Inline gap="sm" align="baseline" justify="end">
          <Show when={isPending(props.move) && props.move.result === undefined}>
            <Button
              variant="secondary"
              disabled={invalid() || props.page.confirming() !== undefined}
              state={working() ? "working" : "idle"}
              aria-label={`Confirm and run: ${moveLabel(props.move)}`}
              onClick={() => props.page.confirmMove(props.move)}
            >
              {working() ? "Confirming" : "Confirm and run"}
            </Button>
          </Show>
          <Show when={isConfirmed(props.move) && props.move.result === undefined}>
            <Button
              variant="secondary"
              disabled={invalid() || props.page.confirming() !== undefined}
              state={working() ? "working" : "idle"}
              aria-label={`Run now: ${moveLabel(props.move)}`}
              onClick={() => props.page.confirmMove(props.move)}
            >
              {working() ? "Running" : "Run now"}
            </Button>
          </Show>
          <Button
            variant="quiet"
            tone="danger"
            disabled={working() || props.page.discarding() !== undefined}
            aria-label={`Discard: ${moveLabel(props.move)}`}
            onClick={() => props.page.discardMove(props.move)}
          >
            Discard
          </Button>
        </Inline>
      </Stack>
    </Box>
  );
}

function GroupsZone(props: SectionProps): JSX.Element {
  return (
    <Show when={props.page.groups().length > 0}>
      <Band labelledBy="groups-title">
        <Stack gap="md">
          <SectionTitle id="groups-title" focusable>
            Groups
          </SectionTitle>
          <Text size="body" tone="muted">
            A group runs whole, in the order its moves need. If your league accepts one write and
            rejects a later one, the group says what ran in part.
          </Text>
          <Stack gap="lg">
            <For each={props.page.groups()}>{(group) => <GroupCard group={group} />}</For>
          </Stack>
        </Stack>
      </Band>
    </Show>
  );
}

function GroupCard(props: { readonly group: TransactionPlanGroupView }): JSX.Element {
  return (
    <Box rule="top" ruleTone="ink" space="lg">
      <Stack gap="2xs">
        <Inline gap="sm" align="baseline">
          <Badge tone={props.group.status === "blocked" ? "neutral" : "accent"}>
            {groupStatusLabel(props.group.status)}
          </Badge>
          <Text size="item" weight="semibold">
            {groupTitle(props.group)}
          </Text>
          <Text numeric size="caption" tone="faint">
            {moveCount(props.group.moves.length)}
          </Text>
        </Inline>
        <Text size="caption" tone={props.group.status === "ready" ? "muted" : "default"}>
          {props.group.detail}
        </Text>
        <Show when={props.group.label === "Roster fixes"}>
          <Text size="caption" tone="muted">
            These moves make the roster legal and free the places your move needs.
          </Text>
        </Show>
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
        Each saved move waits for its day. On that day it waits in Today for your confirmation; once
        confirmed, the check runs it. You can change or discard it until then.
      </Text>
      <Show
        fallback={
          <EmptyState title="Nothing saved">
            Every team is clear. When you propose a change, it appears here with the day it waits
            for.
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
            <Badge tone={isPending(props.move) ? "neutral" : "accent"}>
              {decisionLabel(props.move)}
            </Badge>
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
          <MoveState move={props.move} />
          <MoveCheck move={props.move} />
        </Stack>
        <Stack gap="sm">
          <Inline gap="sm" align="baseline" justify="end">
            <Show when={isPending(props.move) && props.move.result === undefined}>
              <Button
                variant="secondary"
                disabled={invalid() || props.page.confirming() !== undefined}
                state={props.page.confirming() === props.move.move ? "working" : "idle"}
                aria-label={`Confirm: ${moveLabel(props.move)}`}
                onClick={() => props.page.confirmMove(props.move)}
              >
                {props.page.confirming() === props.move.move ? "Confirming" : "Confirm"}
              </Button>
            </Show>
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
              Saving changes the day this move runs and clears your confirmation.
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

function MoveState(props: { readonly move: TransactionMoveView }): JSX.Element {
  const confirmation = (): string | undefined => {
    const confirmed = props.move.confirmation;
    if (confirmed !== undefined) {
      return props.move.runAt === undefined
        ? `You confirmed this on ${formatCalendarDate(confirmed.at)}. It has not run yet.`
        : `You confirmed this on ${formatCalendarDate(confirmed.at)}. It ran on the ${formatCalendarDate(props.move.runAt)} check.`;
    }
    if (props.move.decision === "discarded") {
      return props.move.decidedAt === undefined
        ? "Discarded."
        : `Discarded on ${formatCalendarDate(props.move.decidedAt)}.`;
    }
    if (props.move.result === "executed") {
      return props.move.runAt === undefined
        ? "It ran on the check."
        : `It ran on the ${formatCalendarDate(props.move.runAt)} check.`;
    }
    if (props.move.result !== undefined) {
      return undefined;
    }
    if (isConfirmed(props.move)) {
      return "Confirmed. It has not run yet.";
    }
    if (props.move.decision === "saved") {
      return props.move.runDay === undefined
        ? "It waits for your confirmation."
        : `It waits for ${formatCalendarDate(props.move.runDay)}. It runs only after you confirm it on that day.`;
    }
    return "Nothing runs until you confirm it.";
  };
  return (
    <Show when={confirmation()}>
      {(line) => (
        <Text size="caption" tone={props.move.decision === "discarded" ? "faint" : "muted"}>
          {line()}
        </Text>
      )}
    </Show>
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
        <MoveState move={props.move} />
      </Stack>
    </RuleListItem>
  );
}

function todayCopy(total: number, pending: number): string {
  if (total === 0) {
    return "No move is waiting to run today.";
  }
  if (pending === 0) {
    return `All ${String(total)} ${total === 1 ? "is" : "are"} confirmed. A confirmed move runs now, or on the check when its day arrives.`;
  }
  return `${String(pending)} of ${String(total)} waiting for your confirmation. Nothing runs until you confirm it.`;
}

function decisionLabel(move: TransactionMoveView): string {
  if (move.decision === "discarded") {
    return "Discarded";
  }
  if (move.decision === "now") {
    return "Confirmed for today";
  }
  if (move.decision === "confirmed") {
    return move.runDay === undefined
      ? "Confirmed"
      : `Confirmed for ${formatCalendarDate(move.runDay)}`;
  }
  if (move.decision === "saved") {
    return move.runDay === undefined
      ? "Undecided"
      : `Undecided for ${formatCalendarDate(move.runDay)}`;
  }
  return "Undecided";
}

function isPending(move: TransactionMoveView): boolean {
  return move.decision === "undecided" || move.decision === "saved";
}

function isConfirmed(move: TransactionMoveView): boolean {
  return move.decision === "now" || move.decision === "confirmed";
}

function resultLabel(move: TransactionMoveView): string {
  if (move.result === "executed") {
    return "Ran on the check";
  }
  if (move.result === "failed") {
    return "Failed";
  }
  if (move.result === "skipped") {
    return "Skipped";
  }
  if (move.result === "unknown") {
    return "Unknown";
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
  return "Undecided";
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
