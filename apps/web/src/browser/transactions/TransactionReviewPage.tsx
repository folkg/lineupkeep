import type { JSX } from "@solidjs/web";
import { For, Show } from "solid-js";
import type { Accessor } from "solid-js";

import { AppShell } from "#browser/app-shell/AppShell.tsx";
import { ActionFeedback } from "#browser/shared-ui/ActionFeedback.tsx";
import type { ActionFeedbackState, RecoveryAction } from "#browser/shared-ui/ActionFeedback.tsx";
import { Badge } from "#browser/shared-ui/Badge.tsx";
import { Box } from "#browser/shared-ui/Box.tsx";
import { Button } from "#browser/shared-ui/Button.tsx";
import { CheckboxField } from "#browser/shared-ui/CheckboxField.tsx";
import { EmptyState, LoadingState } from "#browser/shared-ui/CollectionState.tsx";
import { Dock, DockSpacer } from "#browser/shared-ui/Dock.tsx";
import { FocusRegion } from "#browser/shared-ui/FocusRegion.tsx";
import { Form } from "#browser/shared-ui/Form.tsx";
import { formatCalendarDate, formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Notice } from "#browser/shared-ui/Notice.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { Quote } from "#browser/shared-ui/Quote.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { createSettle } from "#browser/shared-ui/settle.ts";
import { Split } from "#browser/shared-ui/Split.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
import { TextField } from "#browser/shared-ui/TextField.tsx";
import { TextLink } from "#browser/shared-ui/TextLink.tsx";
import { Time } from "#browser/shared-ui/Time.tsx";
import { leagueDisplayName, sportDisplayName } from "#contracts/connections/teamVocabulary.ts";
import type {
  TransactionReviewExecutionView,
  TransactionReviewItemView,
  TransactionReviewOrderView,
  TransactionReviewPendingOfferView,
  TransactionReviewPlayerView,
  TransactionReviewStepView,
  TransactionReviewTeamView,
  TransactionReviewTradePickView,
  TransactionReviewTradeRulesView,
  TransactionReviewTradeView,
  TransactionReviewView,
} from "#contracts/connections/transactionContract.ts";

import { readWaiverBid } from "./transactionBids";
import {
  TransactionReviewAuthenticationFailure,
  TransactionReviewFailure,
} from "./transactionFailure";
import type { TransactionReviewQueryOptions } from "./transactionQueries";
import type { TransactionRemote } from "./transactionRemote";
import { resultSummaryId, useTransactionReviewPage } from "./useTransactionReviewPage";
import type {
  TransactionReviewBidField,
  TransactionReviewModel,
  TransactionReviewModelOutcome,
} from "./useTransactionReviewPage";

export function TransactionReviewPage(props: TransactionReviewPageProps): JSX.Element {
  const page = useTransactionReviewPage({
    reviewQuery: () => props.reviewQuery(),
    remote: () => props.remote(),
  });

  return (
    <AppShell>
      <Page title="Proposed moves">
        <Show
          fallback={<LoadingState label="Loading proposal">Checking this proposal…</LoadingState>}
          when={!page.isLoading()}
        >
          <Show
            fallback={
              <ReviewFailure error={page.failure()} onRetry={page.retry} signIn={page.signIn} />
            }
            when={page.model()}
          >
            {(model) => (
              <Review
                feedback={page.feedback()}
                bidFor={page.bidFor}
                isItemIncluded={page.isItemIncluded}
                model={model()}
                onBid={page.setBid}
                onSubmit={page.submit}
                onToggle={page.toggleItem}
                submitting={page.submitting()}
                dismissItem={page.dismissItem}
                dismissing={page.dismissing()}
                dismissFailure={page.dismissFailure}
                withdrawItem={page.withdrawItem}
                withdrawOffer={page.withdrawOffer}
                withdrawing={page.withdrawing()}
              />
            )}
          </Show>
        </Show>
      </Page>
    </AppShell>
  );
}

function ReviewFailure(props: ReviewFailureProps): JSX.Element {
  return (
    <Show
      fallback={
        <Show
          fallback={
            <ActionFeedback
              feedback={{
                type: "attention",
                message: "We could not load this proposal. Try again.",
                recovery: {
                  label: "Try again",
                  onAction: props.onRetry,
                },
              }}
            />
          }
          when={isNotFoundFailure(props.error)}
        >
          <EmptyState title="Proposal not found.">
            This proposal is not available to the current account. Open your{" "}
            <TextLink to="/teams">teams</TextLink> to continue.
          </EmptyState>
        </Show>
      }
      when={props.error instanceof TransactionReviewAuthenticationFailure}
    >
      <ActionFeedback
        feedback={{
          type: "attention",
          message:
            "Your session ended before this proposal could be read. Sign in again to continue.",
          recovery: props.signIn,
        }}
      />
    </Show>
  );
}

function isNotFoundFailure(error: unknown): boolean {
  return (
    error instanceof TransactionReviewFailure &&
    (error.reason === "transactions.set_not_found" || error.reason === "transactions.input_invalid")
  );
}

function Review(props: ReviewProps): JSX.Element {
  const settling = createSettle(() => props.model.latestSubmission !== undefined);
  const submitted = (): boolean => props.model.submitted;
  const closed = (): boolean => props.model.closed;
  const canSubmit = (): boolean => !closed() && props.model.proposedCount > 0;
  const illegalTeams = (): ReadonlyArray<TransactionReviewTeamView> =>
    props.model.teamsWithItems.filter((team) => (team.illegalRoster?.length ?? 0) > 0);
  const pendingOffers = (): ReadonlyArray<{
    readonly team: TransactionReviewTeamView;
    readonly offer: TransactionReviewPendingOfferView;
  }> =>
    props.model.review.teams.flatMap((team) =>
      team.pendingOffers
        .filter((offer) => !offerMatchesItem(team, offer))
        .map((offer) => ({ team, offer })),
    );
  return (
    <Stack gap="xl">
      <Stack gap="sm">
        <Show
          fallback={
            <Show
              fallback={
                <ProposalSummary
                  checkedAt={props.model.checkedAt}
                  review={props.model.review}
                  staleCount={props.model.staleCount}
                  illegalCount={props.model.illegalCount}
                  total={props.model.total}
                  teamCount={props.model.teamsWithItems.length}
                />
              }
              when={closed()}
            >
              <ClosedSummary review={props.model.review} total={props.model.total} />
            </Show>
          }
          when={props.model.latestSubmission}
        >
          {(submission) => (
            <SubmittedSummary
              counts={props.model.counts}
              settling={settling()}
              finished={props.model.finished}
              review={props.model.review}
              closed={closed()}
              waiting={props.model.waitingCount}
              submissionCount={props.model.submissions.length}
              submittedAt={submission().submittedAt}
            />
          )}
        </Show>
      </Stack>

      <ActionFeedback feedback={props.feedback} />
      <Show
        fallback={
          <EmptyState title="Nothing was proposed.">
            Ask the agent to propose transactions again.
          </EmptyState>
        }
        when={props.model.total > 0}
      >
        <DockSpacer active={canSubmit()}>
          <Stack gap="xl">
            <For each={props.model.teamsWithItems}>
              {(team) => (
                <TeamProposal
                  bidFor={props.bidFor}
                  closed={closed()}
                  submitted={submitted()}
                  submitting={props.submitting}
                  isItemIncluded={props.isItemIncluded}
                  team={team}
                  dismissing={props.dismissing}
                  dismissFailure={props.dismissFailure}
                  withdrawing={props.withdrawing}
                  onBid={props.onBid}
                  onToggle={props.onToggle}
                  onDismiss={props.dismissItem}
                  onWithdraw={props.withdrawItem}
                />
              )}
            </For>
            <Show when={pendingOffers().length > 0}>
              <PendingOffers
                offers={pendingOffers()}
                withdrawing={props.withdrawing}
                onWithdraw={props.withdrawOffer}
              />
            </Show>
            <Show when={props.model.quietTeams.length > 0}>
              <QuietTeams teams={props.model.quietTeams} />
            </Show>
          </Stack>
        </DockSpacer>
        <Show when={canSubmit()}>
          <SubmissionPanel
            faab={props.model.includedFaab}
            illegalTeams={illegalTeams()}
            included={props.model.includedCount}
            includedDue={props.model.includedDueCount}
            includedWaiting={props.model.includedWaitingCount}
            waitsUntil={props.model.waitsUntil}
            staleCount={props.model.staleCount}
            illegalCount={props.model.illegalCount}
            submitting={props.submitting}
            dismissing={props.dismissing !== undefined}
            total={props.model.proposedCount}
            waivers={props.model.includedWaivers}
            onSubmit={props.onSubmit}
          />
        </Show>
      </Show>
    </Stack>
  );
}

