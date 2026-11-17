import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Badge } from "#browser/shared-ui/Badge.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Card, CardNote, CardSection } from "#browser/shared-ui/Card.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { Disclosure } from "#browser/shared-ui/Disclosure.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { formatCalendarDate, formatDateTime } from "#browser/shared-ui/formatTime.ts";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { QueueList, QueueListItem, QueueListNote } from "#browser/shared-ui/QueueList.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextField } from "#browser/shared-ui/TextField.tsx";
import { leagueDisplayName, sportDisplayName } from "#contracts/connections/teamVocabulary.ts";
import type {
  TransactionMoveDayView,
  TransactionMoveTeamDayView,
  TransactionMoveView,
  TransactionPlanGroupView,
  TransactionTeamFactsView,
} from "#contracts/connections/transactionContract.ts";

import { TeamPlaces } from "./TeamPlaces";
import {
  endedMoveCount,
  moveCount,
  moveSummary,
  openMoveCount,
  teamCount,
} from "./transactionCopy";
import { TransactionAuthenticationFailure } from "./transactionFailure";
import type { TransactionRemote } from "./transactionRemote";
import {
  confirmationLine,
  discardLine,
  moveOutcomeLabel,
  resultDetailLine,
  resultTimeLine,
  scheduledRunLine,
  waitingOnLeagueLine,
} from "./transactionTimes";
import { useGroupConfirmation } from "./useGroupConfirmation";
import type { GroupConfirmation } from "./useGroupConfirmation";
import { useTransactionsPage } from "./useTransactionsPage";
import type { TransactionsPageController } from "./useTransactionsPage";

export function TransactionsPage(props: TransactionsPageProps): JSX.Element {
  const page = useTransactionsPage({ remote: () => props.remote });

  return (
    <AppShell>
      <Page
        kicker={<SummaryKicker page={page} />}
        lede="Confirming runs a group now, or at its run time on a later day."
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
            <Stack gap="2xl">
              <ActionFeedback feedback={page.feedback()} />
              <OpenDays page={page} remote={props.remote} />
              <Show when={page.hasMoreOpen()}>
                <Inline gap="sm">
                  <Button
                    variant="secondary"
                    state={page.fetchingMoreOpen() ? "working" : "idle"}
                    onClick={page.showMoreOpen}
                  >
                    {page.fetchingMoreOpen() ? "Loading more moves" : "Show more moves"}
                  </Button>
                </Inline>
              </Show>
              <EarlierSection page={page} />
            </Stack>
          </Show>
        </Show>
      </Page>
    </AppShell>
  );
}

function SummaryKicker(props: SectionProps): JSX.Element {
  return (
    <Inline gap="sm">
      <Text as="span" numeric size="label">
        {openMoveCount(props.page.counts().open)}
      </Text>
      <Text as="span" numeric size="label">
        {`· ${String(props.page.counts().today)} today · ${String(props.page.counts().saved)} saved · ${teamCount(props.page.teamCount())}`}
      </Text>
    </Inline>
  );
}

function OpenDays(props: RemoteSectionProps): JSX.Element {
  const today = (): TransactionMoveDayView | undefined =>
    props.page.days().find((day) => day.today);
  const later = (): ReadonlyArray<TransactionMoveDayView> =>
    props.page.days().filter((day) => !day.today);
  return (
    <>
      <DaySection day={today()} page={props.page} remote={props.remote} today />
      <For each={later()}>
        {(day) => <DaySection day={day} page={props.page} remote={props.remote} today={false} />}
      </For>
      <Show when={later().length === 0}>
        <EmptyState title="Nothing saved">
          Every team is clear. When you propose a change, it appears here with the day it waits for.
        </EmptyState>
      </Show>
    </>
  );
}

