import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Badge } from "#browser/shared-ui/Badge.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import {
  formatCalendarDate,
  formatClockTime,
  formatDateTime,
} from "#browser/shared-ui/formatTime.ts";
import { Heading } from "#browser/shared-ui/Heading.tsx";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { QueueList, QueueListItem, QueueListNote } from "#browser/shared-ui/QueueList.tsx";
import { QueuePanel, QueuePanelNote } from "#browser/shared-ui/QueuePanel.tsx";
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
  formatLocalDate,
  moveTimingLine,
  resultRunLabel,
  scheduledRunLine,
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
    return nextRunAt === undefined ? undefined : `Runs at ${formatClockTime(nextRunAt)}`;
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
        <For each={props.day?.teams ?? []}>
          {(team) => (
            <TeamGroups card={team} page={props.page} remote={props.remote} today={props.today} />
          )}
        </For>
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
  const hasOpen = (): boolean => all().some((move) => move.result === undefined);
  const confirmable = (): boolean =>
    all().every((move) => move.validation.status === "current" && move.result === undefined);
  const working = (): boolean => props.confirmation.pending();
  const showControl = (): boolean => (props.card.today || pending()) && hasOpen();
  const controlLabel = (): string => {
    if (props.card.today) {
      return pending() ? "Confirm group and run now" : "Run group now";
    }
    return "Confirm group";
  };
  const workingLabel = (): string => (props.card.today && !pending() ? "Running" : "Confirming");
  const actionLabel = (): string => `${controlLabel()}: ${cardTitle(props.card)}`;
  const explanation = (): string | undefined => {
    const group = props.card.group;
    return group === undefined || group.status === "ready" ? undefined : group.detail;
  };
  const note = (): string => {
    if (props.card.today) {
      return `Runs immediately · ${moveCount(all().length)}`;
    }
    const runDay = props.card.lead.runDay;
    return runDay === undefined
      ? "No run date is set."
      : `${scheduledRunLine(runDay, props.page.nextRunAt())}.`;
  };
  const showNote = (): boolean => showControl() || !props.card.today;
  return (
    <QueuePanel
      action={
        showControl() ? (
          <Button
            variant="primary"
            disabled={!confirmable() || working()}
            state={working() ? "working" : "idle"}
            aria-label={actionLabel()}
            onClick={() => props.confirmation.start(all())}
          >
            {working() ? workingLabel() : controlLabel()}
          </Button>
        ) : undefined
      }
      badge={<Badge tone={groupStateTone(panelState(props.card))}>{panelState(props.card)}</Badge>}
      header={
        <>
          <Heading id={headingId()} level={3} size="section">
            {team().name}
          </Heading>
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
      labelledBy={headingId()}
      note={
        showNote() ? (
          <Text size="label" tone={props.card.today ? "spot" : "muted"}>
            {note()}
          </Text>
        ) : undefined
      }
      support={
        !props.card.today && !pending() ? (
          <Text size="caption" tone="muted">
            Waiting for its day. Nothing runs before then.
          </Text>
        ) : undefined
      }
    >
      <QueueList>
        <For each={props.card.moves}>
          {(move, index) => (
            <GroupMoveRow
              move={move}
              number={index() + 1}
              page={props.page}
              today={props.card.today}
              working={working()}
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
                working={working()}
              />
            )}
          </For>
        </Show>
      </QueueList>
      <Show when={props.facts}>
        {(facts) => (
          <QueuePanelNote>
            <TeamPlaces facts={facts()} />
          </QueuePanelNote>
        )}
      </Show>
      <Show when={explanation()}>
        {(detail) => (
          <QueuePanelNote>
            <Text size="caption" tone="muted">
              {detail()}
            </Text>
          </QueuePanelNote>
        )}
      </Show>
    </QueuePanel>
  );
}