function ProposalSummary(props: ProposalSummaryProps): JSX.Element {
  return (
    <Box rule="bottom" space="lg">
      <Stack gap="sm">
        <Text size="item" weight="semibold">
          {moveCount(props.total)} across {teamCount(props.teamCount)}.
        </Text>
        <Text size="caption" tone="muted">
          Proposed by {proposerLabel(props.review.set.proposedBy.kind)}{" "}
          <Time datetime={props.review.set.createdAt}>
            {formatReaderTime(props.review.set.createdAt)}
          </Time>
          .{" "}
          <Show
            fallback={<>This set has not been checked against current state.</>}
            when={props.checkedAt}
          >
            {(checkedAt) => (
              <>
                Checked against current state{" "}
                <Time datetime={checkedAt()}>{formatReaderTime(checkedAt())}</Time>.
              </>
            )}
          </Show>
        </Text>
        <Show when={props.staleCount > 0}>
          <Text size="caption" tone="danger" weight="semibold">
            {props.staleCount} of {props.total === 1 ? "1 move" : `${String(props.total)} moves`} no
            longer {props.staleCount === 1 ? "matches" : "match"} current state and{" "}
            {props.staleCount === 1 ? "is" : "are"} excluded.
          </Text>
        </Show>
        <Show when={props.illegalCount > 0}>
          <Text size="caption" tone="danger" weight="semibold">
            {props.illegalCount} of {props.total === 1 ? "1 move" : `${String(props.total)} moves`}{" "}
            {props.illegalCount === 1 ? "sits" : "sit"} on an illegal roster position and{" "}
            {props.illegalCount === 1 ? "is" : "are"} excluded.
          </Text>
        </Show>
      </Stack>
    </Box>
  );
}

function SubmittedSummary(props: SubmittedSummaryProps): JSX.Element {
  return (
    <FocusRegion id={resultSummaryId} labelledBy="submitted-title" settle={props.settling}>
      <Box rule="bottom" space="lg">
        <Stack gap="sm">
          <SectionTitle
            id="submitted-title"
            action={props.closed ? <Badge tone="accent">Audit record</Badge> : undefined}
          >
            Submitted
          </SectionTitle>
          <Text size="body" weight="semibold" live="polite">
            {outcomeSummary(props.counts, props.review, props.waiting)}
          </Text>
          <Text size="caption" tone="muted">
            Submitted by you{" "}
            {props.submissionCount === 1
              ? ""
              : `${String(props.submissionCount)} times, most recently `}
            <Time datetime={props.submittedAt}>{formatReaderTime(props.submittedAt)}</Time>.{" "}
            <Show
              fallback={
                <>
                  The submission did not finish recording outcomes, so the results below are
                  incomplete. Nothing is retried automatically.
                </>
              }
              when={props.finished}
            >
              Every move in the latest submission has a recorded outcome below.
            </Show>
          </Text>
          <Show when={props.counts.failed + props.counts.unknown > 0}>
            <Notice
              tone="danger"
              title={`${String(props.counts.failed + props.counts.unknown)} ${props.counts.failed + props.counts.unknown === 1 ? "move needs" : "moves need"} your attention`}
            >
              <Text size="caption" tone="danger">
                Read the outcome beside each move before making another change. A move that may have
                applied is never retried automatically.
              </Text>
            </Notice>
          </Show>
          <Text size="caption" tone="faint">
            {props.closed
              ? "Every move in this plan has settled or been dismissed. This plan is an audit record; ask the agent to propose a new plan for another move."
              : "This plan stays open while a move has not settled. A failed or skipped move keeps its outcome here; ask the agent to add a replacement to this plan to try again."}
          </Text>
        </Stack>
      </Box>
    </FocusRegion>
  );
}

function ClosedSummary(props: ClosedSummaryProps): JSX.Element {
  return (
    <Box rule="bottom" space="lg">
      <Stack gap="sm">
        <SectionTitle action={<Badge tone="accent">Audit record</Badge>}>Closed plan</SectionTitle>
        <Text size="body" weight="semibold">
          Every move in this plan has ended.
        </Text>
        <Text size="caption" tone="muted">
          {moveCount(props.total)} proposed by {proposerLabel(props.review.set.proposedBy.kind)}{" "}
          <Time datetime={props.review.set.createdAt}>
            {formatReaderTime(props.review.set.createdAt)}
          </Time>
          . Nothing can be submitted from this plan; ask the agent to propose a new plan for another
          move.
        </Text>
      </Stack>
    </Box>
  );
}

function TeamOrder(props: TeamOrderProps): JSX.Element {
  return (
    <Show
      when={props.order.status === "conflict" ? props.order : undefined}
      fallback={
        <Show
          when={props.order.status === "unresolved" ? props.order : undefined}
          fallback={
            <Show when={props.order.status === "ordered" ? props.order : undefined}>
              {(order) => <OrderedNotice order={order()} />}
            </Show>
          }
        >
          {(order) => (
            <Notice tone="neutral" title="The order could not be confirmed">
              <Text size="caption" tone="muted">
                {order().detail}
              </Text>
            </Notice>
          )}
        </Show>
      }
    >
      {(order) => (
        <Notice tone="danger" title="No legal order for these moves">
          <Stack gap="2xs">
            <Text size="caption" tone="danger">
              Nothing in this team's set can be submitted until these operations no longer conflict.
            </Text>
            <For each={order().conflicts}>
              {(conflict) => (
                <Text size="caption" tone="danger">
                  {conflict.detail}
                </Text>
              )}
            </For>
          </Stack>
        </Notice>
      )}
    </Show>
  );
}

