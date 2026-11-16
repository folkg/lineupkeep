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
  kindLabel,
  moveCount,
  moveSummary,
  openMoveCount,
  teamCount,
} from "./transactionCopy";
import { TransactionAuthenticationFailure } from "./transactionFailure";
import type { TransactionRemote } from "./transactionRemote";
import {
  formatLocalDate,
  groupTimingLine,
  moveTimingLine,
  resultRunLabel,
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
              <TodayZone page={page} remote={props.remote} />
              <PlanningSheet page={page} remote={props.remote} />
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

function TodayZone(props: RemoteSectionProps): JSX.Element {
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
              {`${moveCount(pending())} still ${pending() === 1 ? "needs" : "need"} your confirmation. A group runs only after you confirm it.`}
            </Text>
          </Show>
          <Stack gap="xl">
            <For each={props.page.todayTeams()}>
              {(team) => <TeamGroups card={team} page={props.page} remote={props.remote} today />}
            </For>
          </Stack>
        </Show>
      </Stack>
    </Band>
  );
}

function PlanningSheet(props: RemoteSectionProps): JSX.Element {
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
        A saved group waits for its day. Confirming is your decision; the group runs at its
        scheduled time that day. You can change the day or discard a move until then.
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
          <For each={teams()}>
            {(card) => <SavedTeamGroups card={card} page={props.page} remote={props.remote} />}
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

function SavedTeamGroups(props: SavedTeamGroupsProps): JSX.Element {
  const titleId = (): string => `saved-team-${props.card.team.id}`;
  const confirmation = useGroupConfirmation({
    team: () => props.card.team.id,
    remote: () => props.remote,
    page: () => props.page,
  });
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
        <For each={savedDays(props.card.moves)}>
          {(day) => (
            <Stack gap="md">
              <Heading level={4} size="item">
                {day.day === undefined ? "No day set" : formatCalendarDate(day.day)}
              </Heading>
              <For each={runCards(day.moves, props.page.groups(), false)}>
                {(card) => (
                  <RunGroupCard card={card} page={props.page} confirmation={confirmation} />
                )}
              </For>
            </Stack>
          )}
        </For>
      </Stack>
    </Box>
  );
}

function TeamGroups(props: TeamGroupsProps): JSX.Element {
  const confirmation = useGroupConfirmation({
    team: () => props.card.team.id,
    remote: () => props.remote,
    page: () => props.page,
  });
  return (
    <Stack gap="lg">
      <Stack gap="2xs">
        <Heading level={3} size="item">
          {props.card.team.name}
        </Heading>
        <Text size="caption" tone="muted">
          {leagueDisplayName(props.card.team.league)} · {sportDisplayName(props.card.team.sport)}
        </Text>
        <TeamPlaces facts={props.page.teamFacts().get(props.card.team.id)} />
      </Stack>
      <For each={runCards(props.card.moves, props.page.groups(), props.today)}>
        {(card) => <RunGroupCard card={card} page={props.page} confirmation={confirmation} />}
      </For>
    </Stack>
  );
}

