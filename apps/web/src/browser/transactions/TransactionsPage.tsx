import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Badge } from "#browser/shared-ui/Badge.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Card, CardNote } from "#browser/shared-ui/Card.tsx";
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
  TransactionTeamFactsView,
} from "#contracts/connections/transactionContract.ts";

import { TeamPlaces } from "./TeamPlaces";
import {
  cardIsSettled,
  cardMembers,
  cardNeedsDecision,
  cardNextAction,
  cardStatus,
  cardTitle,
  groupCards,
} from "./transactionCards";
import type { CardStatus, GroupCard } from "./transactionCards";
import {
  moveCount,
  moveSummary,
  openMoveCount,
  readableReason,
  teamCount,
} from "./transactionCopy";
import { TransactionAuthenticationFailure } from "./transactionFailure";
import type { TransactionRemote } from "./transactionRemote";
import {
  discardLine,
  moveOutcomeLabel,
  resultDetailLine,
  resultTimeLine,
  scheduledMoment,
  submittedLine,
  timingLine,
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
        lede="Run a group now, or schedule it for a later day."
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
              <EarlierSection page={page} remote={props.remote} />
            </Stack>
          </Show>
        </Show>
      </Page>
    </AppShell>
  );
}

function SummaryKicker(props: SectionProps): JSX.Element {
  const todayMoves = (): number =>
    dayTeams(
      props.page,
      props.page.days().find((day) => day.today),
    )
      .flatMap((entry) => entry.cards)
      .filter(cardNeedsDecision)
      .flatMap(cardMembers).length;
  return (
    <Inline gap="sm">
      <Text as="span" numeric size="label">
        {openMoveCount(props.page.counts().open)}
      </Text>
      <Text as="span" numeric size="label">
        {`· ${String(todayMoves())} today · ${String(props.page.counts().saved)} later · ${teamCount(props.page.teamCount())}`}
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
        <EmptyState title="Nothing scheduled">
          A move you set for a later day appears here with that day.
        </EmptyState>
      </Show>
    </>
  );
}

function DaySection(props: DaySectionProps): JSX.Element {
  const titleId = (): string =>
    `transactions-day-${props.today ? "today" : (props.day?.day ?? "none")}`;
  const teams = (): ReadonlyArray<TeamCardsView> =>
    dayTeams(props.page, props.day)
      .map((entry) => ({
        team: entry.team,
        cards: props.today ? entry.cards.filter((card) => !cardIsSettled(card)) : entry.cards,
      }))
      .filter((entry) => entry.cards.length > 0);
  const moves = (): ReadonlyArray<TransactionMoveView> =>
    teams().flatMap((entry) => entry.cards.flatMap(cardMembers));
  const decisionMoves = (): ReadonlyArray<TransactionMoveView> =>
    teams()
      .flatMap((entry) => entry.cards)
      .filter(cardNeedsDecision)
      .flatMap(cardMembers);
  const title = (): string => {
    if (props.today) {
      return "Today";
    }
    return props.day?.day === undefined ? "No day set" : formatCalendarDate(props.day.day);
  };
  const aside = (): string | undefined =>
    !props.today || props.day?.day === undefined ? undefined : formatCalendarDate(props.day.day);
  const countLabel = (): string => {
    if (!props.today) {
      return moveCount(moves().length);
    }
    return moves().length === 0 ? "Nothing for today" : `${moveCount(moves().length)} for today`;
  };
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
      <Show when={decisionMoves().length > 0}>
        <Stack gap="2xs">
          <Text size="caption" tone="muted">
            {`${moveCount(decisionMoves().length)} still ${decisionMoves().length === 1 ? "needs" : "need"} your decision.`}
          </Text>
          <Text size="caption" tone="muted">
            Nothing runs until you decide.
          </Text>
        </Stack>
      </Show>
      <Show
        fallback={
          <Show when={props.today}>
            <EmptyState title="Nothing needs you today">
              Moves you already submitted appear under Earlier.
            </EmptyState>
          </Show>
        }
        when={teams().length > 0}
      >
        <Stack gap="2xl">
          <For each={teams()}>
            {(entry) => (
              <TeamCards
                cards={entry.cards}
                page={props.page}
                remote={props.remote}
                team={entry.team}
                today={props.today}
              />
            )}
          </For>
        </Stack>
      </Show>
    </Stack>
  );
}

function TeamCards(props: TeamCardsProps): JSX.Element {
  const confirmation = useGroupConfirmation({
    team: () => props.team.id,
    remote: () => props.remote,
    page: () => props.page,
    today: () => props.today,
  });
  const facts = (): TransactionTeamFactsView | undefined =>
    props.page.teamFacts().get(props.team.id);
  return (
    <For each={props.cards}>
      {(card) => (
        <GroupPanel card={card} confirmation={confirmation} facts={facts()} page={props.page} />
      )}
    </For>
  );
}