function ExecutedOrder(props: ExecutedOrderProps): JSX.Element {
  const sent = (): ReadonlyArray<TransactionReviewItemView> =>
    props.items
      .filter((item) => item.execution?.position !== undefined)
      .sort((left, right) => (left.execution?.position ?? 0) - (right.execution?.position ?? 0));
  return (
    <Show when={sent().length > 0}>
      <Notice tone="neutral" title="What was sent">
        <Stack gap="2xs">
          <For each={sent()}>
            {(item) => {
              const outcome = item.execution?.outcome ?? "skipped";
              return (
                <Text size="caption" tone={isAttention(outcome) ? "danger" : "muted"}>
                  {`${moveSummary(item)} — ${sentOutcomeLabel(item, outcome)}`}
                </Text>
              );
            }}
          </For>
        </Stack>
      </Notice>
    </Show>
  );
}

function OrderedNotice(props: OrderedNoticeProps): JSX.Element {
  return (
    <Notice tone="neutral" title="When these moves run">
      <Stack gap="2xs">
        <Text size="caption" tone="muted">
          {orderEffectiveLine(props.order)}
        </Text>
        <Show when={props.order.rosterPlaces}>
          {(places) => (
            <Text size="caption" tone="faint">
              {rosterPlacesLine(places())}
            </Text>
          )}
        </Show>
      </Stack>
    </Notice>
  );
}

function rosterPlacesLine(
  places: NonNullable<Extract<TransactionReviewOrderView, { status: "ordered" }>["rosterPlaces"]>,
): string {
  const { maximum, occupied, net } = places;
  const change =
    net === 0
      ? "leaves the count unchanged"
      : net > 0
        ? `frees ${placeCount(net)}`
        : `uses ${placeCount(-net)}`;
  return `This team holds ${String(occupied)} of ${String(maximum)} roster places; the set ${change}.`;
}

function placeCount(count: number): string {
  return `${String(count)} ${count === 1 ? "place" : "places"}`;
}

function orderEffectiveLine(
  order: Extract<TransactionReviewOrderView, { status: "ordered" }>,
): string {
  switch (order.timing) {
    case "same_day":
    case "next_day":
      return order.effectiveDate === undefined
        ? "The league did not publish the roster-change date."
        : `The league applies these moves on ${order.effectiveDate}.`;
    case "weekly_lock":
      return "The league applies these moves in its scoring week.";
    case "not_published":
      return "The league did not publish when it applies roster changes.";
  }
}

function TeamProposal(props: TeamProposalProps): JSX.Element {
  const headingId = (): string => `team-${props.team.team.id}`;
  return (
    <Stack as="section" gap="sm" labelledBy={headingId()}>
      <Stack gap="xs">
        <SectionTitle
          id={headingId()}
          focusable
          action={
            <TextLink
              params={{ teamId: props.team.team.id }}
              size="caption"
              to="/teams/$teamId/transactions"
            >
              Transactions
            </TextLink>
          }
        >
          <TextLink params={{ teamId: props.team.team.id }} size="item" to="/teams/$teamId">
            {props.team.team.name}
          </TextLink>
        </SectionTitle>
        <Text size="caption" tone="muted">
          {leagueDisplayName(props.team.team.league)} · {sportDisplayName(props.team.team.sport)}{" "}
          {String(props.team.team.season)}
        </Text>
        <Show when={props.team.budget}>
          {(budget) => (
            <Text size="caption" tone="muted">
              {budgetLine(budget())}
            </Text>
          )}
        </Show>
        <Show when={props.team.failure}>
          {(failure) => (
            <Text size="caption" tone="muted">
              {failure()} <TextLink to="/account">Review the connection</TextLink>
            </Text>
          )}
        </Show>
        <Show when={!props.closed && props.team.order}>
          {(order) => <TeamOrder order={order()} />}
        </Show>
        <Show when={props.submitted}>
          <ExecutedOrder items={props.team.items} />
        </Show>
        <Show
          when={
            props.submitted && props.team.lineup?.status !== "not_needed"
              ? props.team.lineup
              : undefined
          }
        >
          {(lineup) => (
            <Notice
              tone={
                lineup().status === "failed" ||
                lineup().status === "blocked" ||
                lineup().status === "uncertain"
                  ? "danger"
                  : "neutral"
              }
              title="Lineup"
            >
              <Text size="caption" tone="muted">
                {lineup().detail}
              </Text>
            </Notice>
          )}
        </Show>
      </Stack>
      <RuleList>
        <For each={props.team.items}>
          {(item) => (
            <ProposalItem
              bid={props.bidFor(item)}
              closed={props.closed}
              submitting={props.submitting}
              included={props.isItemIncluded(item)}
              item={item}
              today={props.team.today}
              tradeProposal={props.team.tradeProposal}
              tradeRules={props.team.tradeRules}
              dismissing={props.dismissing === item.id}
              dismissFailure={props.dismissFailure(item.id)}
              withdrawing={props.withdrawing === item.id}
              onBid={(value) => props.onBid(item.id, value)}
              onToggle={(includedNow) => props.onToggle(item.id, includedNow)}
              onDismiss={() => props.onDismiss(props.team.team.id, item.id, moveSummary(item))}
              onWithdraw={() => props.onWithdraw(props.team.team.id, item.id)}
            />
          )}
        </For>
      </RuleList>
    </Stack>
  );
}

