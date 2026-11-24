import { EffectArray } from "@lineupkeep/collections";
import { EffectOption } from "@lineupkeep/collections";
import { EffectString } from "@lineupkeep/collections";
import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionBar } from "#browser/shared-ui/ActionBar.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Badge } from "#browser/shared-ui/Badge.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { Card, CardNote } from "#browser/shared-ui/Card.tsx";
import { EmptyState } from "#browser/shared-ui/CollectionState.tsx";
import { Disclosure } from "#browser/shared-ui/Disclosure.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { formatCalendarDate, formatDateTime } from "#browser/shared-ui/formatTime.ts";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { IconButton } from "#browser/shared-ui/IconButton.tsx";
import { ChevronDownIcon, ChevronUpIcon } from "#browser/shared-ui/icons.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { QueueList, QueueListItem, QueueListNote } from "#browser/shared-ui/QueueList.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { ListSkeleton, TransactionsSkeleton } from "#browser/shared-ui/Skeleton.tsx";
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
  cardIsOpenToday,
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
  originalClaimLine,
  readableReason,
} from "./transactionCopy";
import { TransactionAuthenticationFailure } from "./transactionFailure";
import { TransactionOutcomeIcon } from "./TransactionOutcomeIcon";
import type { TransactionRemote } from "./transactionRemote";
import {
  discardLine,
  moveOutcomeLabel,
  plannedMoment,
  resultDetailLine,
  resultTimeLine,
  submittedLine,
  timingLine,
  waiverTimingLine,
} from "./transactionTimes";
import { useGroupConfirmation } from "./useGroupConfirmation";
import { useMinimumLoading } from "./useMinimumLoading";
import { useTransactionsPage } from "./useTransactionsPage";
import type { TransactionsPageController } from "./useTransactionsPage";

function arrayValueIsArray<A>(value: A | ReadonlyArray<A>): value is ReadonlyArray<A> {
  return EffectArray.isArray(value);
}