function DaySection(props: DaySectionProps): JSX.Element {
  const titleId = (): string =>
    `transactions-day-${props.today ? "today" : (props.day?.day ?? "none")}`;
  const moves = (): ReadonlyArray<TransactionMoveView> =>
    props.day === undefined ? [] : props.day.teams.flatMap((team) => team.moves);
  const title = (): string => {
    if (props.today) {
      return "Today";
    }
    return props.day?.day === undefined ? "No day set" : formatCalendarDate(props.day.day);
  };
  const aside = (): string | undefined => {
    if (props.day?.day === undefined) {
      return undefined;
    }
    if (props.today) {
      return formatCalendarDate(props.day.day);
    }
    const nextRunAt = props.page.nextRunAt();
    return nextRunAt === undefined ? undefined : scheduledRunLine(props.day.day, nextRunAt);
  };
  const countLabel = (): string => {
    if (props.today) {
      return moves().length === 0 ? "Nothing for today" : `${moveCount(moves().length)} for today`;
    }
    return moveCount(moves().length);
  };
  const pending = (): number => (props.today ? props.page.pendingTodayCount() : 0);
  return (
    <Stack as="section" gap="lg" labelledBy={titleId()}>
      <SectionTitle
        id={titleId()}
        action={
          <Text as="span" numeric size="label" tone="faint">
            {countLabel()}
          </Text>
        }
        aside={
          <Show when={aside()}>
            {(held) => (
              <Text as="span" numeric size="label" tone="muted">
                {held()}
              </Text>
            )}
          </Show>
        }
      >
        {title()}
      </SectionTitle>
      <Show when={pending() > 0}>
        <Stack gap="2xs">
          <Text size="caption" tone="muted">
            {`${moveCount(pending())} still ${pending() === 1 ? "needs" : "need"} your confirmation.`}
          </Text>
          <Text size="caption" tone="muted">
            Nothing runs until you confirm it.
          </Text>
        </Stack>
      </Show>
      <Show
        fallback={
          <Show when={props.today}>
            <EmptyState title="No moves due">
              When a move is due today, it appears here for your confirmation.
            </EmptyState>
          </Show>
        }
        when={moves().length > 0}
      >
        <Stack gap="2xl">
          <For each={props.day?.teams ?? []}>
            {(team) => (
              <TeamGroups card={team} page={props.page} remote={props.remote} today={props.today} />
            )}
          </For>
        </Stack>
      </Show>
    </Stack>
  );
}

function TeamGroups(props: TeamGroupsProps): JSX.Element {
  const confirmation = useGroupConfirmation({
    team: () => props.card.team.id,
    remote: () => props.remote,
    page: () => props.page,
  });
  const facts = (): TransactionTeamFactsView | undefined =>
    props.page.teamFacts().get(props.card.team.id);
  return (
    <For each={runCards(props.card.moves, props.page.groups(), props.today)}>
      {(card) => (
        <GroupPanel card={card} confirmation={confirmation} facts={facts()} page={props.page} />
      )}
    </For>
  );
}