function ProposalItem(props: ProposalItemProps): JSX.Element {
  const stale = (): boolean => props.item.staleness.status === "stale";
  const illegal = (): boolean => props.item.staleness.status === "illegal";
  const blocked = (): boolean => stale() || illegal();
  const waiting = (): boolean => {
    const window = props.item.window;
    return window !== undefined && props.today !== undefined && window > props.today;
  };
  const waitingLine = (): string | undefined => {
    const window = props.item.window;
    if (window === undefined || !waiting()) {
      return undefined;
    }
    const date = formatCalendarDate(window);
    return props.item.approvedAt === undefined
      ? `Runs on ${date} once you submit.`
      : `Waits for ${date}. Approved ${formatCalendarDate(props.item.approvedAt)}.`;
  };
  const fallbackLine = (): string | undefined => {
    if (props.item.state !== "proposed") {
      return undefined;
    }
    const names = (props.item.fallbacks ?? []).flatMap((player) =>
      player.name === undefined ? [] : [player.name],
    );
    return names.length === 0 ? undefined : `If the first choice is gone: ${names.join(", ")}.`;
  };
  const result = (): TransactionReviewExecutionView | undefined => props.item.execution;
  const shownResult = (): TransactionReviewExecutionView | undefined => {
    const execution = result();
    return props.item.kind === "trade" && execution?.outcome === "pending" ? undefined : execution;
  };
  const trade = (): TransactionReviewTradeView | undefined => props.item.trade;
  const incomingPicks = (): ReadonlyArray<TransactionReviewTradePickView> =>
    props.item.picks.filter((pick) => pick.from.ref === props.item.counterparty?.ref);
  const outgoingPicks = (): ReadonlyArray<TransactionReviewTradePickView> =>
    props.item.picks.filter((pick) => pick.to.ref === props.item.counterparty?.ref);
  const slotIssues = (): ReadonlyArray<string> =>
    props.item.staleness.reasons
      .filter((reason) => reason.code === "slot_illegal")
      .map((reason) => reason.detail);
  const orderIssues = (): ReadonlyArray<string> =>
    props.item.staleness.reasons
      .filter((reason) => reason.code === "order_conflict" || reason.code === "order_unresolved")
      .map((reason) => reason.detail);
  const orderIssueTitle = (): string =>
    props.item.staleness.reasons.some((reason) => reason.code === "order_unresolved")
      ? "The order could not be confirmed"
      : "No legal order for this team's moves";
  const factIssues = (): ReadonlyArray<string> =>
    props.item.staleness.reasons
      .filter(
        (reason) =>
          reason.code !== "slot_illegal" &&
          reason.code !== "order_conflict" &&
          reason.code !== "order_unresolved",
      )
      .map((reason) => reason.detail);
  const checkId = (): string =>
    slotIssues().length > 0
      ? `illegal-${props.item.id}`
      : orderIssues().length > 0
        ? `order-${props.item.id}`
        : `stale-${props.item.id}`;
  const checkLabel = (): string =>
    blocked()
      ? orderIssues().length > 0
        ? "Refused, not included"
        : illegal()
          ? "Illegal, not included"
          : "Stale, not included"
      : "Include";
  return (
    <RuleListItem layout={result() !== undefined || blocked() ? "stack" : "leading"}>
      <Show when={!props.closed && props.item.state === "proposed"}>
        <CheckboxField
          checked={props.included}
          disabled={blocked() || props.submitting || props.dismissing}
          label={checkLabel()}
          ariaLabel={`${checkLabel()}: ${moveSummary(props.item)}`}
          describedBy={blocked() ? checkId() : undefined}
          onChange={props.onToggle}
        />
      </Show>

      <Stack gap="md">
        <Inline gap="sm" align="baseline">
          <Badge tone={props.item.kind === "waiver_claim" ? "accent" : "neutral"}>
            {kindLabel(props.item.kind)}
          </Badge>
          <Show when={trade()}>
            {(state) => (
              <Badge
                tone={
                  state().state === "pending" || state().state === "accepted" ? "accent" : "neutral"
                }
              >
                {tradeStateLabel(state().state)}
              </Badge>
            )}
          </Show>
          <Show when={props.item.state === "dismissed"}>
            <Badge tone="neutral">Dismissed</Badge>
          </Show>
          <Show when={trade() === undefined ? result() : undefined}>
            {(execution) => (
              <Badge tone={isAttention(execution().outcome) ? "neutral" : "accent"}>
                {outcomeLabel(execution().outcome)}
              </Badge>
            )}
          </Show>
          <Text as="span" size="caption" tone="muted">
            {consequenceLine(props.item, props.bid)}
          </Text>
        </Inline>

        <Show when={waitingLine()}>
          {(line) => (
            <Text size="caption" tone="muted">
              {line()}
            </Text>
          )}
        </Show>

        <Show when={fallbackLine()}>
          {(line) => (
            <Text size="caption" tone="muted">
              {line()}
            </Text>
          )}
        </Show>

        <Show when={props.item.counterparty}>
          {(counterparty) => (
            <Stack gap="xs">
              <Text size="body" weight="semibold">
                Offer to {counterparty().name ?? "the counterparty team"}
              </Text>
              <Text size="caption" tone="muted">
                {trade()?.state === "accepted"
                  ? "The other manager accepted this offer, so both rosters changed."
                  : trade()?.state === "withdrawn" || trade()?.state === "expired"
                    ? "This offer is no longer pending with the other manager."
                    : counterparty().managerName === undefined
                      ? "The other team's manager decides. We cannot accept or reject on their behalf."
                      : `${counterparty().managerName} decides. We cannot accept or reject on their behalf.`}{" "}
                {trade()?.state === "accepted"
                  ? "Lineupgrade could not have accepted it for them."
                  : trade()?.state === "withdrawn" || trade()?.state === "expired"
                    ? "It did not change either roster."
                    : "This is an offer, not a change to either roster."}
              </Text>
            </Stack>
          )}
        </Show>

        <Split
          columns={
            props.item.adds.length + incomingPicks().length > 0 &&
            props.item.drops.length + outgoingPicks().length > 0
              ? 2
              : undefined
          }
        >
          <Show when={props.item.adds.length + incomingPicks().length > 0}>
            <PlayerColumn
              label={props.item.kind === "trade" ? "You receive" : "Add"}
              players={props.item.adds}
              picks={incomingPicks()}
            />
          </Show>
          <Show when={props.item.drops.length + outgoingPicks().length > 0}>
            <PlayerColumn
              label={props.item.kind === "trade" ? "You send" : "Drop"}
              players={props.item.drops}
              picks={outgoingPicks()}
            />
          </Show>
        </Split>

        <Show when={props.bid}>
          {(bid) => (
            <Show
              when={bid().editable}
              fallback={<BidFact proposed={bid().proposed} sentBid={bid().sentBid} />}
            >
              <TextField
                label={`FAAB bid for ${playerNames(props.item.adds) ?? "this claim"}`}
                description={`Proposed at ${String(bid().proposed)} FAAB. Your bid applies to this submission.`}
                error={bid().error}
                type="number"
                min="0"
                step="1"
                inputmode="numeric"
                value={bid().value}
                disabled={props.submitting || props.dismissing}
                onInput={(event) => props.onBid(event.currentTarget.value)}
              />
            </Show>
          )}
        </Show>

        <Show
          when={
            props.item.picks.length > 0 &&
            props.tradeProposal !== undefined &&
            !props.tradeProposal.assets.includes("draft_pick")
          }
        >
          <Notice tone="neutral" title="Draft picks cannot be sent yet">
            <Text size="caption" tone="muted">
              {props.tradeProposal?.detail ??
                "This connection's trade request cannot carry a draft pick."}
            </Text>
          </Notice>
        </Show>

        <Show
          when={
            !blocked() &&
            (result() === undefined || result()?.outcome === "executed") &&
            props.item.placement
          }
        >
          {(placement) => (
            <Notice
              tone="neutral"
              title={result() === undefined ? "Where it goes" : "Where it went"}
            >
              <Text size="caption" tone="muted">
                {placement().detail}
              </Text>
            </Notice>
          )}
        </Show>

        <Show when={!blocked() && result() === undefined && props.item.slotMove}>
          {(move) => (
            <Notice tone="neutral" title="Slot move">
              <Text size="caption" tone="muted">
                Move {move().playerName ?? "this player"} to {move().toSlot}. It runs where the
                roster stays legal.
              </Text>
            </Notice>
          )}
        </Show>

        <Show when={!blocked() && result() === undefined && props.item.reserveMove}>
          {(move) => (
            <Notice
              tone="neutral"
              title={move().order === "after" ? "Roster move after" : "Roster move first"}
            >
              <Text size="caption" tone="muted">
                Move {move().playerName ?? "this player"} from{" "}
                {move().fromSlot ?? "its reported slot"} to {move().toSlot}{" "}
                {move().order === "after"
                  ? "after the transaction, because only the transaction frees that slot."
                  : "before the transaction."}{" "}
                It is reported as its own step.
              </Text>
            </Notice>
          )}
        </Show>

        <Show when={props.item.kind === "trade" && props.tradeRules}>
          {(rules) => (
            <Stack gap="2xs">
              <Text size="caption" tone="muted">
                {tradeRatificationLine(rules().ratification)} {tradeDeadlineLine(rules().endDate)}
              </Text>
              <Text size="caption" tone="faint">
                {trade()?.state === "pending" || trade() === undefined
                  ? "You are making an offer. The other manager decides; Lineupgrade cannot accept, reject, vote, or counter for them."
                  : "This offer is settled. Lineupgrade never accepts, rejects, votes, or counters for another manager."}
              </Text>
            </Stack>
          )}
        </Show>

        <Show when={trade()}>
          {(state) => (
            <Stack gap="2xs">
              <Text size="caption" tone="muted">
                Sent{" "}
                <Time datetime={state().requestedAt}>{formatReaderTime(state().requestedAt)}</Time>
                <Show
                  when={state().proposedAt === undefined}
                  fallback={
                    <>
                      {" "}
                      · listed{" "}
                      <Time datetime={state().proposedAt ?? state().requestedAt}>
                        {formatReaderTime(state().proposedAt ?? state().requestedAt)}
                      </Time>
                    </>
                  }
                >
                  {""}
                </Show>
                <Show
                  when={state().settledAt === undefined}
                  fallback={
                    <>
                      {" "}
                      · {tradeStateLabel(state().state)}{" "}
                      <Time datetime={state().settledAt ?? state().requestedAt}>
                        {formatReaderTime(state().settledAt ?? state().requestedAt)}
                      </Time>
                    </>
                  }
                >
                  {""}
                </Show>
                .
              </Text>
              <Show when={state().detail}>
                {(detail) => (
                  <Text size="caption" tone="muted">
                    {detail()}
                  </Text>
                )}
              </Show>
            </Stack>
          )}
        </Show>

        <Quote label="Reason">
          <Text size="body">{props.item.reason}</Text>
        </Quote>

        <Show when={stale() && factIssues().length > 0}>
          <Notice
            id={`stale-${props.item.id}`}
            tone="danger"
            title="No longer current"
            items={factIssues()}
          />
        </Show>

        <Show when={orderIssues().length > 0}>
          <Notice
            id={`order-${props.item.id}`}
            tone="danger"
            title={orderIssueTitle()}
            items={orderIssues()}
          />
        </Show>

        <Show when={slotIssues().length > 0}>
          <Notice
            id={`illegal-${props.item.id}`}
            tone="danger"
            title="Illegal roster position"
            items={slotIssues()}
          />
        </Show>

        <Show when={!stale() && factIssues().length > 0}>
          <Notice
            id={`stale-${props.item.id}`}
            tone="danger"
            title="This move cannot be made"
            items={factIssues()}
          />
        </Show>

        <Show when={trade()?.state === "pending"}>
          <Inline gap="sm" align="baseline" collapse>
            <Button
              variant="secondary"
              state={props.withdrawing ? "working" : "idle"}
              onClick={props.onWithdraw}
            >
              Withdraw offer
            </Button>
            <Text size="caption" tone="muted">
              Withdrawing deletes the offer before it is accepted. It does not cancel anything
              already accepted.
            </Text>
          </Inline>
        </Show>

        <Show when={props.item.state === "dismissed" && props.item.outcomeDetail}>
          {(detail) => (
            <Notice tone="neutral" title="Dismissed from this plan">
              <Text size="caption" tone="muted">
                {detail()}
              </Text>
            </Notice>
          )}
        </Show>

        <Show
          when={!props.closed && (props.item.state === "proposed" || props.item.state === "failed")}
        >
          <Form gap="sm" onSubmit={props.onDismiss}>
            <Inline gap="sm" align="baseline" collapse>
              <Button
                type="submit"
                variant="secondary"
                state={props.dismissing ? "working" : "idle"}
                disabled={props.submitting}
                data-dismiss-item={props.item.id}
                aria-label={`${props.dismissing ? "Dismissing" : "Dismiss"}: ${moveSummary(props.item)}`}
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

        <Show when={shownResult()}>
          {(execution) => (
            <ExecutionResult execution={execution()} isTrade={props.item.kind === "trade"} />
          )}
        </Show>
      </Stack>
    </RuleListItem>
  );
}

