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
  TransactionWaiverRuleView,
} from "#contracts/connections/transactionContract.ts";

import { TeamPlaces } from "./TeamPlaces";
import {
  cardAction,
  cardIsSettled,
  cardMembers,
  cardNeedsDecision,
  cardNextAction,
  cardStatus,
  cardTitle,
  dayTeamCards,
} from "./transactionCards";
import type { CardAction, CardStatus, GroupCard } from "./transactionCards";
import {
  fallbackPlanDetail,
  fallbackPlanLine,
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
  waiverTimingLine,
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
    dayTeamCards(
      props.page.days().find((day) => day.today),
      props.page.groups(),
    )
      .flatMap((entry) => entry.cards)
      .filter(cardNeedsDecision)
      .flatMap(cardMembers).length;
  return (
    <Inline gap="sm">
      <Text as="span" numeric type="label">
        {openMoveCount(props.page.counts().open)}
      </Text>
      <Text as="span" numeric type="label">
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
    dayTeamCards(props.day, props.page.groups())
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
          <Text as="span" numeric type="label" tone="faint">
            {countLabel()}
          </Text>
        }
        aside={
          <Show when={aside()}>
            {(held) => (
              <Text as="span" numeric type="label" tone="muted">
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
          <Text type="meta" tone="muted">
            {`${moveCount(decisionMoves().length)} still ${decisionMoves().length === 1 ? "needs" : "need"} your decision.`}
          </Text>
          <Text type="meta" tone="muted">
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
  let explanationElement: HTMLDetailsElement | undefined;
  const team = (): TransactionMoveView["team"] => props.card.lead.team;
  const members = (): ReadonlyArray<TransactionMoveView> => cardMembers(props.card);
  const status = (): CardStatus => cardStatus(props.card);
  const action = (): CardAction => cardAction(props.card);
  const headingId = (): string => `transactions-panel-${props.card.lead.team.id}-${props.card.key}`;
  const working = (): boolean =>
    props.confirmation.pending() &&
    members().every((move) => props.confirmation.pendingMoves().includes(move.move));
  const confirmable = (): boolean =>
    members().every((move) => move.validation.status === "current" && move.result === undefined);
  const opened = (): boolean =>
    props.card.group === undefined || props.card.group.status === "ready";
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
        return props.card.lead.kind === "waiver_claim"
          ? `Scheduled for ${formatCalendarDate(held.runDay)}`
          : `Scheduled for ${scheduledMoment(held.runDay, props.page.nextRunAt())}`;
      case "waiting":
        return "Waiting for the league";
      case "with-league":
        return "With the league";
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
    const group = props.card.group;
    const detail = group?.detail;
    if (detail === undefined || status().kind === "waiting" || detail === nextAction()?.text) {
      return undefined;
    }
    if (action().kind === "none" && group?.cure !== undefined && detail.endsWith(group.cure)) {
      return detail.slice(0, -group.cure.length).trimEnd();
    }
    return detail;
  };
  const reasons = (): ReadonlyArray<string> => reasonLines(props.card);
  const fallbackMoves = (): ReadonlyArray<TransactionMoveView> =>
    members().filter((move) => move.fallbacks.length > 0);
  const facts = (): TransactionTeamFactsView | undefined => {
    const kind = status().kind;
    return props.facts !== undefined &&
      (kind === "blocked" || kind === "failed" || kind === "partly-ran")
      ? props.facts
      : undefined;
  };
  const hasDetail = (): boolean =>
    reasons().length > 0 ||
    explanation() !== undefined ||
    facts() !== undefined ||
    fallbackMoves().length > 0;
  const footer = (): JSX.Element | undefined => {
    const held = action();
    switch (held.kind) {
      case "decide":
        if (!opened()) {
          return undefined;
        }
        return (
          <Button
            variant="primary"
            disabled={!confirmable() || props.confirmation.pending()}
            state={working() ? "working" : "idle"}
            aria-label={actionLabel()}
            onClick={() => props.confirmation.start(members())}
          >
            {working() ? workingLabel() : controlLabel()}
          </Button>
        );
      case "cure":
        return (
          <Button
            variant="primary"
            disabled={props.page.addingFixes() !== undefined}
            state={props.page.addingFixes() === props.card.lead.move ? "working" : "idle"}
            aria-label={`Add roster fixes: ${cardTitle(props.card)}`}
            onClick={() => props.page.addFixes(props.card.lead)}
          >
            {props.page.addingFixes() === props.card.lead.move ? "Adding" : "Add roster fixes"}
          </Button>
        );
      case "retry":
        return (
          <Button
            variant="primary"
            disabled={props.page.retryingMove() !== undefined}
            state={props.page.retryingMove() === props.card.lead.move ? "working" : "idle"}
            aria-label={`Retry: ${cardTitle(props.card)}`}
            onClick={() => props.page.retryMove(props.card.lead)}
          >
            {props.page.retryingMove() === props.card.lead.move ? "Retrying" : "Retry"}
          </Button>
        );
      case "discard":
        return held.moves.length > 1 ||
          status().kind !== "blocked" ||
          held.moves.some((move) => move.result !== undefined) ? (
          <Button
            variant="secondary"
            disabled={props.page.discardingGroup() !== undefined}
            state={props.page.discardingGroup() === props.card.lead.move ? "working" : "idle"}
            aria-label={`Discard remaining: ${cardTitle(props.card)}`}
            onClick={() => props.page.discardGroup(props.card.lead)}
          >
            {props.page.discardingGroup() === props.card.lead.move
              ? "Discarding"
              : "Discard remaining"}
          </Button>
        ) : undefined;
      case "dependency":
        return (
          <Inline gap="sm">
            <Button
              variant="link"
              aria-label={`Open: ${cardTitle(props.card)}`}
              onClick={() => {
                if (explanationElement !== undefined) {
                  explanationElement.open = true;
                }
              }}
            >
              Open
            </Button>
            <Show when={held.moves.length > 0}>
              <Button
                variant="secondary"
                disabled={props.page.discardingGroup() !== undefined}
                state={props.page.discardingGroup() === props.card.lead.move ? "working" : "idle"}
                aria-label={`Discard group: ${cardTitle(props.card)}`}
                onClick={() => props.page.discardGroup(props.card.lead)}
              >
                {props.page.discardingGroup() === props.card.lead.move
                  ? "Discarding"
                  : "Discard group"}
              </Button>
            </Show>
          </Inline>
        );
      case "none":
        return undefined;
    }
  };
  return (
    <Card
      badge={<Badge tone={statusTone(status())}>{working() ? "Running" : statusLabel()}</Badge>}
      footer={footer()}
      header={
        <Heading id={headingId()} level={3} type="card-title">
          {team().name}
        </Heading>
      }
      labelledBy={headingId()}
      meta={
        <>
          <Text as="span" type="meta" tone="muted">
            {leagueDisplayName(team().league)} · {sportDisplayName(team().sport)}
          </Text>
          <Show when={props.card.group?.label}>
            {(label) => (
              <Text as="span" type="meta" tone="faint">
                {label()}
              </Text>
            )}
          </Show>
        </>
      }
    >
      <Show when={nextAction()}>
        {(line) => (
          <Text type="meta" tone={line().tone}>
            {line().text}
          </Text>
        )}
      </Show>
      <Show when={submitted()}>
        {(line) => (
          <Text type="meta" tone="muted">
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
            <Text type="meta" tone="muted">
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
          <Stack gap="md">
            <Show
              when={reasons().length > 0 || explanation() !== undefined || facts() !== undefined}
            >
              <Disclosure
                ref={(element) => (explanationElement = element)}
                summary="Why these moves"
              >
                <Stack gap="md">
                  <For each={reasons()}>
                    {(line) => (
                      <Text type="meta" tone="muted">
                        {line}
                      </Text>
                    )}
                  </For>
                  <Show when={explanation()}>
                    {(text) => (
                      <Text type="meta" tone="muted">
                        {text()}
                      </Text>
                    )}
                  </Show>
                  <Show when={facts()}>{(held) => <TeamPlaces facts={held()} />}</Show>
                </Stack>
              </Disclosure>
            </Show>
            <For each={fallbackMoves()}>
              {(move) => (
                <Disclosure summary={fallbackPlanLine(move) ?? "Fallbacks"}>
                  <Stack gap="md">
                    <For each={fallbackPlanDetail(move)}>
                      {(line) => (
                        <Text type="meta" tone="muted">
                          {line}
                        </Text>
                      )}
                    </For>
                  </Stack>
                </Disclosure>
              )}
            </For>
          </Stack>
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
              <Text type="meta" tone="muted">
                Saving changes the day this move runs and clears your decision.
              </Text>
              <Show when={props.page.editingError()}>
                {(error) => (
                  <Text type="meta" tone="danger">
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
      <Text type="body-strong">{moveSummary(props.move)}</Text>
      <Show when={props.move.placement}>
        {(placement) => (
          <Text type="meta" tone="muted">
            {placement().detail}
          </Text>
        )}
      </Show>
      <Show when={timingLine(props.move)}>
        {(line) => (
          <Text type="meta" tone="muted">
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
        <Text type="meta" tone="faint">
          {held()}
        </Text>
      )}
    </Show>
  );
}

function EarlierSection(props: RemoteSectionProps): JSX.Element {
  const settled = (): ReadonlyArray<TeamCardsView> => {
    const today = props.page.days().find((day) => day.today);
    return dayTeamCards(today, props.page.groups())
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
        <Text type="meta" tone="muted">
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
                {(move) => (
                  <EarlierRow
                    move={move}
                    nextRunAt={props.page.nextRunAt()}
                    waiver={props.page.teamFacts().get(move.team.id)?.waiver}
                  />
                )}
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
  const waiver = (): string | undefined =>
    props.move.phase === "with_league" ? waiverTimingLine(props.waiver) : undefined;
  return (
    <RuleListItem layout="stack" dense>
      <Stack gap="2xs">
        <Inline gap="sm" align="baseline">
          <Badge tone={outcomeBadgeTone(props.move)}>
            {moveOutcomeLabel(props.move) ?? "Ended"}
          </Badge>
          <Text type="body-strong">{moveSummary(props.move)}</Text>
        </Inline>
        <Text type="meta" tone="muted">
          {props.move.team.name} · {leagueDisplayName(props.move.team.league)} ·{" "}
          {sportDisplayName(props.move.team.sport)}
        </Text>
        <Show when={submitted()}>
          {(line) => (
            <Text type="meta" tone="muted">
              {line()}
            </Text>
          )}
        </Show>
        <Show when={waiver()}>
          {(line) => (
            <Text type="meta" tone="muted">
              {line()}
            </Text>
          )}
        </Show>
        <Show when={discarded()}>
          {(line) => (
            <Text type="meta" tone="faint">
              {line()}
            </Text>
          )}
        </Show>
        <Show when={result()}>
          {(line) => (
            <Text type="meta" tone="muted">
              {line()}
            </Text>
          )}
        </Show>
        <Show when={resultTime()}>
          {(line) => (
            <Text type="meta" tone="faint">
              {line()}
            </Text>
          )}
        </Show>
        <Show when={fallbackPlanLine(props.move)}>
          {(summary) => (
            <Disclosure summary={summary()}>
              <Stack gap="md">
                <For each={fallbackPlanDetail(props.move)}>
                  {(line) => (
                    <Text type="meta" tone="muted">
                      {line}
                    </Text>
                  )}
                </For>
              </Stack>
            </Disclosure>
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
  readonly waiver: TransactionWaiverRuleView | undefined;
};