function GroupPanel(props: GroupPanelProps): JSX.Element {
  const team = (): TransactionMoveView["team"] => props.card.lead.team;
  const all = (): ReadonlyArray<TransactionMoveView> => [...props.card.moves, ...props.card.fixes];
  const headingId = (): string => `transactions-panel-${props.card.lead.team.id}-${props.card.key}`;
  const pending = (): boolean =>
    props.card.moves.some(
      (move) =>
        move.result === undefined && (move.decision === "undecided" || move.decision === "saved"),
    );
  const hasOpen = (): boolean =>
    all().some((move) => move.result === undefined && move.decision !== "discarded");
  const opened = (): boolean =>
    props.card.group === undefined || props.card.group.status === "ready";
  const confirmable = (): boolean =>
    all().every(
      (move) =>
        move.validation.status === "current" &&
        move.result === undefined &&
        move.decision !== "discarded",
    );
  const busy = (): boolean => props.confirmation.pending();
  const working = (): boolean =>
    busy() && all().every((move) => props.confirmation.pendingMoves().includes(move.move));
  const state = (): GroupState => (working() ? "Running" : panelState(props.card));
  const stopped = (): boolean => state() === "Partly ran" || state() === "Blocked";
  const showControl = (): boolean => (props.card.today || pending()) && hasOpen() && opened();
  const controlLabel = (): string => (props.card.today ? "Confirm and run" : "Confirm");
  const workingLabel = (): string => (props.card.today && !pending() ? "Running" : "Confirming");
  const actionLabel = (): string => `${controlLabel()}: ${cardTitle(props.card)}`;
  const runLine = (): string | undefined => {
    if (props.card.today) {
      return undefined;
    }
    const runDay = props.card.lead.runDay;
    return runDay === undefined
      ? "No run date is set."
      : `${scheduledRunLine(runDay, props.page.nextRunAt())}.`;
  };
  const statusLines = (): ReadonlyArray<StatusLine> => {
    const lines: Array<StatusLine> = [];
    const summary = groupSummary(props.card, state());
    if (summary !== undefined) {
      lines.push({ text: summary, tone: "muted" });
    }
    if (all().some((move) => move.decision !== "discarded" && move.result === "pending")) {
      const nextRunAt = props.page.nextRunAt();
      if (nextRunAt !== undefined) {
        lines.push({ text: waitingOnLeagueLine(nextRunAt), tone: "muted" });
      }
    }
    const confirmed = all().find((move) => move.confirmation !== undefined);
    if (confirmed !== undefined) {
      const line = confirmationLine(confirmed);
      if (line !== undefined) {
        lines.push({ text: line, tone: "muted" });
      }
    }
    if ((state() === "Undecided" || state() === "Confirmed") && !props.card.today) {
      const runDay = props.card.lead.runDay;
      const nextRunAt = props.page.nextRunAt();
      if (runDay !== undefined && nextRunAt !== undefined) {
        lines.push({ text: `${scheduledRunLine(runDay, nextRunAt)}.`, tone: "muted" });
      }
    }
    return lines;
  };
  const detail = (): string | undefined => props.card.group?.detail;
  const facts = (): TransactionTeamFactsView | undefined =>
    props.facts !== undefined && (state() === "Blocked" || state() === "Partly ran")
      ? props.facts
      : undefined;
  const hasDetail = (): boolean => detail() !== undefined || facts() !== undefined;
  return (
    <Card
      badge={<Badge tone={groupStateTone(state())}>{state()}</Badge>}
      footer={
        showControl() ? (
          <>
            <Button
              variant="primary"
              disabled={!confirmable() || busy()}
              state={working() ? "working" : "idle"}
              aria-label={actionLabel()}
              onClick={() => props.confirmation.start(all())}
            >
              {working() ? workingLabel() : controlLabel()}
            </Button>
            <Show when={runLine()}>
              {(line) => (
                <Text as="span" size="label" tone="muted">
                  {line()}
                </Text>
              )}
            </Show>
          </>
        ) : undefined
      }
      header={
        <Heading id={headingId()} level={3} size="section">
          {team().name}
        </Heading>
      }
      labelledBy={headingId()}
      meta={
        <>
          <Text as="span" size="caption" tone="muted">
            {leagueDisplayName(team().league)} · {sportDisplayName(team().sport)}
          </Text>
          <Show when={props.card.group?.label}>
            {(label) => (
              <Text as="span" size="caption" tone="faint">
                {label()}
              </Text>
            )}
          </Show>
        </>
      }
    >
      <Show when={statusLines().length > 0}>
        <CardSection>
          <For each={statusLines()}>
            {(line) => (
              <Text size="caption" tone={line.tone}>
                {line.text}
              </Text>
            )}
          </For>
        </CardSection>
      </Show>
      <QueueList>
        <For each={props.card.moves}>
          {(move, index) => (
            <GroupMoveRow
              move={move}
              number={index() + 1}
              page={props.page}
              today={props.card.today}
              waiting={stopped()}
              working={busy()}
            />
          )}
        </For>
        <Show when={props.card.fixes.length > 0}>
          <QueueListNote>
            <Text size="caption" tone="muted">
              Added by the server so the add fits. You can edit or discard it.
            </Text>
          </QueueListNote>
          <For each={props.card.fixes}>
            {(move, index) => (
              <GroupMoveRow
                move={move}
                number={props.card.moves.length + index() + 1}
                page={props.page}
                today={props.card.today}
                waiting={stopped()}
                working={busy()}
              />
            )}
          </For>
        </Show>
      </QueueList>
      <Show when={hasDetail()}>
        <CardNote>
          <Disclosure summary="Why these moves">
            <Stack gap="md">
              <Show when={detail()}>
                {(text) => (
                  <Text size="caption" tone="muted">
                    {text()}
                  </Text>
                )}
              </Show>
              <Show when={facts()}>{(held) => <TeamPlaces facts={held()} />}</Show>
            </Stack>
          </Disclosure>
        </CardNote>
      </Show>
    </Card>
  );
}

