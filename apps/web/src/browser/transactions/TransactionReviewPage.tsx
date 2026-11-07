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
import { formatReaderTime } from "#browser/shared-ui/formatTime.ts";
import { Inline } from "#browser/shared-ui/Inline.tsx";
import { Notice } from "#browser/shared-ui/Notice.tsx";
import { Page } from "#browser/shared-ui/Page.tsx";
import { Quote } from "#browser/shared-ui/Quote.tsx";
import { RuleList, RuleListItem } from "#browser/shared-ui/RuleList.tsx";
import { SectionTitle } from "#browser/shared-ui/SectionTitle.tsx";
import { Split } from "#browser/shared-ui/Split.tsx";
import { Stack } from "#browser/shared-ui/Stack.tsx";
import { Text } from "#browser/shared-ui/Text.tsx";
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
  TransactionReviewTradeRulesView,
  TransactionReviewTradeView,
  TransactionReviewView,
} from "#contracts/connections/transactionContract.ts";

import {
  TransactionReviewAuthenticationFailure,
  TransactionReviewFailure,
} from "./transactionFailure";
import type { TransactionReviewQueryOptions } from "./transactionQueries";
import type { TransactionRemote } from "./transactionRemote";
import { resultSummaryId, useTransactionReviewPage } from "./useTransactionReviewPage";
import type {
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
                isItemIncluded={page.isItemIncluded}
                model={model()}
                onSubmit={page.submit}
                onToggle={page.toggleItem}
                submitting={page.submitting()}
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
  const submitted = (): boolean => props.model.submitted;
  const settled = (): boolean => props.model.settled;
  const canSubmit = (): boolean =>
    !props.model.review.set.expired && !settled() && props.model.proposedCount > 0;
  const providerOffers = (): ReadonlyArray<{
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
            <ProposalSummary
              checkedAt={props.model.checkedAt}
              review={props.model.review}
              staleCount={props.model.staleCount}
              illegalCount={props.model.illegalCount}
              total={props.model.total}
              teamCount={props.model.teamsWithItems.length}
            />
          }
          when={props.model.latestSubmission}
        >
          {(submission) => (
            <SubmittedSummary
              counts={props.model.counts}
              finished={props.model.finished}
              review={props.model.review}
              settled={settled()}
              submissionCount={props.model.submissions.length}
              submittedAt={submission().submittedAt}
            />
          )}
        </Show>
        <Show when={props.model.review.set.expired && !submitted()}>
          <ExpiredNotice expiresAt={props.model.review.set.expiresAt} />
        </Show>
      </Stack>

      <ActionFeedback feedback={props.feedback} />
      <Show
        fallback={
          <EmptyState title="Nothing was proposed.">
            This set has no moves for any team. Ask the agent to propose transactions again.
          </EmptyState>
        }
        when={props.model.total > 0}
      >
        <DockSpacer active={canSubmit()}>
          <Stack gap="xl">
            <For each={props.model.teamsWithItems}>
              {(team) => (
                <TeamProposal
                  expired={props.model.review.set.expired}
                  submitted={submitted()}
                  settled={settled()}
                  submitting={props.submitting}
                  isItemIncluded={props.isItemIncluded}
                  team={team}
                  withdrawing={props.withdrawing}
                  onToggle={props.onToggle}
                  onWithdraw={props.withdrawItem}
                />
              )}
            </For>
            <Show when={providerOffers().length > 0}>
              <ProviderOffers
                offers={providerOffers()}
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
            included={props.model.includedCount}
            staleCount={props.model.staleCount}
            illegalCount={props.model.illegalCount}
            submitting={props.submitting}
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
          </Show>{" "}
          <Show when={!props.review.set.expired}>
            Expires{" "}
            <Time datetime={props.review.set.expiresAt}>
              {formatReaderTime(props.review.set.expiresAt)}
            </Time>
            .
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
    <FocusRegion id={resultSummaryId} labelledBy="submitted-title">
      <Box rule="bottom" space="lg">
        <Stack gap="sm">
          <SectionTitle
            id="submitted-title"
            action={props.settled ? <Badge tone="accent">Audit record</Badge> : undefined}
          >
            Submitted
          </SectionTitle>
          <Text size="body" weight="semibold" live="polite">
            {outcomeSummary(props.counts, props.review)}
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
            {props.settled
              ? "Every move in this set has settled. This set is an audit record; propose a new set for another move."
              : "This set stays open while a move has not settled. A failed or skipped move keeps its outcome here; ask the agent to add a replacement to this set to try again."}
          </Text>
        </Stack>
      </Box>
    </FocusRegion>
  );
}