function RunGroupCard(props: RunGroupCardProps): JSX.Element {
  const lead = (): TransactionMoveView => props.card.lead;
  const all = (): ReadonlyArray<TransactionMoveView> => [...props.card.moves, ...props.card.fixes];
  const confirmed = (): boolean =>
    props.card.moves.every(
      (move) =>
        move.decision === "confirmed" || move.decision === "now" || move.result !== undefined,
    );
  const pending = (): boolean =>
    props.card.moves.some(
      (move) =>
        move.result === undefined && (move.decision === "undecided" || move.decision === "saved"),
    );
  const hasOpen = (): boolean => all().some((move) => move.result === undefined);
  const confirmable = (): boolean =>
    all().every((move) => move.validation.status === "current" && move.result === undefined);
  const working = (): boolean => props.confirmation.pending();
  const controlLabel = (): string => {
    if (props.card.today) {
      return pending() ? "Confirm and run" : "Run now";
    }
    return "Confirm";
  };
  const workingLabel = (): string => (props.card.today && !pending() ? "Running" : "Confirming");
  const actionLabel = (): string => `${controlLabel()}: ${cardTitle(props.card)}`;
  return (
    <Box rule="top" ruleTone="ink" space="lg">
      <Stack gap="md">
        <Stack gap="2xs">
          <Inline gap="sm" align="baseline">
            <Show when={props.card.group}>
              {(group) => (
                <Badge tone={group().status === "blocked" ? "neutral" : "accent"}>
                  {groupStatusLabel(group().status)}
                </Badge>
              )}
            </Show>
            <Show when={props.card.moves.length > 1 || props.card.group?.label !== undefined}>
              <Text size="item" weight="semibold">
                {cardTitle(props.card)}
              </Text>
              <Text numeric size="caption" tone="faint">
                {moveCount(props.card.moves.length)}
              </Text>
            </Show>
          </Inline>
          <Text size="caption" tone="muted">
            {`${groupTimingLine({
              today: props.card.today,
              runDay: lead().runDay,
              confirmed: confirmed(),
              nextRunAt: props.page.nextRunAt(),
            })}.`}
          </Text>
          <Show when={props.card.group}>
            {(group) => (
              <Text size="caption" tone={group().status === "ready" ? "muted" : "default"}>
                {group().detail}
              </Text>
            )}
          </Show>
        </Stack>
        <RuleList>
          <For each={props.card.moves}>
            {(move) => (
              <GroupMoveRow
                move={move}
                page={props.page}
                today={props.card.today}
                working={working()}
              />
            )}
          </For>
        </RuleList>
        <Show when={props.card.fixes.length > 0}>
          <Box rule="top" space="sm">
            <Stack gap="2xs">
              <Text size="caption" weight="semibold">
                Roster fixes
              </Text>
              <Text size="caption" tone="muted">
                These moves make room for your add. They run first.
              </Text>
              <RuleList>
                <For each={props.card.fixes}>
                  {(move) => (
                    <GroupMoveRow
                      move={move}
                      page={props.page}
                      today={props.card.today}
                      working={working()}
                    />
                  )}
                </For>
              </RuleList>
            </Stack>
          </Box>
        </Show>
        <Inline gap="sm" align="baseline" justify="end">
          <Show when={(props.card.today || pending()) && hasOpen()}>
            <Button
              variant="secondary"
              disabled={!confirmable() || working()}
              state={working() ? "working" : "idle"}
              aria-label={actionLabel()}
              onClick={() => props.confirmation.start(all())}
            >
              {working() ? workingLabel() : controlLabel()}
            </Button>
          </Show>
        </Inline>
      </Stack>
    </Box>
  );
}

function GroupMoveRow(props: GroupMoveRowProps): JSX.Element {
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
                props.move.result === "failed" || props.move.result === "unknown"
                  ? "danger"
                  : "muted"
              }
            >
              {resultLabel(props.move)}
            </Text>
          </Show>
          <Show when={!props.today}>
            <DateFacts move={props.move} />
          </Show>
          <MoveCheck move={props.move} />
        </Stack>
        <Inline gap="sm" align="baseline" justify="end">
          <Show when={!props.today && !invalid()}>
            <Button
              variant="link"
              disabled={
                props.page.saving() || props.page.discarding() !== undefined || props.working
              }
              aria-label={`Change date: ${moveSummary(props.move)}`}
              onClick={() => props.page.startEdit(props.move)}
            >
              {props.move.runDay === undefined ? "Set date" : "Change date"}
            </Button>
          </Show>
          <Button
            variant="quiet"
            tone="danger"
            disabled={props.page.saving() || props.page.discarding() !== undefined || props.working}
            state={props.page.discarding() === props.move.move ? "working" : "idle"}
            aria-label={`Discard: ${moveSummary(props.move)}`}
            onClick={() => props.page.discardMove(props.move)}
          >
            {props.page.discarding() === props.move.move ? "Discarding" : "Discard"}
          </Button>
        </Inline>
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
        : `It waits for ${formatCalendarDate(move.runDay)}. Nothing runs until you confirm it.`;
    }
    return "Nothing runs until you confirm it.";
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

function todayCopy(total: number, pending: number): string {
  if (total === 0) {
    return "No move is waiting to run today.";
  }
  if (pending === 0) {
    return `All ${String(total)} ${total === 1 ? "is" : "are"} confirmed. A confirmed group runs now.`;
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

function savedDays(moves: ReadonlyArray<TransactionMoveView>): ReadonlyArray<{
  readonly day: string | undefined;
  readonly moves: ReadonlyArray<TransactionMoveView>;
}> {
  const byDay = new Map<string, Array<TransactionMoveView>>();
  for (const move of moves) {
    const key = move.runDay ?? "";
    const held = byDay.get(key) ?? [];
    held.push(move);
    byDay.set(key, held);
  }
  return [...byDay]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, held]) => ({
      day: day === "" ? undefined : day,
      moves: [...held].sort((left, right) => left.position - right.position),
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

type TeamGroupsProps = {
  readonly card: TransactionMoveTeamDayView;
  readonly page: TransactionsPageController;
  readonly remote: TransactionRemote;
  readonly today: boolean;
};

type SavedTeamGroupsProps = {
  readonly card: TransactionMoveTeamDayView;
  readonly page: TransactionsPageController;
  readonly remote: TransactionRemote;
};

type RunGroupCardProps = {
  readonly card: RunGroupCardView;
  readonly page: TransactionsPageController;
  readonly confirmation: GroupConfirmation;
};

type GroupMoveRowProps = {
  readonly move: TransactionMoveView;
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