function GroupPanel(props: GroupPanelProps): JSX.Element {
  const team = (): TransactionMoveView["team"] => props.card.lead.team;
  const members = (): ReadonlyArray<TransactionMoveView> => cardMembers(props.card);
  const status = (): CardStatus => cardStatus(props.card);
  const headingId = (): string => `transactions-panel-${props.card.lead.team.id}-${props.card.key}`;
  const working = (): boolean =>
    props.confirmation.pending() &&
    members().every((move) => props.confirmation.pendingMoves().includes(move.move));
  const confirmable = (): boolean =>
    members().every((move) => move.validation.status === "current" && move.result === undefined);
  const opened = (): boolean =>
    props.card.group === undefined || props.card.group.status === "ready";
  const showControl = (): boolean => status().kind === "needs-decision" && opened();
  const runsLater = (): boolean => {
    const lead = props.card.lead;
    return lead.runsOn !== undefined && lead.runDay !== undefined && lead.runsOn > lead.runDay;
  };
  const runsNow = (): boolean => props.card.today && !runsLater();
  const controlLabel = (): string => (runsNow() ? "Run now" : scheduleActionLabel(props.card));
  const workingLabel = (): string => (runsNow() ? "Running now" : "Scheduling");
  const actionLabel = (): string => `${controlLabel()}: ${cardTitle(props.card)}`;
  const statusLabel = (): string => {
    const held = status();
    switch (held.kind) {
      case "needs-decision":
        return "Needs your decision";
      case "scheduled":
        return `Scheduled for ${scheduledMoment(held.runDay, props.page.nextRunAt())}`;
      case "waiting":
        return "Waiting for the league";
      case "running":
        return "Running";
      case "partly-ran":
        return "Partly ran";
      case "blocked":
        return "Blocked";
      case "failed":
        return "Failed";
      case "ran":
        return ranLabel(props.card);
    }
  };
  const nextAction = (): ReturnType<typeof cardNextAction> => cardNextAction(props.card);
  const submitted = (): string | undefined => {
    const member = members().find((move) => move.confirmation !== undefined);
    return member === undefined ? undefined : submittedLine(member, props.page.nextRunAt());
  };
  const explanation = (): string | undefined => {
    const detail = props.card.group?.detail;
    if (detail === undefined || status().kind === "waiting" || detail === nextAction()?.text) {
      return undefined;
    }
    return detail;
  };
  const reasons = (): ReadonlyArray<string> => reasonLines(props.card);
  const facts = (): TransactionTeamFactsView | undefined => {
    const kind = status().kind;
    return props.facts !== undefined &&
      (kind === "blocked" || kind === "failed" || kind === "partly-ran")
      ? props.facts
      : undefined;
  };
  const hasDetail = (): boolean =>
    reasons().length > 0 || explanation() !== undefined || facts() !== undefined;
  return (
    <Card
      badge={<Badge tone={statusTone(status())}>{working() ? "Running" : statusLabel()}</Badge>}
      footer={
        showControl() ? (
          <Button
            variant="primary"
            disabled={!confirmable() || props.confirmation.pending()}
            state={working() ? "working" : "idle"}
            aria-label={actionLabel()}
            onClick={() => props.confirmation.start(members())}
          >
            {working() ? workingLabel() : controlLabel()}
          </Button>
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
      <Show when={nextAction()}>
        {(line) => (
          <Text size="caption" tone={line().tone}>
            {line().text}
          </Text>
        )}
      </Show>
      <Show when={submitted()}>
        {(line) => (
          <Text size="caption" tone="muted">
            {line()}
          </Text>
        )}
      </Show>
      <QueueList>
        <For each={props.card.moves}>
          {(move, index) => (
            <GroupMoveRow
              move={move}
              number={index() + 1}
              page={props.page}
              today={props.card.today}
              working={props.confirmation.pending()}
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
                working={props.confirmation.pending()}
              />
            )}
          </For>
        </Show>
      </QueueList>
      <Show when={hasDetail()}>
        <CardNote>
          <Disclosure summary="Why these moves">
            <Stack gap="md">
              <For each={reasons()}>
                {(line) => (
                  <Text size="caption" tone="muted">
                    {line}
                  </Text>
                )}
              </For>
              <Show when={explanation()}>
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
                Saving changes the day this move runs and clears your decision.
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
      <Show when={props.move.placement}>
        {(placement) => (
          <Text size="caption" tone="muted">
            {placement().detail}
          </Text>
        )}
      </Show>
      <Show when={timingLine(props.move)}>
        {(line) => (
          <Text size="caption" tone="muted">
            {line()}
          </Text>
        )}
      </Show>
      <MoveCheckNote move={props.move} />
    </QueueListItem>
  );
}

function MoveCheckNote(props: { readonly move: TransactionMoveView }): JSX.Element {
  const note = (): string | undefined =>
    props.move.check.status === "last_checked" ? props.move.check.note : undefined;
  const checked = (): string | undefined =>
    props.move.check.status !== "last_checked" &&
    props.move.validation.status !== "current" &&
    props.move.validation.checkedAt !== undefined
      ? `Checked ${formatDateTime(props.move.validation.checkedAt)}.`
      : undefined;
  return (
    <Show when={note() ?? checked()}>
      {(held) => (
        <Text size="caption" tone="faint">
          {held()}
        </Text>
      )}
    </Show>
  );
}

function EarlierSection(props: RemoteSectionProps): JSX.Element {
  const settled = (): ReadonlyArray<TeamCardsView> => {
    const today = props.page.days().find((day) => day.today);
    return dayTeams(props.page, today)
      .map((entry) => ({ team: entry.team, cards: entry.cards.filter(cardIsSettled) }))
      .filter((entry) => entry.cards.length > 0);
  };
  const count = (): number =>
    props.page.earlierCount() +
    settled().flatMap((entry) => entry.cards.flatMap(cardMembers)).length;
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
      <Show when={count() > 0}>
        <Text size="caption" tone="muted">
          {moveCount(count())}
        </Text>
      </Show>
      <Show when={props.page.earlierEnabled()}>
        <Show when={settled().length > 0}>
          <Stack gap="2xl">
            <For each={settled()}>
              {(entry) => (
                <TeamCards
                  cards={entry.cards}
                  page={props.page}
                  remote={props.remote}
                  team={entry.team}
                  today
                />
              )}
            </For>
          </Stack>
        </Show>
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
                  message: "We could not load the earlier moves. Try again.",
                  recovery: { label: "Try again", onAction: props.page.retryEarlier },
                }}
              />
            </Show>
          }
          when={!props.page.earlierFailure()}
        >
          <Show
            fallback={
              <Show when={settled().length === 0}>
                <EmptyState title="No earlier moves">
                  Moves that ran, failed, were discarded, or wait for the league appear here.
                </EmptyState>
              </Show>
            }
            when={props.page.earlier().length > 0}
          >
            <RuleList>
              <For each={props.page.earlier()}>
                {(move) => <EarlierRow move={move} nextRunAt={props.page.nextRunAt()} />}
              </For>
            </RuleList>
            <Show when={props.page.hasMoreEarlier()}>
              <Inline gap="sm">
                <Button
                  variant="secondary"
                  state={props.page.fetchingMoreEarlier() ? "working" : "idle"}
                  onClick={props.page.showMoreEarlier}
                >
                  {props.page.fetchingMoreEarlier() ? "Loading earlier moves" : "Load more"}
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
  const submitted = (): string | undefined => submittedLine(props.move, props.nextRunAt);
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
        <Show when={submitted()}>
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