function GroupMoveRow(props: GroupMoveRowProps): JSX.Element {
  const invalid = (): boolean => props.move.validation.status !== "current";
  const editing = (): boolean => props.page.editing() === props.move.move;
  const actionsDisabled = (): boolean =>
    props.page.saving() || props.page.discarding() !== undefined || props.working;
  return (
    <QueueListItem
      number={props.number}
      actions={
        <>
          <Show when={!props.today && !invalid()}>
            <Button
              variant="link"
              disabled={actionsDisabled()}
              aria-label={`Change date: ${moveSummary(props.move)}`}
              onClick={() => props.page.startEdit(props.move)}
            >
              {props.move.runDay === undefined ? "Set date" : "Change date"}
            </Button>
          </Show>
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
      <MoveState move={props.move} page={props.page} today={props.today} />
      <Show when={props.move.result !== undefined}>
        <Text
          size="caption"
          tone={
            props.move.result === "failed" || props.move.result === "unknown" ? "danger" : "muted"
          }
        >
          {resultLabel(props.move)}
        </Text>
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

function MoveState(props: MoveStateProps): JSX.Element {
  const line = (): string | undefined => {
    const move = props.move;
    const timing = moveTimingLine({
      move,
      today: props.today,
      nextRunAt: props.page.nextRunAt(),
    });
    if (move.confirmation !== undefined) {
      const confirmed = `You confirmed this on ${formatLocalDate(move.confirmation.at)}${surfaceCopy(move)}.`;
      return timing === undefined
        ? confirmed
        : `${confirmed} ${timing.endsWith(".") ? timing : `${timing}.`}`;
    }
    if (move.decision === "discarded") {
      return move.decidedAt === undefined
        ? decidedByCopy(move, "discarded this")
        : `${decidedByCopy(move, "discarded this")} on ${formatLocalDate(move.decidedAt)}.`;
    }
    if (timing !== undefined) {
      return timing.endsWith(".") ? timing : `${timing}.`;
    }
    if (move.result !== undefined) {
      return undefined;
    }
    if (isConfirmed(move)) {
      return "Confirmed. It has not run yet.";
    }
    if (move.decision === "saved") {
      return move.runDay === undefined
        ? "It waits for your confirmation."
        : `It waits for ${formatCalendarDate(move.runDay)}.`;
    }
    return undefined;
  };
  return (
    <Show when={line()}>
      {(held) => (
        <Text size="caption" tone={props.move.decision === "discarded" ? "faint" : "muted"}>
          {held()}
        </Text>
      )}
    </Show>
  );
}

function decidedByCopy(move: TransactionMoveView, action: string): string {
  switch (move.decidedBy) {
    case "agent":
      return `An agent ${action}${surfaceCopy(move)}`;
    case "system":
      return `The scheduled run ${action}`;
    case "owner":
    case undefined:
      return `You ${action}${surfaceCopy(move)}`;
  }
}

function surfaceCopy(move: TransactionMoveView): string {
  switch (move.surface) {
    case undefined:
      return "";
    case "transaction_plan.tick":
    case "automation.run":
      return "";
    default:
      return move.surface.startsWith("transactions.") ? " in the app" : ` over ${move.surface}`;
  }
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
              <For each={props.page.earlier()}>
                {(move) => <EarlierRow move={move} page={props.page} />}
              </For>
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
        <MoveState move={props.move} page={props.page} today={false} />
      </Stack>
    </RuleListItem>
  );
}

function panelState(card: RunGroupCardView): GroupState {
  const group = card.group;
  if (group !== undefined) {
    switch (group.status) {
      case "done":
        return "Ran";
      case "partly_done":
        return "Ran in part";
      case "blocked":
        return "Blocked";
      case "ready":
        return card.moves.length > 0 && card.moves.every(isConfirmed) ? "Confirmed" : "Undecided";
    }
  }
  if (card.moves.length > 0 && card.moves.every((move) => move.decision === "discarded")) {
    return "Discarded";
  }
  if (card.moves.some((move) => move.result === "executed")) {
    return "Ran";
  }
  if (card.moves.some((move) => move.result !== undefined)) {
    return "Ran in part";
  }
  if (card.moves.some((move) => move.validation.status !== "current")) {
    return "Blocked";
  }
  return card.moves.length > 0 && card.moves.every(isConfirmed) ? "Confirmed" : "Undecided";
}

function groupStateTone(state: GroupState): "accent" | "neutral" {
  return state === "Undecided" || state === "Confirmed" ? "accent" : "neutral";
}

function isConfirmed(move: TransactionMoveView): boolean {
  return move.decision === "now" || move.decision === "confirmed";
}

function resultLabel(move: TransactionMoveView): string {
  if (move.result === "executed") {
    return resultRunLabel(move);
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
  readonly working: boolean;
};

type MoveStateProps = {
  readonly move: TransactionMoveView;
  readonly page: TransactionsPageController;
  readonly today: boolean;
};

type EarlierRowProps = {
  readonly move: TransactionMoveView;
  readonly page: TransactionsPageController;
};

type RunGroupCardView = {
  readonly key: string;
  readonly lead: TransactionMoveView;
  readonly moves: ReadonlyArray<TransactionMoveView>;
  readonly fixes: ReadonlyArray<TransactionMoveView>;
  readonly today: boolean;
  readonly group?: TransactionPlanGroupView;
};

type GroupState = "Undecided" | "Confirmed" | "Ran" | "Ran in part" | "Blocked" | "Discarded";
