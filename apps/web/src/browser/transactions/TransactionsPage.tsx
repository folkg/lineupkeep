import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import { Badge } from "#browser/shared-ui/Badge.tsx";
import { Box } from "#browser/shared-ui/Box.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import {
  formatCalendarDate,
  formatReaderTime,
  formatRunDay,
} from "#browser/shared-ui/formatTime.ts";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Notice } from "#browser/shared-ui/Notice.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import type {
  TransactionProposalItemView,
  TransactionProposalListData,
  TransactionProposalSetSummaryView,
} from "#contracts/connections/transactionContract.ts";

import type { TransactionRemote } from "./transactionRemote";
import { openPlansTitleId, useTransactionsPage } from "./useTransactionsPage";
import type { TransactionsPageController } from "./useTransactionsPage";

export function TransactionsPage(props: TransactionsPageProps): JSX.Element {
  const page = useTransactionsPage({
    teamId: () => props.teamId,
    remote: () => props.remote,
  });
  const teamName = (): string => page.team()?.name ?? "this team";

  return (
    <AppShell>
      <Page
        back={
          <TextLink tone="quiet" to="/teams/$teamId" params={{ teamId: props.teamId }}>
            Back to {teamName()}
          </TextLink>
        }
        lede="Open plans and their history for this team."
        title={teamName()}
      >
        <Show
          fallback={<LoadingState label="Loading plans">Loading this team's plans…</LoadingState>}
          when={!page.isLoading()}
        >
          <Show
            fallback={
              <Show
                fallback={
                  <EmptyState title="Team not found.">
                    This team is not available to the current account. Return to the{" "}
                    <TextLink to="/teams">team list</TextLink>.
                  </EmptyState>
                }
                when={page.failure()}
              >
                <ActionFeedback
                  feedback={{
                    type: "attention",
                    message: "We could not load this team's plans. Try again.",
                    recovery: { label: "Try again", onAction: page.retry },
                  }}
                />
              </Show>
            }
            when={page.team()}
          >
            {(team) => (
              <Stack gap="xl">
                <ActionFeedback feedback={page.feedback()} />
                <OpenPlans page={page} teamName={team().name} />
                <History page={page} />
              </Stack>
            )}
          </Show>
        </Show>
      </Page>
    </AppShell>
  );
}

function OpenPlans(props: OpenPlansProps): JSX.Element {
  const illegalRoster = (): ReadonlyArray<{
    readonly name: string;
    readonly slot: string;
    readonly detail: string;
  }> => dedupeOccupants(props.page.openPlans().flatMap((plan) => plan.teams));
  return (
    <Stack as="section" gap="md" labelledBy={openPlansTitleId}>
      <SectionTitle id={openPlansTitleId} focusable>
        Open plans
      </SectionTitle>
      <Show
        fallback={
          <EmptyState title="Nothing is proposed for this team.">
            Ask the agent to propose transactions for {props.teamName}.
          </EmptyState>
        }
        when={props.page.openPlans().length > 0}
      >
        <Stack gap="xl">
          <Show when={illegalRoster().length > 0}>
            <Notice
              tone="danger"
              title={`${props.teamName} roster is illegal`}
              items={illegalRoster().map((occupant) => occupant.detail)}
            />
          </Show>
          <For each={props.page.openPlans()}>
            {(plan) => (
              <PlanSummary
                dismissing={props.page.dismissing()}
                dismissFailure={props.page.dismissFailure}
                history={false}
                onDismiss={props.page.dismissItem}
                plan={plan}
              />
            )}
          </For>
          <Show when={props.page.hasMoreOpen()}>
            <Inline gap="sm">
              <Button
                state={props.page.fetchingMoreOpen() ? "working" : "idle"}
                variant="secondary"
                onClick={props.page.showMoreOpen}
              >
                {props.page.fetchingMoreOpen() ? "Loading more plans" : "Show more"}
              </Button>
            </Inline>
          </Show>
        </Stack>
      </Show>
    </Stack>
  );
}

function History(props: HistoryProps): JSX.Element {
  const lastPage = (): TransactionProposalListData["page"] | undefined => props.page.historyPage();
  return (
    <Stack as="section" gap="md" labelledBy="history-title">
      <SectionTitle
        id="history-title"
        action={
          <Button
            aria-expanded={props.page.historyEnabled() ? "true" : "false"}
            variant="link"
            onClick={props.page.toggleHistory}
          >
            {props.page.historyEnabled() ? "Hide history" : "Show history"}
          </Button>
        }
      >
        History
      </SectionTitle>
      <Show when={props.page.historyEnabled()}>
        <Show
          fallback={
            <Show
              fallback={
                <LoadingState label="Loading plan history">Loading closed plans…</LoadingState>
              }
              when={!props.page.historyLoading()}
            >
              <ActionFeedback
                feedback={{
                  type: "attention",
                  message: "We could not load the closed plans. Try again.",
                  recovery: { label: "Try again", onAction: props.page.retryHistory },
                }}
              />
            </Show>
          }
          when={!props.page.historyFailure()}
        >
          <Show
            fallback={
              <EmptyState title="No closed plans.">
                Plans appear here after every move has settled or been dismissed.
              </EmptyState>
            }
            when={props.page.historyPlans().length > 0}
          >
            <Stack gap="xl">
              <For each={props.page.historyPlans()}>
                {(plan) => (
                  <PlanSummary
                    dismissing={undefined}
                    dismissFailure={() => undefined}
                    history
                    onDismiss={() => undefined}
                    plan={plan}
                  />
                )}
              </For>
              <Show when={props.page.hasMoreHistory()}>
                <Inline gap="sm">
                  <Button
                    state={props.page.fetchingMoreHistory() ? "working" : "idle"}
                    variant="secondary"
                    onClick={props.page.showMoreHistory}
                  >
                    {props.page.fetchingMoreHistory() ? "Loading more plans" : "Show more"}
                  </Button>
                </Inline>
              </Show>
              <Show when={(lastPage()?.total ?? 0) > 0}>
                <Text size="caption" tone="faint">
                  {String(lastPage()?.total ?? 0)}{" "}
                  {(lastPage()?.total ?? 0) === 1 ? "closed plan" : "closed plans"}
                </Text>
              </Show>
            </Stack>
          </Show>
        </Show>
      </Show>
    </Stack>
  );
}

function PlanSummary(props: PlanSummaryProps): JSX.Element {
  const groups = (): ReadonlyArray<PlanDayGroup> =>
    props.plan.teams.flatMap((team) =>
      planGroups(team)
        .map((group) => ({
          ...group,
          items: group.items.filter((item) => props.history || !item.settled),
        }))
        .filter((group) => group.items.length > 0),
    );
  return (
    <Box rule="bottom" space="lg">
      <Stack gap="md">
        <Stack gap="xs">
          <Inline gap="sm" align="baseline" justify="between">
            <Text size="caption" tone="muted">
              {proposerLine(props.plan)}{" "}
              <Time datetime={props.plan.createdAt}>{formatReaderTime(props.plan.createdAt)}</Time>.
            </Text>
            <TextLink size="caption" to="/transactions/$setId" params={{ setId: props.plan.id }}>
              {props.history ? "Review plan" : "Review and submit"}
            </TextLink>
          </Inline>
        </Stack>
        <Show
          fallback={
            <EmptyState title={props.history ? "No moves recorded." : "No moves left open."}>
              {props.history
                ? "This plan has no moves recorded."
                : "Every move in this plan has ended."}
            </EmptyState>
          }
          when={groups().length > 0}
        >
          <For each={groups()}>
            {(group) => (
              <Show
                fallback={
                  <ItemList
                    dismissing={props.dismissing}
                    dismissFailure={props.dismissFailure}
                    history={props.history}
                    items={group.items}
                    onDismiss={props.onDismiss}
                    plan={props.plan}
                    runDate={undefined}
                  />
                }
                when={group.date}
              >
                {(date) => (
                  <Stack gap="sm">
                    <SectionTitle level={3}>{formatRunDay(date(), group.today)}</SectionTitle>
                    <ItemList
                      dismissing={props.dismissing}
                      dismissFailure={props.dismissFailure}
                      history={props.history}
                      items={group.items}
                      onDismiss={props.onDismiss}
                      plan={props.plan}
                      runDate={date()}
                    />
                  </Stack>
                )}
              </Show>
            )}
          </For>
        </Show>
      </Stack>
    </Box>
  );
}

function planGroups(
  team: TransactionProposalSetSummaryView["teams"][number],
): ReadonlyArray<PlanDayGroup> {
  if (team.groups === undefined) {
    return [{ items: team.items }];
  }
  const byId = new Map(team.items.map((item) => [item.id, item] as const));
  return team.groups.map((group) => ({
    date: group.date,
    today: team.today,
    items: group.items.map((id) => groupItem(byId, id)),
  }));
}

function groupItem<Item>(byId: ReadonlyMap<string, Item>, id: string): Item {
  const item = byId.get(id);
  if (item === undefined) {
    throw new Error(`A run-day group names a move outside the plan: ${id}`);
  }
  return item;
}

function ItemList(props: ItemListProps): JSX.Element {
  return (
    <RuleList>
      <For each={props.items}>
        {(item) => (
          <PlanItem
            dismissing={props.dismissing === item.id}
            dismissFailure={props.dismissFailure(item.id)}
            history={props.history}
            item={item}
            runDate={props.runDate}
            onDismiss={() => props.onDismiss(props.plan.id, item, itemSummary(item))}
          />
        )}
      </For>
    </RuleList>
  );
}

function PlanItem(props: PlanItemProps): JSX.Element {
  return (
    <RuleListItem layout="stack">
      <Stack gap="sm">
        <Inline gap="sm" align="baseline">
          <Badge tone={itemNeedsAttention(props.item) ? "neutral" : "accent"}>
            {kindLabel(props.item.kind)}
          </Badge>
          <Badge tone={props.item.state === "dismissed" ? "neutral" : "accent"}>
            {stateLabel(props.item.lifecycle)}
          </Badge>
          <Show when={props.item.bid !== undefined}>
            <Text size="caption" tone="muted">
              FAAB bid: {String(props.item.bid)}.
            </Text>
          </Show>
          <Show when={budgetPeriodLine(props.item)}>
            {(line) => (
              <Text size="caption" tone="muted">
                {line()}
              </Text>
            )}
          </Show>
        </Inline>
        <Text size="body" weight="semibold">
          {itemSummary(props.item)}
        </Text>
        <Show when={effectiveLine(props.item, props.runDate)}>
          {(line) => (
            <Text size="caption" tone="muted">
              {line()}
            </Text>
          )}
        </Show>
        <Show when={fallbackLine(props.item)}>
          {(line) => (
            <Text size="caption" tone="muted">
              {line()}
            </Text>
          )}
        </Show>
        <Show when={props.item.execution?.detail}>
          {(detail) => (
            <Text size="caption" tone="muted">
              {detail()}
            </Text>
          )}
        </Show>
        <Show when={props.item.staleness.status !== "current"}>
          <Notice
            tone="danger"
            title={
              props.item.staleness.status === "illegal"
                ? "Illegal roster position"
                : "No longer current"
            }
            items={props.item.staleness.reasons.map((reason) => reason.detail)}
          />
        </Show>
        <Show when={props.history && props.item.outcomeDetail}>
          {(detail) => (
            <Notice tone="neutral" title="Dismissed from this plan">
              <Text size="caption" tone="muted">
                {detail()}
              </Text>
            </Notice>
          )}
        </Show>
        <Show when={!props.history && isDismissible(props.item)}>
          <Form gap="sm" onSubmit={props.onDismiss}>
            <Inline gap="sm" align="baseline" collapse>
              <Button
                aria-label={`${props.dismissing ? "Dismissing" : "Dismiss"}: ${itemSummary(props.item)}`}
                data-dismiss-item={props.item.id}
                state={props.dismissing ? "working" : "idle"}
                type="submit"
                variant="secondary"
              >
                {props.dismissing ? "Dismissing move" : "Dismiss"}
              </Button>
              <Text size="caption" tone="muted">
                Dismissing removes this move from the plan without changing your team.
              </Text>
            </Inline>
          </Form>
        </Show>
        <Show when={!props.dismissing && props.dismissFailure}>
          {(failure) => (
            <Notice
              id={`dismiss-${props.item.id}`}
              tone="danger"
              title="This move was not dismissed"
            >
              <Text size="caption" tone="danger">
                {failure()}
              </Text>
            </Notice>
          )}
        </Show>
      </Stack>
    </RuleListItem>
  );
}

function isDismissible(item: TransactionProposalItemView): boolean {
  return !item.settled && (item.state === "proposed" || item.state === "failed");
}

function itemNeedsAttention(item: TransactionProposalItemView): boolean {
  return item.lifecycle === "stale" || item.lifecycle === "failed" || item.lifecycle === "unknown";
}

function dedupeOccupants(
  teams: ReadonlyArray<TransactionProposalSetSummaryView["teams"][number]>,
): ReadonlyArray<{ readonly name: string; readonly slot: string; readonly detail: string }> {
  const seen = new Set<string>();
  return teams.flatMap((team) =>
    (team.illegalRoster ?? []).filter((occupant) => {
      const key = `${occupant.name}|${occupant.slot}|${occupant.detail}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    }),
  );
}

function proposerLine(plan: TransactionProposalSetSummaryView): string {
  const who = plan.proposedBy.kind === "agent" ? "Proposed by an agent" : "Proposed by you";
  return plan.proposedBy.client === undefined ? who : `${who} from ${plan.proposedBy.client}`;
}

function stateLabel(lifecycle: TransactionProposalItemView["lifecycle"]): string {
  switch (lifecycle) {
    case "proposed":
      return "Open";
    case "scheduled":
      return "Scheduled";
    case "stale":
      return "Stale";
    case "executed":
      return "Executed";
    case "pending":
      return "Pending";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "unknown":
      return "Unknown";
    case "accepted":
      return "Accepted";
    case "withdrawn":
      return "Withdrawn";
    case "expired":
      return "Expired";
    case "dismissed":
      return "Dismissed";
  }
}

function kindLabel(kind: TransactionProposalItemView["kind"]): string {
  switch (kind) {
    case "waiver_claim":
      return "Waiver claim";
    case "free_agent_add":
      return "Free agent add";
    case "drop":
      return "Drop";
    case "trade":
      return "Trade offer";
    case "slot_move":
      return "Slot move";
    case "activate":
      return "Activate";
    case "stash":
      return "Stash";
  }
}

function itemSummary(item: TransactionProposalItemView): string {
  if (item.kind === "slot_move") {
    return item.slotMove === undefined
      ? "Slot move"
      : `Move ${item.slotMove.playerName ?? "this player"} to ${item.slotMove.toSlot}`;
  }
  if (item.kind === "activate" || item.kind === "stash") {
    return `${kindLabel(item.kind)} ${item.placement?.playerName ?? "this player"}`;
  }
  const adds = playerNames(item.adds);
  const drops = playerNames(item.drops);
  if (item.kind === "trade") {
    const outgoing = [
      ...(drops === undefined ? [] : [drops]),
      ...item.picks
        .filter((pick) => pick.to.ref === item.counterparty?.ref)
        .map((pick) => `a round ${String(pick.round)} pick`),
    ];
    const incoming = [
      ...(adds === undefined ? [] : [adds]),
      ...item.picks
        .filter((pick) => pick.from.ref === item.counterparty?.ref)
        .map((pick) => `a round ${String(pick.round)} pick`),
    ];
    if (outgoing.length > 0 && incoming.length > 0) {
      return `Send ${outgoing.join(", ")} to ${item.counterparty?.name ?? "the counterparty"} for ${incoming.join(", ")}`;
    }
  }
  if (adds !== undefined && drops !== undefined) {
    return `Add ${adds} and drop ${drops}`;
  }
  if (adds !== undefined) {
    return `Add ${adds}`;
  }
  if (drops !== undefined) {
    return `Drop ${drops}`;
  }
  return "This move";
}

function effectiveLine(
  item: TransactionProposalItemView,
  runDate: string | undefined,
): string | undefined {
  if (
    item.state !== "proposed" ||
    item.effectiveDate === undefined ||
    item.effectiveDate === runDate
  ) {
    return undefined;
  }
  return `Takes effect on ${formatCalendarDate(item.effectiveDate)}.`;
}

function fallbackLine(item: TransactionProposalItemView): string | undefined {
  if (item.state !== "proposed") {
    return undefined;
  }
  const names = (item.fallbacks ?? []).flatMap((player) =>
    player.name === undefined ? [] : [player.name],
  );
  if (names.length === 0) {
    return undefined;
  }
  return item.kind === "waiver_claim"
    ? `If the claim does not win because the first choice is gone: ${names.join(", ")} is added as a straight free-agent add in the same period. Your bid applies only to the claim, never to the fallback.`
    : `If the first choice is gone: ${names.join(", ")}.`;
}

function budgetPeriodLine(item: TransactionProposalItemView): string | undefined {
  return item.budgetPeriod.status === "season"
    ? `Spends the ${String(item.budgetPeriod.season)} season FAAB budget.`
    : undefined;
}

function playerNames(players: TransactionProposalItemView["adds"]): string | undefined {
  const names = players.flatMap((player) => (player.name === undefined ? [] : [player.name]));
  if (names.length === 0) {
    return undefined;
  }
  if (names.length === 1) {
    return names[0];
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

type TransactionsPageProps = {
  readonly teamId: string;
  readonly remote: TransactionRemote;
};

type OpenPlansProps = {
  readonly page: TransactionsPageController;
  readonly teamName: string;
};

type HistoryProps = {
  readonly page: TransactionsPageController;
};

type PlanSummaryProps = {
  readonly plan: TransactionProposalSetSummaryView;
  readonly history: boolean;
  readonly dismissing: string | undefined;
  readonly dismissFailure: (item: string) => string | undefined;
  readonly onDismiss: (plan: string, item: TransactionProposalItemView, label: string) => void;
};

type PlanDayGroup = {
  readonly date?: string;
  readonly today?: string;
  readonly items: ReadonlyArray<TransactionProposalItemView>;
};

type ItemListProps = {
  readonly plan: TransactionProposalSetSummaryView;
  readonly items: ReadonlyArray<TransactionProposalItemView>;
  readonly runDate: string | undefined;
  readonly history: boolean;
  readonly dismissing: string | undefined;
  readonly dismissFailure: (item: string) => string | undefined;
  readonly onDismiss: (plan: string, item: TransactionProposalItemView, label: string) => void;
};

type PlanItemProps = {
  readonly item: TransactionProposalItemView;
  readonly runDate: string | undefined;
  readonly history: boolean;
  readonly dismissing: boolean;
  readonly dismissFailure: string | undefined;
  readonly onDismiss: () => void;
};