function statusTone(status: CardStatus): "accent" | "neutral" {
  return status.kind === "needs-decision" || status.kind === "scheduled" ? "accent" : "neutral";
}

function scheduleActionLabel(card: GroupCard): string {
  const day = card.lead.runsOn ?? card.lead.runDay;
  return day === undefined ? "Schedule" : `Schedule for ${formatCalendarDate(day)}`;
}

function ranLabel(card: GroupCard): string {
  const first = cardMembers(card)[0];
  return first === undefined ? "Ran" : (moveOutcomeLabel(first) ?? "Ran");
}

function reasonLines(card: GroupCard): ReadonlyArray<string> {
  const members = cardMembers(card);
  return members.flatMap((move) => {
    const reason = readableReason(move.reason);
    if (reason.length === 0) {
      return [];
    }
    return [members.length === 1 ? reason : `${moveSummary(move)}: ${reason}`];
  });
}

function dayTeams(
  page: TransactionsPageController,
  day: TransactionMoveDayView | undefined,
): ReadonlyArray<TeamCardsView> {
  const today = day?.today === true;
  return (day?.teams ?? []).map((team) => ({
    team: team.team,
    cards: groupCards({ moves: team.moves, groups: page.groups(), today }),
  }));
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

type TeamCardsView = {
  readonly team: TransactionMoveTeamDayView["team"];
  readonly cards: ReadonlyArray<GroupCard>;
};

type TeamCardsProps = {
  readonly cards: ReadonlyArray<GroupCard>;
  readonly page: TransactionsPageController;
  readonly remote: TransactionRemote;
  readonly team: TransactionMoveTeamDayView["team"];
  readonly today: boolean;
};

type GroupPanelProps = {
  readonly card: GroupCard;
  readonly page: TransactionsPageController;
  readonly confirmation: GroupConfirmation;
  readonly facts: TransactionTeamFactsView | undefined;
};

type GroupMoveRowProps = {
  readonly move: TransactionMoveView;
  readonly number: number;
  readonly page: TransactionsPageController;
  readonly today: boolean;
  readonly working: boolean;
};

type EarlierRowProps = {
  readonly move: TransactionMoveView;
  readonly nextRunAt: string | undefined;
};