function GroupMoveRow(props: GroupMoveRowProps): JSX.Element {
  const invalid = (): boolean => props.move.validation.status !== "current";
  const editing = (): boolean => props.page.editing() === props.move.move;
  const actionable = (): boolean =>
    props.move.result === undefined && props.move.decision !== "discarded";
  const actionsDisabled = (): boolean =>
    props.page.saving() || props.page.discarding() !== undefined || props.working;
  const outcome = (): string | undefined =>
    moveOutcomeLabel(props.move) ??
    (props.waiting && props.move.decision !== "discarded" ? "Waiting" : undefined);
  return (
    <QueueListItem
      number={props.number}
      actions={
        <>
          <Show when={!props.today && !invalid() && actionable()}>
            <Button
              variant="link"
              disabled={actionsDisabled()}
              aria-label={`Change date: ${moveSummary(props.move)}`}
              onClick={() => props.page.startEdit(props.move)}
            >
              {props.move.runDay === undefined ? "Set date" : "Change date"}
            </Button>
          </Show>
          <Show when={actionable()}>
            <Button
              variant="quiet"
              tone="danger"
              disabled={actionsDisabled()}
              state={props.page.discarding() === props.move.move ? "working" : "idle"}
              aria-label={`Discard: ${moveSummary(props.move)}`}
              onClick={() => props.page.discardMove(props.move)}
            >
              {props.page.discarding() === props.move.move ? "Discarding" : "Discard"}
            </Button>
          </Show>
        </>
      }
      details={
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
                  disabled={invalid() || props.page.discarding() !== undefined || props.working}
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
      }
    >
      <Text size="item" weight="semibold">
        {moveSummary(props.move)}
      </Text>
      <Show when={props.move.reason.length > 0}>
        <Text size="caption" tone="muted">
          {props.move.reason}
        </Text>
      </Show>
      <Show when={props.move.placement}>
        {(placement) => (
          <Text size="caption" tone="muted">
            {placement().detail}
          </Text>
        )}
      </Show>
      <Show when={outcome()}>
        {(label) => (
          <Text size="caption" weight="semibold" tone={outcomeTone(props.move)}>
            {label()}
          </Text>
        )}
      </Show>
      <Show when={resultDetailLine(props.move)}>
        {(line) => (
          <Text size="caption" tone="muted">
            {line()}
          </Text>
        )}
      </Show>
      <Show when={resultTimeLine(props.move)}>
        {(line) => (
          <Text size="caption" tone="faint">
            {line()}
          </Text>
        )}
      </Show>
      <Show when={!props.today && props.move.effectiveDate !== undefined}>
        <Text size="caption" tone="muted">
          {`Takes effect ${formatCalendarDate(props.move.effectiveDate ?? "")}.`}
        </Text>
      </Show>
      <MoveCheck move={props.move} />
    </QueueListItem>
  );
}

function outcomeTone(move: TransactionMoveView): "muted" | "faint" | "danger" {
  if (move.decision === "discarded") {
    return "faint";
  }
  return move.result === "failed" || move.result === "unknown" ? "danger" : "muted";
}