function ExpiredNotice(props: ExpiredNoticeProps): JSX.Element {
  return (
    <Notice
      tone="neutral"
      title={
        <>
          Expired <Time datetime={props.expiresAt}>{formatReaderTime(props.expiresAt)}</Time>.
        </>
      }
    >
      <Text size="body" tone="muted">
        Nothing can be submitted from this set. Ask the agent to propose these moves again.
      </Text>
    </Notice>
  );
}

function ServerOrder(props: ServerOrderProps): JSX.Element {
  return (
    <Show
      when={props.order.status === "conflict" ? props.order : undefined}
      fallback={
        <Show
          when={props.order.status === "unresolved" ? props.order : undefined}
          fallback={
            <Show when={props.order.status === "ordered" ? props.order : undefined}>
              {(order) => <OrderedNotice order={order()} items={props.items} />}
            </Show>
          }
        >
          {(order) => (
            <Notice tone="neutral" title="The order could not be decided">
              <Text size="caption" tone="muted">
                {order().detail}
              </Text>
            </Notice>
          )}
        </Show>
      }
    >
      {(order) => (
        <Notice tone="danger" title="No order keeps the lineup legal">
          <Stack gap="2xs">
            <Text size="caption" tone="danger">
              This team's whole set is refused. Nothing from it can be submitted until the
              operations below no longer conflict.
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
      <Notice tone="neutral" title="The order each move was sent in">
        <Stack gap="2xs">
          <For each={sent()}>
            {(item) => {
              const outcome = item.execution?.outcome ?? "skipped";
              return (
                <Text size="caption" tone={isAttention(outcome) ? "danger" : "muted"}>
                  {`${String((item.execution?.position ?? 0) + 1)}. ${moveSummary(item)} — ${sentOutcomeLabel(item, outcome)}`}
                </Text>
              );
            }}
          </For>
          <Text size="caption" tone="faint">
            Positions restart with each submission.
          </Text>
        </Stack>
      </Notice>
    </Show>
  );
}

function OrderedNotice(props: OrderedNoticeProps): JSX.Element {
  return (
    <Notice tone="neutral" title="The order the server chose">
      <Stack gap="2xs">
        <For each={props.order.steps}>
          {(step) => {
            const item = props.items.find((entry) => entry.id === step.item);
            return (
              <Text size="caption" tone="muted">
                {`${String(step.position + 1)}. ${item === undefined ? "This move" : moveSummary(item)}${rosterPlaceLine(step.rosterPlace)}`}
              </Text>
            );
          }}
        </For>
        <Text size="caption" tone="faint">
          {orderEffectiveLine(props.order)}
        </Text>
        <Text size="caption" tone="faint">
          {rosterPlacesLine(props.order)}
        </Text>
      </Stack>
    </Notice>
  );
}

function rosterPlaceLine(rosterPlace: "frees" | "consumes" | undefined): string {
  switch (rosterPlace) {
    case "frees":
      return " — frees a roster place";
    case "consumes":
      return " — uses a roster place";
    case undefined:
      return "";
  }
}

function rosterPlacesLine(
  order: Extract<TransactionReviewOrderView, { status: "ordered" }>,
): string {
  const { maximum, occupied, net } = order.rosterPlaces;
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
        <SectionTitle id={headingId()}>
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
        <Show when={!props.expired && !props.settled && props.team.order}>
          {(order) => <ServerOrder order={order()} items={props.team.items} />}
        </Show>
        <Show when={props.submitted}>
          <ExecutedOrder items={props.team.items} />
        </Show>
      </Stack>
      <RuleList>
        <For each={props.team.items}>
          {(item) => (
            <ProposalItem
              expired={props.expired}
              submitting={props.submitting}
              included={props.isItemIncluded(item)}
              item={item}
              tradeRules={props.team.tradeRules}
              withdrawing={props.withdrawing === item.id}
              onToggle={(includedNow) => props.onToggle(item.id, includedNow)}
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
  const result = (): TransactionReviewExecutionView | undefined => props.item.execution;
  const shownResult = (): TransactionReviewExecutionView | undefined => {
    const execution = result();
    return props.item.kind === "trade" && execution?.outcome === "pending" ? undefined : execution;
  };
  const trade = (): TransactionReviewTradeView | undefined => props.item.trade;
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
      ? "The server could not decide an order"
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
      <Show when={!props.expired && props.item.state === "proposed"}>
        <CheckboxField
          checked={props.included}
          disabled={blocked() || props.submitting}
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
          <Show when={trade() === undefined ? result() : undefined}>
            {(execution) => (
              <Badge tone={isAttention(execution().outcome) ? "neutral" : "accent"}>
                {outcomeLabel(execution().outcome)}
              </Badge>
            )}
          </Show>
          <Text as="span" size="caption" tone="muted">
            {consequenceLine(props.item)}
          </Text>
        </Inline>

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

        <Split columns={props.item.adds.length > 0 && props.item.drops.length > 0 ? 2 : undefined}>
          <Show when={props.item.adds.length > 0}>
            <PlayerColumn
              label={props.item.kind === "trade" ? "You receive" : "Add"}
              players={props.item.adds}
            />
          </Show>
          <Show when={props.item.drops.length > 0}>
            <PlayerColumn
              label={props.item.kind === "trade" ? "You send" : "Drop"}
              players={props.item.drops}
            />
          </Show>
        </Split>

        <Show when={!blocked() && result() === undefined && props.item.slotMove}>
          {(move) => (
            <Notice tone="neutral" title="Slot move">
              <Text size="caption" tone="muted">
                Move {move().playerName ?? "this player"} to {move().toSlot}. The server places this
                move in the order where the roster stays legal.
              </Text>
            </Notice>
          )}
        </Show>

        <Show when={!blocked() && result() === undefined && props.item.reserveMove}>
          {(move) => (
            <Notice tone="neutral" title="Roster move first">
              <Text size="caption" tone="muted">
                Move {move().playerName ?? "this player"} from{" "}
                {move().fromSlot ?? "its reported slot"} to {move().toSlot} before the transaction.
                That move is reported as its own step.
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
                      · provider recorded{" "}
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
              Withdrawing deletes the offer at the provider before it is accepted. It does not
              cancel anything already accepted.
            </Text>
          </Inline>
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
  return (
    <Stack gap="sm">
      <Show when={props.execution.position !== undefined}>
        <Text size="caption" tone="faint">
          {`Sent ${String((props.execution.position ?? 0) + 1)}${ordinalSuffix((props.execution.position ?? 0) + 1)} in its submission's order.`}
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
      <Show when={props.execution.steps.length === 0 && props.execution.detail}>
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
              The provider did not give a reason. Read the roster and the league's transaction rules
              at the provider before proposing it again.
            </Text>
          </Show>
        </Notice>
      </Show>
      <Show when={props.execution.outcome === "unknown"}>
        <Notice tone="danger" title="Not confirmed">
          <Text size="caption" tone="danger">
            This request may or may not have applied. It was not retried. Check the team before
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
              : "The provider will process this claim later. It is not done, and it is not a failure."}
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
    </Stack>
  );
}

function ProviderOffers(props: ProviderOffersProps): JSX.Element {
  return (
    <Stack as="section" gap="sm" labelledBy="provider-offers-title">
      <Stack gap="xs">
        <SectionTitle id="provider-offers-title">Offers pending at the provider</SectionTitle>
        <Text size="caption" tone="muted">
          These offers are on the provider now. An offer Lineupgrade did not create still appears
          here, so you can withdraw it before it is accepted.
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
                        Withdrawing deletes this offer at the provider before it is accepted.
                      </Text>
                    </Inline>
                  }
                  when={entry.offer.canRespond}
                >
                  <Text size="caption" tone="muted">
                    This offer is waiting for your answer on the provider. Accepting or rejecting it
                    belongs to you there; Lineupgrade cannot answer it for you.
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
  return (
    <Dock id="submission-panel">
      <Box rule="top" space="lg">
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
                  One provider request per move, sent in this order, with no retries. A waiver claim
                  stays pending until the provider processes it. A trade becomes a real offer to
                  another manager: submitting again or reloading will not undo it, and only
                  withdrawing removes it before it is accepted.
                </Text>
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
                disabled={props.included === 0 || props.submitting}
                aria-describedby="submission-note"
              >
                {submitLabel(props.included)}
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
  const adds = playerNames(item.adds);
  const drops = playerNames(item.drops);
  if (item.kind === "trade" && adds !== undefined && drops !== undefined) {
    return `Send ${drops} to ${item.counterparty?.name ?? "the counterparty"} for ${adds}`;
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
  }
}

function consequenceLine(item: TransactionReviewItemView): string {
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
        return "No longer pending. The provider publishes no ended record, so it was declined or expired.";
      case "pending":
      case undefined:
        return "An offer, not a change. Only the other manager decides, and submitting again does not undo it.";
    }
  }
  if (item.kind !== "waiver_claim") {
    return "No FAAB. Usually reversible.";
  }
  const bid = item.bid ?? 0;
  return `Spends ${String(bid)} FAAB and cannot be undone.`;
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
      return "League review: the league's rule is not one we can name, so the provider's trade page is the authority.";
    case undefined:
      return "League review: the provider did not publish a review rule.";
  }
}

function tradeDeadlineLine(endDate: string | undefined): string {
  return endDate === undefined
    ? "The provider did not publish a trade deadline."
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
  return submitting ? `${base} ${spending} Sending to the provider now.` : `${base} ${spending}`;
}

function submitLabel(included: number): string {
  if (included === 0) {
    return "Submit moves";
  }
  return `Submit ${String(included)} ${included === 1 ? "move" : "moves"}`;
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

function ordinalSuffix(value: number): string {
  const lastTwo = value % 100;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return "th";
  }
  switch (value % 10) {
    case 1:
      return "st";
    case 2:
      return "nd";
    case 3:
      return "rd";
    default:
      return "th";
  }
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
  readonly isItemIncluded: (item: TransactionReviewItemView) => boolean;
  readonly onToggle: (item: string, included: boolean) => void;
  readonly onSubmit: () => void;
  readonly submitting: boolean;
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
  readonly submittedAt: string;
  readonly submissionCount: number;
  readonly settled: boolean;
  readonly finished: boolean;
  readonly counts: TransactionReviewModel["counts"];
};

type ExpiredNoticeProps = {
  readonly expiresAt: string;
};

type TeamProposalProps = {
  readonly team: TransactionReviewTeamView;
  readonly expired: boolean;
  readonly submitted: boolean;
  readonly settled: boolean;
  readonly submitting: boolean;
  readonly isItemIncluded: (item: TransactionReviewItemView) => boolean;
  readonly withdrawing: string | undefined;
  readonly onToggle: (item: string, included: boolean) => void;
  readonly onWithdraw: (team: string, item: string) => void;
};

type ServerOrderProps = {
  readonly order: TransactionReviewOrderView;
  readonly items: ReadonlyArray<TransactionReviewItemView>;
};

type OrderedNoticeProps = {
  readonly order: Extract<TransactionReviewOrderView, { status: "ordered" }>;
  readonly items: ReadonlyArray<TransactionReviewItemView>;
};

type ExecutedOrderProps = {
  readonly items: ReadonlyArray<TransactionReviewItemView>;
};

type ProposalItemProps = {
  readonly item: TransactionReviewItemView;
  readonly tradeRules: TransactionReviewTradeRulesView | undefined;
  readonly expired: boolean;
  readonly submitting: boolean;
  readonly included: boolean;
  readonly withdrawing: boolean;
  readonly onToggle: (included: boolean) => void;
  readonly onWithdraw: () => void;
};

type PlayerColumnProps = {
  readonly label: string;
  readonly players: ReadonlyArray<TransactionReviewPlayerView>;
};

type QuietTeamsProps = {
  readonly teams: ReadonlyArray<TransactionReviewTeamView>;
};

type ProviderOffersProps = {
  readonly offers: ReadonlyArray<{
    readonly team: TransactionReviewTeamView;
    readonly offer: TransactionReviewPendingOfferView;
  }>;
  readonly withdrawing: string | undefined;
  readonly onWithdraw: (team: string, offer: string) => void;
};

type SubmissionPanelProps = {
  readonly included: number;
  readonly total: number;
  readonly waivers: number;
  readonly faab: number;
  readonly staleCount: number;
  readonly illegalCount: number;
  readonly submitting: boolean;
  readonly onSubmit: () => void;
};