function ExecutionResult(props: {
  readonly execution: TransactionReviewExecutionView;
  readonly isTrade: boolean;
}): JSX.Element {
  const note = (): string | undefined =>
    props.execution.detail !== undefined &&
    !props.execution.steps.some((step) => step.detail === props.execution.detail)
      ? props.execution.detail
      : undefined;
  return (
    <Stack gap="sm">
      <Show when={props.execution.position !== undefined}>
        <Text size="caption" tone="faint">
          {`Sent in this submission.`}
        </Text>
      </Show>
      <Show when={props.execution.steps.length > 0}>
        <RuleList>
          <For each={props.execution.steps}>
            {(step) => (
              <RuleListItem layout="stack">
                <Inline gap="sm" align="baseline">
                  <Text size="caption" weight="semibold">
                    {stepLabel(step)}
                  </Text>
                  <Text size="caption" tone={isAttention(step.outcome) ? "danger" : "muted"}>
                    {outcomeLabel(step.outcome)}
                  </Text>
                </Inline>
                <Show when={step.detail}>
                  {(detail) => (
                    <Text size="caption" tone="muted">
                      {detail()}
                    </Text>
                  )}
                </Show>
              </RuleListItem>
            )}
          </For>
        </RuleList>
      </Show>
      <Show when={note()}>
        {(detail) => (
          <Text size="caption" tone="muted">
            {detail()}
          </Text>
        )}
      </Show>
      <Show when={props.execution.outcome === "failed"}>
        <Notice tone="danger" title="This move failed">
          <Text size="caption" tone="danger">
            It was attempted once and not retried. Read the detail above before proposing it again.
          </Text>
          <Show when={props.execution.detail?.toLowerCase().includes("without giving a reason")}>
            <Text size="caption" tone="danger">
              No reason was given. Check the roster and the league's transaction rules before trying
              again.
            </Text>
          </Show>
        </Notice>
      </Show>
      <Show when={props.execution.outcome === "unknown"}>
        <Notice tone="danger" title="Not confirmed">
          <Text size="caption" tone="danger">
            This move may or may not have applied. It was not retried. Check the team before
            proposing another move.
          </Text>
        </Notice>
      </Show>
      <Show when={props.execution.outcome === "pending"}>
        <Notice
          tone="neutral"
          title={props.isTrade ? "Waiting for the other manager" : "Pending on waivers"}
        >
          <Text size="caption" tone="muted">
            {props.isTrade
              ? "This is a real offer. The other manager alone can accept or reject it; Lineupgrade cannot answer for them."
              : "Waivers run later, so this claim is pending rather than done or failed."}
          </Text>
        </Notice>
      </Show>
      <Show when={props.execution.outcome === "skipped" && props.execution.steps.length > 0}>
        <Notice tone="neutral" title="Skipped">
          <Text size="caption" tone="muted">
            This move was left out or stopped before it could be sent. The reason is above.
          </Text>
        </Notice>
      </Show>
    </Stack>
  );
}