function MoveCheck(props: { readonly move: TransactionMoveView }): JSX.Element {
  const invalid = (): boolean => props.move.validation.status !== "current";
  const reasons = (): string =>
    props.move.validation.reasons.map((reason) => reason.detail).join(" ");
  const checked = (): string | undefined => {
    if (props.move.check.status === "last_checked") {
      return props.move.check.note;
    }
    if (props.move.validation.status === "current") {
      return undefined;
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
          {(held) => (
            <Text size="caption" tone="faint">
              {held()}
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
                  {props.page.fetchingMoreEarlier() ? "Loading ended moves" : "Load more"}
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
  const confirmed = (): string | undefined => confirmationLine(props.move);
  const discarded = (): string | undefined => discardLine(props.move);
  const result = (): string | undefined => resultDetailLine(props.move);
  const resultTime = (): string | undefined => resultTimeLine(props.move);
  return (
    <RuleListItem layout="stack" dense>
      <Stack gap="2xs">
        <Inline gap="sm" align="baseline">
          <Badge tone={outcomeBadgeTone(props.move)}>
            {moveOutcomeLabel(props.move) ?? "Ended"}
          </Badge>
          <Text size="item" weight="semibold">
            {moveSummary(props.move)}
          </Text>
        </Inline>
        <Text size="caption" tone="muted">
          {props.move.team.name} · {leagueDisplayName(props.move.team.league)} ·{" "}
          {sportDisplayName(props.move.team.sport)}
        </Text>
        <Show when={confirmed()}>
          {(line) => (
            <Text size="caption" tone="muted">
              {line()}
            </Text>
          )}
        </Show>
        <Show when={discarded()}>
          {(line) => (
            <Text size="caption" tone="faint">
              {line()}
            </Text>
          )}
        </Show>
        <Show when={result()}>
          {(line) => (
            <Text size="caption" tone="muted">
              {line()}
            </Text>
          )}
        </Show>
        <Show when={resultTime()}>
          {(line) => (
            <Text size="caption" tone="faint">
              {line()}
            </Text>
          )}
        </Show>
      </Stack>
    </RuleListItem>
  );
}

function outcomeBadgeTone(move: TransactionMoveView): "accent" | "neutral" {
  return move.decision !== "discarded" && move.result === "executed" ? "accent" : "neutral";
}

function panelState(card: RunGroupCardView): GroupState {
  const moves = [...card.moves, ...card.fixes];
  if (moves.length > 0 && moves.every((move) => move.decision === "discarded")) {
    return "Discarded";
  }
  if (moves.length > 0 && moves.every((move) => move.result === "executed")) {
    return "Ran";
  }
  if (
    moves.length > 0 &&
    moves.every((move) => move.result === "pending" && move.decision !== "discarded")
  ) {
    return "Confirmed";
  }
  if (moves.some((move) => move.decision !== "discarded" && move.result === "executed")) {
    return "Partly ran";
  }
  const group = card.group;
  if (group !== undefined) {
    switch (group.status) {
      case "done":
        return "Ran";
      case "partly_done":
        return "Partly ran";
      case "blocked":
        return "Blocked";
      case "ready":
        return moves.length > 0 && moves.every(isConfirmed) ? "Confirmed" : "Undecided";
    }
  }
  if (moves.some((move) => move.result !== undefined)) {
    return "Blocked";
  }
  if (moves.some((move) => move.validation.status !== "current")) {
    return "Blocked";
  }
  return moves.length > 0 && moves.every(isConfirmed) ? "Confirmed" : "Undecided";
}

function groupSummary(card: RunGroupCardView, state: GroupState): string | undefined {
  switch (state) {
    case "Ran":
      return `${moveCount(groupCount(card))} ran.`;
    case "Partly ran":
      return partlyRanLine(card);
    case "Blocked":
      return groupCount(card) === 1 ? "This move did not run." : "This group did not run.";
    case "Discarded":
      return groupCount(card) === 1 ? "You discarded this move." : "You discarded this group.";
    case "Undecided":
      return card.group === undefined
        ? undefined
        : cardCount(card) === 1
          ? "This move runs when you confirm."
          : `${moveCount(cardCount(card))} run together in this order.`;
    case "Confirmed":
    case "Running":
      return undefined;
  }
}

function partlyRanLine(card: RunGroupCardView): string {
  const members = [...card.moves, ...card.fixes];
  const group = card.group;
  if (group === undefined) {
    return `${String(executedCount(members))} of ${moveCount(members.length)} ran: ${memberOutcomes(members).join("; ")}.`;
  }
  const byMove = new Map(members.map((move) => [move.move, move] as const));
  const executed = new Set(
    group.actions.filter((action) => action.outcome === "executed").map((action) => action.move),
  );
  const stopped = new Set(
    group.actions
      .filter(
        (action) =>
          action.outcome === "failed" ||
          action.outcome === "skipped" ||
          action.outcome === "unknown",
      )
      .map((action) => action.move),
  );
  for (const move of members) {
    if (move.decision === "discarded") {
      continue;
    }
    if (move.result === "executed") {
      executed.add(move.move);
    } else if (move.result !== undefined) {
      stopped.add(move.move);
    }
  }
  for (const move of stopped) {
    executed.delete(move);
  }
  const outcomes = group.actions.map(
    (action) =>
      `${groupActionLabel(action, byMove.get(action.move))} ${actionOutcome(action.outcome)}`,
  );
  const listed = outcomes.length > 0 ? outcomes : memberOutcomes(members);
  return `${String(executed.size)} of ${moveCount(group.moves.length)} ran: ${listed.join("; ")}.`;
}

function memberOutcomes(moves: ReadonlyArray<TransactionMoveView>): ReadonlyArray<string> {
  return moves.flatMap((move): ReadonlyArray<string> => {
    if (move.decision === "discarded") {
      return [];
    }
    return [`${moveSummary(move)} ${moveResultPhrase(move.result)}`];
  });
}

function moveResultPhrase(result: TransactionMoveView["result"]): string {
  switch (result) {
    case "executed":
      return "ran";
    case "failed":
      return "failed";
    case "skipped":
      return "was skipped";
    case "unknown":
      return "has an unknown outcome";
    case "pending":
      return "is waiting on the league";
    case "withdrawn":
    case "expired":
    case undefined:
      return "did not run";
  }
}

function actionOutcome(outcome: TransactionPlanGroupView["actions"][number]["outcome"]): string {
  switch (outcome) {
    case "executed":
      return "ran";
    case "failed":
      return "failed";
    case "skipped":
      return "was skipped";
    case "unknown":
      return "has an unknown outcome";
    case "pending":
      return "is waiting on the league";
  }
}

function groupActionLabel(
  action: TransactionPlanGroupView["actions"][number],
  move: TransactionMoveView | undefined,
): string {
  if (move !== undefined) {
    return moveSummary(move);
  }
  const player = action.player ?? "this player";
  switch (action.action) {
    case "add":
      return `Add ${player}`;
    case "drop":
      return `Drop ${player}`;
    case "reserve_move":
    case "slot_move":
      return action.toSlot === undefined ? `Move ${player}` : `Move ${player} to ${action.toSlot}`;
  }
}

function executedCount(moves: ReadonlyArray<TransactionMoveView>): number {
  return moves.filter((move) => move.decision !== "discarded" && move.result === "executed").length;
}

function groupCount(card: RunGroupCardView): number {
  return card.group?.moves.length ?? cardCount(card);
}

function cardCount(card: RunGroupCardView): number {
  return card.moves.length + card.fixes.length;
}

function groupStateTone(state: GroupState): "accent" | "neutral" {
  return state === "Undecided" || state === "Confirmed" ? "accent" : "neutral";
}

function isConfirmed(move: TransactionMoveView): boolean {
  return move.decision === "now" || move.decision === "confirmed";
}

function cardTitle(card: RunGroupCardView): string {
  if (card.group?.label !== undefined) {
    return card.group.label;
  }
  if (card.moves.length === 1) {
    const only = card.moves[0];
    return only === undefined ? "This move" : moveSummary(only);
  }
  return `Group of ${moveCount(card.moves.length)}`;
}

function runCards(
  moves: ReadonlyArray<TransactionMoveView>,
  groups: ReadonlyArray<TransactionPlanGroupView>,
  today: boolean,
): ReadonlyArray<RunGroupCardView> {
  const byGroup = new Map(groups.map((group) => [group.group, group] as const));
  const fixesByFunded = new Map<string, Array<TransactionMoveView>>();
  const leads = new Map<string, Array<TransactionMoveView>>();
  for (const move of moves) {
    const group = move.group === undefined ? undefined : byGroup.get(move.group);
    if (group?.fixesFor !== undefined) {
      const held = fixesByFunded.get(group.fixesFor) ?? [];
      held.push(move);
      fixesByFunded.set(group.fixesFor, held);
      continue;
    }
    const key = move.group ?? move.move;
    const held = leads.get(key) ?? [];
    held.push(move);
    leads.set(key, held);
  }
  const cards: Array<RunGroupCardView> = [];
  for (const [key, members] of leads) {
    const ordered = [...members].sort((left, right) => left.position - right.position);
    const lead = ordered[0];
    if (lead === undefined) {
      continue;
    }
    const group = byGroup.get(key);
    cards.push({
      key,
      lead,
      moves: ordered,
      fixes: ordered.flatMap((move) => fixesByFunded.get(move.move) ?? []),
      today,
      ...(group === undefined ? {} : { group }),
    });
  }
  for (const [funded, fixes] of fixesByFunded) {
    if (cards.some((card) => card.moves.some((move) => move.move === funded))) {
      continue;
    }
    const ordered = [...fixes].sort((left, right) => left.position - right.position);
    const lead = ordered[0];
    if (lead !== undefined) {
      cards.push({
        key: `fixes:${funded}`,
        lead,
        moves: ordered,
        fixes: [],
        today,
      });
    }
  }
  return cards.sort(
    (left, right) =>
      cardPosition(left) - cardPosition(right) ||
      left.lead.team.name.localeCompare(right.lead.team.name),
  );
}

function cardPosition(card: RunGroupCardView): number {
  return Math.min(
    ...card.moves.map((move) => move.position),
    ...card.fixes.map((move) => move.position),
  );
}

type TransactionsPageProps = {
  readonly remote: TransactionRemote;
};

type SectionProps = {
  readonly page: TransactionsPageController;
};

type RemoteSectionProps = SectionProps & {
  readonly remote: TransactionRemote;
};

type DaySectionProps = RemoteSectionProps & {
  readonly day: TransactionMoveDayView | undefined;
  readonly today: boolean;
};

type TeamGroupsProps = {
  readonly card: TransactionMoveTeamDayView;
  readonly page: TransactionsPageController;
  readonly remote: TransactionRemote;
  readonly today: boolean;
};

type GroupPanelProps = {
  readonly card: RunGroupCardView;
  readonly page: TransactionsPageController;
  readonly confirmation: GroupConfirmation;
  readonly facts: TransactionTeamFactsView | undefined;
};

type GroupMoveRowProps = {
  readonly move: TransactionMoveView;
  readonly number: number;
  readonly page: TransactionsPageController;
  readonly today: boolean;
  readonly waiting: boolean;
  readonly working: boolean;
};

type EarlierRowProps = {
  readonly move: TransactionMoveView;
};

type RunGroupCardView = {
  readonly key: string;
  readonly lead: TransactionMoveView;
  readonly moves: ReadonlyArray<TransactionMoveView>;
  readonly fixes: ReadonlyArray<TransactionMoveView>;
  readonly today: boolean;
  readonly group?: TransactionPlanGroupView;
};

type StatusLine = {
  readonly text: string;
  readonly tone: "muted" | "faint";
};

type GroupState =
  | "Undecided"
  | "Confirmed"
  | "Running"
  | "Ran"
  | "Partly ran"
  | "Blocked"
  | "Discarded";