export function TransactionsPage(props: TransactionsPageProps): JSX.Element {
  const page = useTransactionsPage({ remote: () => props.remote });

  return (
    <AppShell>
      <Page kicker={<SummaryKicker page={page} />} title="Transactions">
        <Show fallback={<TransactionsSkeleton />} when={!page.isLoading()}>
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
    EffectArray.flatMap(
      EffectArray.filter(
        EffectArray.flatMap(
          dayTeamCards(
            EffectOption.getOrUndefined(
              EffectArray.findFirst(props.page.days(), (day) => day.today),
            ),
            props.page.groups(),
          ),
          (entry) => {
            const flatMapped1 = entry.cards;
            return arrayValueIsArray(flatMapped1) ? flatMapped1 : [flatMapped1];
          },
        ),
        cardIsOpenToday,
      ),
      cardMembers,
    ).length;
  return (
    <Inline gap="sm">
      <Text as="span" numeric type="label">
        {openMoveCount(props.page.counts().open)}
      </Text>
      <Text as="span" numeric type="label">
        {`· ${String(todayMoves())} today · ${String(props.page.counts().saved)} later`}
      </Text>
    </Inline>
  );
}

function OpenDays(props: RemoteSectionProps): JSX.Element {
  const today = (): TransactionMoveDayView | undefined =>
    EffectOption.getOrUndefined(EffectArray.findFirst(props.page.days(), (day) => day.today));
  const later = (): ReadonlyArray<TransactionMoveDayView> =>
    EffectArray.filter(props.page.days(), (day) => !day.today);
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
  const teams = (): ReadonlyArray<TeamCardsView> => {
    const groups = props.page.groups();
    const today = props.today;
    return EffectArray.filter(
      EffectArray.map(dayTeamCards(props.day, groups), (entry) => ({
        team: entry.team,
        cards: today
          ? EffectArray.filter(entry.cards, (card) => !cardIsSettled(card))
          : entry.cards,
      })),
      (entry) => entry.cards.length > 0,
    );
  };
  const moves = (): ReadonlyArray<TransactionMoveView> =>
    EffectArray.flatMap(teams(), (entry) => {
      const flatMapped2 = EffectArray.flatMap(entry.cards, cardMembers);
      return arrayValueIsArray(flatMapped2) ? flatMapped2 : [flatMapped2];
    });
  const decisionMoves = (): ReadonlyArray<TransactionMoveView> =>
    EffectArray.flatMap(
      EffectArray.filter(
        EffectArray.flatMap(teams(), (entry) => {
          const flatMapped3 = entry.cards;
          return arrayValueIsArray(flatMapped3) ? flatMapped3 : [flatMapped3];
        }),
        cardIsOpenToday,
      ),
      cardMembers,
    );
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
  const facts = (): TransactionTeamFactsView | undefined =>
    props.page.teamFacts().get(props.team.id);
  return (
    <For each={props.cards}>
      {(card) => <GroupPanel card={card} facts={facts()} page={props.page} remote={props.remote} />}
    </For>
  );
}

function GroupPanel(props: GroupPanelProps): JSX.Element {
  let explanationElement: HTMLDetailsElement | undefined;
  const confirmation = useGroupConfirmation({
    team: () => props.card.lead.team.id,
    remote: () => props.remote,
    page: () => props.page,
    today: () => props.card.today,
  });
  const team = (): TransactionMoveView["team"] => props.card.lead.team;
  const members = (): ReadonlyArray<TransactionMoveView> => cardMembers(props.card);
  const editingMove = (): TransactionMoveView | undefined => {
    const editing = props.page.editing();
    return editing === undefined
      ? undefined
      : EffectOption.getOrUndefined(
          EffectArray.findFirst(members(), (move) => move.move === editing),
        );
  };
  const status = (): CardStatus => cardStatus(props.card);
  const action = (): CardAction => cardAction(props.card);
  const headingId = (): string => `transactions-panel-${props.card.lead.team.id}-${props.card.key}`;
  const working = (): boolean => confirmation.pending();
  const busy = (): boolean => props.page.refreshing();
  const confirmable = (): boolean =>
    !busy() &&
    EffectArray.every(
      members(),
      (move) => move.validation.status === "current" && move.result === undefined,
    );
  const opened = (): boolean =>
    props.card.group === undefined || props.card.group.status === "ready";
  const runsNow = (): boolean => props.card.today;
  const controlLabel = (): string => (runsNow() ? "Run now" : scheduleActionLabel(props.card));
  const workingLabel = (): string => (runsNow() ? "Running now" : "Scheduling");
  const actionLabel = (): string => `${controlLabel()}: ${cardTitle(props.card)}`;
  const statusLabel = (): string => {
    const held = status();
    switch (held.kind) {
      case "needs-decision":
        return "Needs your decision";
      case "scheduled":
        return held.sendsAt === undefined
          ? "Scheduled"
          : `Scheduled to run ${plannedMoment(held.sendsAt)}`;
      case "waiting":
        return held.label;
      case "running":
        return "Running";
      case "partly-ran":
        return "Partly ran";
      case "blocked":
        return "Blocked";
      case "failed":
        return held.label;
      case "ran":
        return ranLabel(props.card);
    }
  };
  const nextAction = (): ReturnType<typeof cardNextAction> => cardNextAction(props.card);
  const submitted = (): string | undefined => {
    const member = EffectOption.getOrUndefined(
      EffectArray.findFirst(members(), (move) => move.confirmation !== undefined),
    );
    return member === undefined ? undefined : submittedLine(member);
  };
  const explanation = (): string | undefined => {
    const group = props.card.group;
    const detail = group?.detail;
    if (detail === undefined || status().kind === "waiting" || detail === nextAction()?.text) {
      return undefined;
    }
    if (
      action().kind === "none" &&
      group?.cure !== undefined &&
      EffectString.endsWith(detail, group.cure)
    ) {
      return EffectString.trimEnd(EffectString.slice(detail, 0, -group.cure.length));
    }
    return detail;
  };
  const reasons = (): ReadonlyArray<string> => reasonLines(props.card);
  const fallbackMoves = (): ReadonlyArray<TransactionMoveView> =>
    EffectArray.filter(members(), (move) => move.fallbacks.length > 0);
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
  const primaryFooter = (): JSX.Element | undefined => {
    const held = action();
    switch (held.kind) {
      case "decide":
        if (!opened()) {
          return undefined;
        }
        return (
          <Button
            variant="primary"
            disabled={!confirmable() || confirmation.pending()}
            state={working() ? "working" : "idle"}
            aria-label={actionLabel()}
            onClick={() => confirmation.start(members())}
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
        return undefined;
      case "dependency":
        return (
          <Inline gap="sm">
            <Button
              variant="quiet"
              aria-label={`Open: ${cardTitle(props.card)}`}
              onClick={() => {
                if (explanationElement !== undefined) {
                  explanationElement.open = true;
                }
              }}
            >
              Open
            </Button>
          </Inline>
        );
      case "none":
        return undefined;
    }
  };
  const secondaryFooter = (): JSX.Element | undefined => {
    if (action().kind !== "decide" || !opened() || !props.card.today) {
      return undefined;
    }
    return (
      <Button
        variant="secondary"
        disabled={!confirmable() || confirmation.pending()}
        aria-label={`Schedule instead: ${cardTitle(props.card)}`}
        onClick={() => props.page.startEdit(props.card.lead)}
      >
        Schedule
      </Button>
    );
  };
  const destructiveFooter = (): JSX.Element | undefined => {
    const held = action();
    if (held.kind === "decide") {
      const moves = members();
      const only = moves.length === 1 ? moves[0] : undefined;
      return (
        <Button
          variant="quiet"
          tone="danger"
          disabled={
            props.page.discarding() !== undefined || props.page.discardingGroup() !== undefined
          }
          state={
            (only !== undefined && props.page.discarding() === only.move) ||
            props.page.discardingGroup() === props.card.lead.move
              ? "working"
              : "idle"
          }
          aria-label={
            only === undefined
              ? `Discard group: ${cardTitle(props.card)}`
              : `Discard: ${cardTitle(props.card)}`
          }
          onClick={() => {
            if (only === undefined) {
              props.page.discardGroup(props.card.lead);
            } else {
              props.page.discardMove(only);
            }
          }}
        >
          {only === undefined ? "Discard group" : "Discard"}
        </Button>
      );
    }
    if (held.kind === "discard" || (held.kind === "dependency" && held.moves.length > 0)) {
      const remaining = held.kind === "discard";
      return (
        <Button
          variant="quiet"
          tone="danger"
          disabled={props.page.discardingGroup() !== undefined}
          state={props.page.discardingGroup() === props.card.lead.move ? "working" : "idle"}
          aria-label={`${remaining ? "Discard remaining" : "Discard group"}: ${cardTitle(props.card)}`}
          onClick={() => props.page.discardGroup(props.card.lead)}
        >
          {props.page.discardingGroup() === props.card.lead.move
            ? "Discarding"
            : remaining
              ? "Discard remaining"
              : "Discard group"}
        </Button>
      );
    }
    return undefined;
  };
  const footer = (): JSX.Element | undefined => {
    const editing = editingMove();
    if (editing !== undefined) {
      return <ScheduleEditor move={editing} page={props.page} />;
    }
    const primary = primaryFooter();
    const destructive = destructiveFooter();
    return primary === undefined && destructive === undefined ? undefined : (
      <ActionBar
        destructive={destructive}
        disabled={busy()}
        primary={primary}
        secondary={secondaryFooter()}
      />
    );
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
              working={confirmation.pending()}
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
                working={confirmation.pending()}
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
                <Disclosure summary={fallbackSummary(move) ?? "Fallbacks"}>
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

function ScheduleEditor(props: {
  readonly move: TransactionMoveView;
  readonly page: TransactionsPageController;
}): JSX.Element {
  const invalid = (): boolean => props.move.validation.status !== "current";
  return (
    <Form gap="sm" onSubmit={() => props.page.saveEdit(props.move)}>
      <Stack gap="sm">
        <TextField
          label="Day to run"
          type="date"
          value={props.page.editingDate()}
          onInput={(event) => props.page.setEditingDate(event.currentTarget.value)}
        />
        <Text type="meta" tone="muted">
          Lineupgrade sends the move on this day. Your league applies it by its own rule. Saving
          clears your decision.
        </Text>
        <Show when={props.page.editingError()}>
          {(error) => (
            <Text type="meta" tone="danger">
              {error()}
            </Text>
          )}
        </Show>
        <ActionBar
          tertiary={
            <Button variant="quiet" onClick={props.page.cancelEdit}>
              Cancel
            </Button>
          }
          primary={
            <Button
              type="submit"
              state={props.page.saving() ? "working" : "idle"}
              disabled={
                invalid() ||
                props.page.discarding() !== undefined ||
                props.page.discardingGroup() !== undefined
              }
            >
              {props.page.saving() ? "Saving" : "Save schedule"}
            </Button>
          }
        />
      </Stack>
    </Form>
  );
}

function GroupMoveRow(props: GroupMoveRowProps): JSX.Element {
  const invalid = (): boolean => props.move.validation.status !== "current";
  const editing = (): boolean => props.page.editing() === props.move.move;
  const actionable = (): boolean =>
    props.move.result === undefined && props.move.decision !== "discarded";
  const actionsDisabled = (): boolean =>
    props.page.refreshing() ||
    props.page.saving() ||
    props.page.discarding() !== undefined ||
    props.working;
  return (
    <QueueListItem
      number={props.number}
      actions={
        <>
          <Show when={!props.today && !invalid() && actionable() && !editing()}>
            <Button
              variant="quiet"
              disabled={actionsDisabled()}
              aria-label={`Change date: ${moveSummary(props.move)}`}
              onClick={() => props.page.startEdit(props.move)}
            >
              {props.move.runDay === undefined ? "Set date" : "Change date"}
            </Button>
          </Show>
        </>
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
  const loadingVisible = useMinimumLoading(() => props.page.earlierLoading());
  const settled = (): ReadonlyArray<TeamCardsView> => {
    const today = EffectOption.getOrUndefined(
      EffectArray.findFirst(props.page.days(), (day) => day.today),
    );
    return EffectArray.filter(
      EffectArray.map(dayTeamCards(today, props.page.groups()), (entry) => ({
        team: entry.team,
        cards: EffectArray.filter(EffectArray.filter(entry.cards, cardIsSettled), (card) =>
          EffectArray.some(cardMembers(card), (move) => move.decision !== "discarded"),
        ),
      })),
      (entry) => entry.cards.length > 0,
    );
  };
  const count = (): number =>
    props.page.earlierCount() +
    EffectArray.flatMap(settled(), (entry) => {
      const flatMapped4 = EffectArray.flatMap(entry.cards, cardMembers);
      return arrayValueIsArray(flatMapped4) ? flatMapped4 : [flatMapped4];
    }).length;
  return (
    <Stack as="section" gap="md" labelledBy="earlier-title">
      <SectionTitle
        id="earlier-title"
        action={
          <IconButton
            expanded={props.page.earlierEnabled()}
            label={props.page.earlierEnabled() ? "Hide earlier moves" : "Show earlier moves"}
            onClick={props.page.toggleEarlier}
          >
            <Show fallback={<ChevronDownIcon size="md" />} when={props.page.earlierEnabled()}>
              <ChevronUpIcon size="md" />
            </Show>
          </IconButton>
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
                <ActionFeedback
                  feedback={{
                    type: "attention",
                    message: "We could not load the earlier moves. Try again.",
                    recovery: { label: "Try again", onAction: props.page.retryEarlier },
                  }}
                />
              }
              when={!props.page.earlierFailure()}
            >
              <Show
                fallback={
                  <Show when={settled().length === 0}>
                    <EmptyState title="No earlier moves">
                      Moves that ran, failed, or wait for the league appear here.
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
          }
          when={loadingVisible()}
        >
          <ListSkeleton count={count()} fade={count() > 3} label="Loading earlier moves" />
        </Show>
      </Show>
    </Stack>
  );
}

function EarlierRow(props: EarlierRowProps): JSX.Element {
  const submitted = (): string | undefined => submittedLine(props.move);
  const timing = (): string | undefined => timingLine(props.move);
  const discarded = (): string | undefined => discardLine(props.move);
  const settled = (): boolean => settledStatus(props.move.status);
  const result = (): string | undefined => (settled() ? undefined : resultDetailLine(props.move));
  const resultTime = (): string | undefined =>
    props.move.decision === "discarded" || settled() ? undefined : resultTimeLine(props.move);
  const fallback = (): string | undefined =>
    props.move.status === "claim_waiting" ||
    props.move.status === "claim_lost_retrying" ||
    props.move.status === "all_choices_failed" ||
    props.move.status === "failed"
      ? fallbackSummary(props.move)
      : undefined;
  const waiver = (): string | undefined =>
    props.move.status === "claim_waiting" ? waiverTimingLine(props.waiver) : undefined;
  const originalClaim = (): string | undefined => originalClaimLine(props.move);
  return (
    <RuleListItem layout="stack" dense>
      <Stack gap="2xs">
        <Inline gap="sm">
          <TransactionOutcomeIcon move={props.move} />
          <Text type="body-strong">{moveSummary(props.move)}</Text>
        </Inline>
        <Text type="meta" tone="muted">
          {props.move.team.name} · {leagueDisplayName(props.move.team.league)} ·{" "}
          {sportDisplayName(props.move.team.sport)}
        </Text>
        <Show when={originalClaim()}>
          {(line) => (
            <Text type="meta" tone="muted">
              {line()}
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
        <Show when={timing()}>
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
        <Show when={fallback()}>
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

function fallbackSummary(move: TransactionMoveView): string | undefined {
  return (move.status === "failed" || move.status === "all_choices_failed") &&
    move.attempts.length > 0
    ? "What was tried"
    : fallbackPlanLine(move);
}

function settledStatus(status: TransactionMoveView["status"]): boolean {
  switch (status) {
    case "ran_immediately":
    case "ran_on_schedule":
    case "claim_won":
    case "claim_lost_fallback_ran":
      return true;
    case "open_undecided":
    case "open_saved":
    case "open_now":
    case "open_confirmed":
    case "discarded":
    case "claim_waiting":
    case "claim_lost":
    case "claim_lost_retrying":
    case "all_choices_failed":
    case "fallback_unknown":
    case "offer_sent":
    case "failed":
    case "skipped":
    case "unknown":
      return false;
  }
}

function statusTone(status: CardStatus): "accent" | "neutral" {
  return status.kind === "needs-decision" || status.kind === "scheduled" ? "accent" : "neutral";
}

function scheduleActionLabel(card: GroupCard): string {
  const day = card.lead.runDay;
  return day === undefined ? "Schedule" : `Schedule for ${formatCalendarDate(day)}`;
}

function ranLabel(card: GroupCard): string {
  const first = cardMembers(card)[0];
  return first === undefined ? "Ran" : (moveOutcomeLabel(first) ?? "Ran");
}

function reasonLines(card: GroupCard): ReadonlyArray<string> {
  const members = cardMembers(card);
  return EffectArray.flatMap(members, (move) => {
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
  readonly remote: TransactionRemote;
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
  readonly waiver: TransactionWaiverRuleView | undefined;
};