function BidFact(props: BidFactProps): JSX.Element {
  return (
    <Text size="caption" tone="muted">
      <Show fallback={`Proposed at ${String(props.proposed)} FAAB.`} when={props.sentBid}>
        {(bid) =>
          bid() === props.proposed
            ? `Bid ${String(bid())} FAAB sent.`
            : `Bid ${String(bid())} FAAB sent; proposed at ${String(props.proposed)} FAAB.`
        }
      </Show>
    </Text>
  );
}

function PlayerColumn(props: PlayerColumnProps): JSX.Element {
  return (
    <Stack gap="xs">
      <Text size="caption" tone="faint" weight="semibold">
        {props.label}
      </Text>
      <For each={props.players}>
        {(player) => (
          <Stack gap="2xs">
            <Text size="item" weight="semibold" wrap="words">
              {player.name ?? "Player name unavailable"}
            </Text>
            <Show when={playerDetailLine(player)}>
              {(detail) => (
                <Text size="caption" tone="muted">
                  {detail()}
                </Text>
              )}
            </Show>
          </Stack>
        )}
      </For>
      <For each={props.picks}>
        {(pick) => (
          <Text size="caption" tone="muted" wrap="words">
            {tradePickLine(pick)}
          </Text>
        )}
      </For>
    </Stack>
  );
}

function PendingOffers(props: PendingOffersProps): JSX.Element {
  return (
    <Stack as="section" gap="sm" labelledBy="pending-offers-title">
      <Stack gap="xs">
        <SectionTitle id="pending-offers-title">Offers pending in your league</SectionTitle>
        <Text size="caption" tone="muted">
          An offer Lineupgrade did not create still appears here, so you can withdraw it before it
          is accepted.
        </Text>
      </Stack>
      <RuleList>
        <For each={props.offers}>
          {(entry) => (
            <RuleListItem layout="stack">
              <Stack gap="sm">
                <Inline gap="sm" align="baseline">
                  <Badge tone="neutral">Offer</Badge>
                  <Text size="item" weight="semibold">
                    {entry.team.team.name}
                  </Text>
                  <Text size="caption" tone="muted">
                    {offerParties(entry.offer)}
                  </Text>
                </Inline>
                <Text size="caption" tone="muted">
                  Sent{" "}
                  <Time datetime={entry.offer.proposedAt}>
                    {formatReaderTime(entry.offer.proposedAt)}
                  </Time>
                  .
                </Text>
                <Stack gap="2xs">
                  <For each={entry.offer.players}>
                    {(player) => (
                      <Text size="caption" tone="muted">
                        {player.name ?? "Unnamed player"}
                        {player.displayPosition === undefined ? "" : ` · ${player.displayPosition}`}
                        {player.proTeam === undefined ? "" : ` · ${player.proTeam}`}
                        {player.from?.name === undefined && player.to?.name === undefined
                          ? ""
                          : ` · ${player.from?.name ?? "no team"} to ${player.to?.name ?? "no team"}`}
                      </Text>
                    )}
                  </For>
                  <Show when={entry.offer.picks.length > 0}>
                    <Text size="caption" tone="faint">
                      {entry.offer.picks
                        .map(
                          (pick) =>
                            `Round ${String(pick.round)} pick from ${pick.from?.name ?? "unknown"} to ${pick.to?.name ?? "unknown"}`,
                        )
                        .join("; ")}
                    </Text>
                  </Show>
                  <Show when={entry.offer.note}>
                    {(note) => (
                      <Text size="caption" tone="muted">
                        Note: {note()}
                      </Text>
                    )}
                  </Show>
                  <Show when={entry.offer.incomplete}>
                    {(detail) => (
                      <Text size="caption" tone="danger">
                        {detail()}
                      </Text>
                    )}
                  </Show>
                </Stack>
                <Show
                  fallback={
                    <Inline gap="sm" align="baseline" collapse>
                      <Button
                        variant="secondary"
                        state={props.withdrawing === entry.offer.offerRef ? "working" : "idle"}
                        onClick={() => props.onWithdraw(entry.team.team.id, entry.offer.offerRef)}
                      >
                        Withdraw offer
                      </Button>
                      <Text size="caption" tone="muted">
                        Withdrawing deletes this offer before it is accepted.
                      </Text>
                    </Inline>
                  }
                  when={entry.offer.canRespond}
                >
                  <Text size="caption" tone="muted">
                    This offer is waiting for your answer in your league. Accepting or rejecting it
                    is yours; Lineupgrade cannot answer for you.
                  </Text>
                </Show>
              </Stack>
            </RuleListItem>
          )}
        </For>
      </RuleList>
    </Stack>
  );
}

function offerParties(offer: TransactionReviewPendingOfferView): string {
  const from = offer.proposingTeam?.name ?? "Unknown team";
  const to = offer.receivingTeam?.name ?? "Unknown team";
  return `${from} to ${to}`;
}

function offerMatchesItem(
  team: TransactionReviewTeamView,
  offer: TransactionReviewPendingOfferView,
): boolean {
  if (offer.proposingTeam?.name !== team.team.name) {
    return false;
  }
  const names = (players: ReadonlyArray<{ readonly name?: string }>): string =>
    players
      .flatMap((player) => (player.name === undefined ? [] : [player.name]))
      .sort()
      .join("|");
  const offerNames = names(offer.players);
  return team.items.some(
    (item) =>
      item.kind === "trade" &&
      item.trade?.state === "pending" &&
      item.counterparty?.ref === offer.receivingTeam?.ref &&
      names([...item.adds, ...item.drops]) === offerNames,
  );
}

function QuietTeams(props: QuietTeamsProps): JSX.Element {
  return (
    <Stack as="section" gap="sm" labelledBy="quiet-teams-title">
      <SectionTitle id="quiet-teams-title">Teams with nothing proposed</SectionTitle>
      <Text size="body" tone="muted">
        {props.teams.map((team) => team.team.name).join(", ")}
      </Text>
    </Stack>
  );
}

function SubmissionPanel(props: SubmissionPanelProps): JSX.Element {
  const waitsUntil = (): string | undefined =>
    props.waitsUntil === undefined ? undefined : formatCalendarDate(props.waitsUntil);
  return (
    <Dock id="submission-panel">
      <Box rule="top" space="lg">
        <Show when={props.illegalTeams.length > 0}>
          <Stack gap="sm">
            <For each={props.illegalTeams}>
              {(team) => (
                <Notice
                  tone="danger"
                  title={`${team.team.name} roster is illegal`}
                  items={(team.illegalRoster ?? []).map((occupant) => occupant.detail)}
                />
              )}
            </For>
          </Stack>
        </Show>
        <Form gap="sm" onSubmit={props.onSubmit}>
          <Stack as="section" gap="sm" labelledBy="submission-title">
            <SectionTitle id="submission-title">Submit</SectionTitle>
            <Inline gap="lg" justify="between" collapse>
              <Stack gap="xs">
                <Text size="body" weight="semibold" live="polite">
                  {includedTally(
                    props.included,
                    props.total,
                    props.waivers,
                    props.faab,
                    props.submitting,
                  )}
                </Text>
                <Text id="submission-note" size="caption" tone="muted">
                  Each move is sent once, with no retries. A waiver claim stays pending until
                  waivers run. A trade becomes a real offer to another manager: submitting again or
                  reloading will not undo it, and only withdrawing removes it before it is accepted.
                </Text>
                <Show when={props.includedWaiting > 0}>
                  <Text size="caption" tone="muted">
                    {props.includedWaiting}{" "}
                    {props.includedWaiting === 1 ? "move waits" : "moves wait"}
                    {waitsUntil() === undefined ? "" : ` until ${waitsUntil()}`}. Submitting
                    approves {props.includedWaiting === 1 ? "it" : "them"};{" "}
                    {props.includedWaiting === 1
                      ? "it still runs on its date"
                      : "they still run on their dates"}
                    .
                  </Text>
                </Show>
                <Show when={props.staleCount > 0}>
                  <Text size="caption" tone="muted">
                    {props.staleCount} stale {props.staleCount === 1 ? "move is" : "moves are"}{" "}
                    excluded.
                  </Text>
                </Show>
                <Show when={props.illegalCount > 0}>
                  <Text size="caption" tone="muted">
                    {props.illegalCount} illegal{" "}
                    {props.illegalCount === 1 ? "move is" : "moves are"} excluded.
                  </Text>
                </Show>
              </Stack>
              <Button
                type="submit"
                state={props.submitting ? "working" : "idle"}
                disabled={props.included === 0 || props.submitting || props.dismissing}
                aria-describedby="submission-note"
              >
                {submitLabel(props.includedDue, props.includedWaiting, waitsUntil())}
              </Button>
            </Inline>
          </Stack>
        </Form>
      </Box>
    </Dock>
  );
}

function budgetLine(budget: NonNullable<TransactionReviewTeamView["budget"]>): string {
  return budget.status === "published" ? `FAAB left: ${String(budget.remaining)}.` : budget.detail;
}

function moveSummary(item: TransactionReviewItemView): string {
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
  return "this move";
}

function playerNames(players: ReadonlyArray<TransactionReviewPlayerView>): string | undefined {
  const names = players.flatMap((player) => (player.name === undefined ? [] : [player.name]));
  if (names.length === 0) {
    return undefined;
  }
  if (names.length === 1) {
    return names[0];
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function tradePickLine(pick: TransactionReviewTradePickView): string {
  return `Round ${String(pick.round)} pick from ${pick.from.name} to ${pick.to.name}`;
}

function playerDetailLine(player: TransactionReviewPlayerView): string | undefined {
  const identity = [player.position, player.proTeam]
    .flatMap((value) => (value === undefined ? [] : [value]))
    .join(" · ");
  if (identity === "") {
    return player.availability;
  }
  return player.availability === undefined ? identity : `${identity} · ${player.availability}`;
}

function kindLabel(kind: TransactionReviewItemView["kind"]): string {
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

function consequenceLine(
  item: TransactionReviewItemView,
  bid: TransactionReviewBidField | undefined,
): string {
  if (item.kind === "slot_move") {
    return "Same roster. Reversible while the player is editable.";
  }
  if (item.kind === "trade") {
    switch (item.trade?.state) {
      case "accepted":
        return "Accepted by the other manager. Both rosters changed, and submitting again cannot undo it.";
      case "withdrawn":
        return "Withdrawn before acceptance. The offer is gone, and submitting again does nothing.";
      case "expired":
        return "It was declined or expired; your league keeps no record of which.";
      case "pending":
      case undefined:
        return "An offer, not a change. Only the other manager decides, and submitting again does not undo it.";
    }
  }
  if (item.kind !== "waiver_claim") {
    return "No FAAB. Usually reversible.";
  }
  const amount = bid !== undefined && bid.editable ? readWaiverBid(bid.value).bid : bid?.sentBid;
  return amount === undefined
    ? "Spends FAAB and cannot be undone."
    : `Spends ${String(amount)} FAAB and cannot be undone.`;
}

function tradeStateLabel(state: TransactionReviewTradeView["state"]): string {
  switch (state) {
    case "pending":
      return "Pending with the other manager";
    case "accepted":
      return "Accepted";
    case "withdrawn":
      return "Withdrawn";
    case "expired":
      return "Expired";
  }
}

function tradeRatificationLine(
  ratification: TransactionReviewTradeRulesView["ratification"],
): string {
  switch (ratification) {
    case "vote":
      return "League review: a vote follows if the other manager accepts.";
    case "commissioner":
      return "League review: the commissioner reviews a trade the other manager accepts.";
    case "none":
      return "League review: none. An accepted trade stands immediately.";
    case "unknown":
      return "League review: the rule is not one Lineupgrade can name, so your league's trade page is the authority.";
    case undefined:
      return "League review: the league publishes no review rule.";
  }
}

function tradeDeadlineLine(endDate: string | undefined): string {
  return endDate === undefined
    ? "The league publishes no trade deadline."
    : `Trading closes ${endDate}.`;
}

function includedTally(
  included: number,
  total: number,
  waivers: number,
  faab: number,
  submitting: boolean,
): string {
  const base = `${String(included)} of ${String(total)} ${total === 1 ? "move" : "moves"} included.`;
  const spending =
    waivers === 0
      ? "No FAAB is spent."
      : `${String(waivers)} waiver ${waivers === 1 ? "claim spends" : "claims spend"} ${String(faab)} FAAB.`;
  return submitting ? `${base} ${spending} Sending now.` : `${base} ${spending}`;
}

function submitLabel(due: number, waiting: number, waitsUntil: string | undefined): string {
  const base = due === 0 ? "Submit moves" : `Submit ${String(due)} ${due === 1 ? "move" : "moves"}`;
  if (waiting === 0 || waitsUntil === undefined) {
    return base;
  }
  return `${base}; ${String(waiting)} ${waiting === 1 ? "waits" : "wait"} until ${waitsUntil}`;
}

function outcomeLabel(outcome: TransactionReviewModelOutcome): string {
  switch (outcome) {
    case "executed":
      return "Executed";
    case "pending":
      return "Pending on waivers";
    case "failed":
      return "Failed";
    case "skipped":
      return "Skipped";
    case "unknown":
      return "Unknown, may have applied";
  }
}

function isAttention(outcome: TransactionReviewModelOutcome): boolean {
  return outcome === "failed" || outcome === "unknown";
}

function sentOutcomeLabel(
  item: TransactionReviewItemView,
  outcome: TransactionReviewModelOutcome,
): string {
  return item.kind === "trade" && outcome === "pending"
    ? "Waiting for the other manager"
    : outcomeLabel(outcome);
}

function stepLabel(step: TransactionReviewStepView): string {
  switch (step.kind) {
    case "reserve_move":
    case "slot_move":
      return `Move ${step.playerName ?? "player"} to ${step.toSlot ?? "reserve"}${
        step.fromSlot === undefined ? "" : ` from ${step.fromSlot}`
      }`;
    case "add":
      return `Add ${step.playerName ?? "player"}`;
    case "drop":
      return `Drop ${step.playerName ?? "player"}`;
  }
}

function outcomeSummary(
  counts: TransactionReviewModel["counts"],
  review: TransactionReviewView,
  waiting: number,
): string {
  const trades = review.teams.flatMap((team) => team.items).filter((item) => item.kind === "trade");
  const tradeExecutionPending = trades.filter(
    (item) => item.execution?.outcome === "pending",
  ).length;
  const tradePending = trades.filter((item) => item.trade?.state === "pending").length;
  const tradeAccepted = trades.filter((item) => item.trade?.state === "accepted").length;
  const tradeWithdrawn = trades.filter((item) => item.trade?.state === "withdrawn").length;
  const tradeExpired = trades.filter((item) => item.trade?.state === "expired").length;
  const pending = counts.pending - tradeExecutionPending;
  const parts = [
    counts.executed > 0 ? `${String(counts.executed)} executed` : undefined,
    pending > 0 ? `${String(pending)} pending on waivers` : undefined,
    tradePending > 0 ? `${String(tradePending)} waiting for the other manager` : undefined,
    tradeAccepted > 0 ? `${String(tradeAccepted)} accepted` : undefined,
    tradeWithdrawn > 0 ? `${String(tradeWithdrawn)} withdrawn` : undefined,
    tradeExpired > 0 ? `${String(tradeExpired)} expired` : undefined,
    counts.failed > 0 ? `${String(counts.failed)} failed` : undefined,
    counts.unknown > 0 ? `${String(counts.unknown)} unknown` : undefined,
    counts.skipped > 0 ? `${String(counts.skipped)} skipped` : undefined,
    waiting > 0 ? `${String(waiting)} waiting for a later date` : undefined,
  ].flatMap((part) => (part === undefined ? [] : [part]));
  return parts.length === 0 ? "No outcome was recorded." : `${parts.join(" · ")}.`;
}

function proposerLabel(kind: TransactionReviewView["set"]["proposedBy"]["kind"]): string {
  return kind === "agent" ? "an agent" : "you";
}

function moveCount(count: number): string {
  return `${String(count)} ${count === 1 ? "move" : "moves"}`;
}

function teamCount(count: number): string {
  return `${String(count)} ${count === 1 ? "team" : "teams"}`;
}

type TransactionReviewPageProps = {
  readonly reviewQuery: Accessor<TransactionReviewQueryOptions>;
  readonly remote: Accessor<TransactionRemote>;
};

type ReviewProps = {
  readonly model: TransactionReviewModel;
  readonly bidFor: (item: TransactionReviewItemView) => TransactionReviewBidField | undefined;
  readonly isItemIncluded: (item: TransactionReviewItemView) => boolean;
  readonly onBid: (item: string, value: string) => void;
  readonly onToggle: (item: string, included: boolean) => void;
  readonly onSubmit: () => void;
  readonly submitting: boolean;
  readonly dismissItem: (team: string, item: string, label: string) => void;
  readonly dismissing: string | undefined;
  readonly dismissFailure: (item: string) => string | undefined;
  readonly withdrawItem: (team: string, item: string) => void;
  readonly withdrawOffer: (team: string, offer: string) => void;
  readonly withdrawing: string | undefined;
  readonly feedback: ActionFeedbackState | undefined;
};

type ReviewFailureProps = {
  readonly error: unknown;
  readonly onRetry: () => Promise<void>;
  readonly signIn: RecoveryAction;
};

type ProposalSummaryProps = {
  readonly review: TransactionReviewView;
  readonly checkedAt: string | undefined;
  readonly staleCount: number;
  readonly illegalCount: number;
  readonly total: number;
  readonly teamCount: number;
};

type SubmittedSummaryProps = {
  readonly review: TransactionReviewView;
  readonly settling: boolean;
  readonly submittedAt: string;
  readonly submissionCount: number;
  readonly closed: boolean;
  readonly finished: boolean;
  readonly waiting: number;
  readonly counts: TransactionReviewModel["counts"];
};

type ClosedSummaryProps = {
  readonly review: TransactionReviewView;
  readonly total: number;
};

type TeamProposalProps = {
  readonly team: TransactionReviewTeamView;
  readonly closed: boolean;
  readonly submitted: boolean;
  readonly submitting: boolean;
  readonly bidFor: (item: TransactionReviewItemView) => TransactionReviewBidField | undefined;
  readonly isItemIncluded: (item: TransactionReviewItemView) => boolean;
  readonly dismissing: string | undefined;
  readonly dismissFailure: (item: string) => string | undefined;
  readonly withdrawing: string | undefined;
  readonly onBid: (item: string, value: string) => void;
  readonly onToggle: (item: string, included: boolean) => void;
  readonly onDismiss: (team: string, item: string, label: string) => void;
  readonly onWithdraw: (team: string, item: string) => void;
};

type TeamOrderProps = {
  readonly order: TransactionReviewOrderView;
};

type OrderedNoticeProps = {
  readonly order: Extract<TransactionReviewOrderView, { status: "ordered" }>;
};

type ExecutedOrderProps = {
  readonly items: ReadonlyArray<TransactionReviewItemView>;
};

type ProposalItemProps = {
  readonly item: TransactionReviewItemView;
  readonly today: string | undefined;
  readonly bid: TransactionReviewBidField | undefined;
  readonly tradeProposal: TransactionReviewTeamView["tradeProposal"];
  readonly tradeRules: TransactionReviewTradeRulesView | undefined;
  readonly closed: boolean;
  readonly submitting: boolean;
  readonly included: boolean;
  readonly dismissing: boolean;
  readonly dismissFailure: string | undefined;
  readonly withdrawing: boolean;
  readonly onBid: (value: string) => void;
  readonly onToggle: (included: boolean) => void;
  readonly onDismiss: () => void;
  readonly onWithdraw: () => void;
};

type BidFactProps = {
  readonly proposed: number;
  readonly sentBid: number | undefined;
};

type PlayerColumnProps = {
  readonly label: string;
  readonly players: ReadonlyArray<TransactionReviewPlayerView>;
  readonly picks: ReadonlyArray<TransactionReviewTradePickView>;
};

type QuietTeamsProps = {
  readonly teams: ReadonlyArray<TransactionReviewTeamView>;
};

type PendingOffersProps = {
  readonly offers: ReadonlyArray<{
    readonly team: TransactionReviewTeamView;
    readonly offer: TransactionReviewPendingOfferView;
  }>;
  readonly withdrawing: string | undefined;
  readonly onWithdraw: (team: string, offer: string) => void;
};

type SubmissionPanelProps = {
  readonly illegalTeams: ReadonlyArray<TransactionReviewTeamView>;
  readonly included: number;
  readonly includedDue: number;
  readonly includedWaiting: number;
  readonly waitsUntil: string | undefined;
  readonly total: number;
  readonly waivers: number;
  readonly faab: number;
  readonly staleCount: number;
  readonly illegalCount: number;
  readonly submitting: boolean;
  readonly dismissing: boolean;
  readonly onSubmit: () => void;
};
